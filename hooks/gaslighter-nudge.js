#!/usr/bin/env node
// gaslighter — Stop hook (core decision engine)
//
// Reads session state + transcript to decide whether to nudge Claude
// before it completes its response. The decision algorithm:
//
// 1. Safety guards (prevent loops, enforce caps)
// 2. Transcript analysis (tool calls, files edited, task list usage)
// 3. Mode-based threshold check
// 4. Nudge prompt selection based on context signals

const fs = require('fs');
const path = require('path');
const {
  THRESHOLDS,
  SESSION_NUDGE_CAP,
  CONSECUTIVE_NUDGE_CAP,
  getDefaultMode,
  normalizeMode,
} = require('./gaslighter-config');
const {
  loadState,
  saveState,
  writeBlockOutput,
  writeNonBlockOutput,
} = require('./gaslighter-runtime');

var input = '';
process.stdin.on('data', function (chunk) { input += chunk; });
process.stdin.on('end', function () {
  try {
    var data = JSON.parse(input.replace(/^﻿/, ''));
    var transcriptPath = data.transcript_path;
    var stopReason = data.stop_reason || '';
    var agentResult = data.agent_result || null;

    var mode = readActiveMode();
    if (!mode || mode === 'off') { process.exit(0); return; }

    var state = loadState();
    var currentTurn = state.turn_count || 0;

    // Safety guard: already nudged this turn (unless processing agent result)
    if (!agentResult && state.last_nudge_turn === currentTurn) { process.exit(0); return; }

    // Safety guard: consecutive nudge cap
    if ((state.consecutive_nudges || 0) >= CONSECUTIVE_NUDGE_CAP) { process.exit(0); return; }

    // Safety guard: session nudge cap
    if ((state.nudge_count || 0) >= SESSION_NUDGE_CAP) { process.exit(0); return; }

    // If we have agent result, process LLM judge decision (second invocation)
    if (agentResult) {
      handleLLMJudgeResult(agentResult, state, mode);
      return;
    }

    var analysis = analyzeTranscript(transcriptPath);
    var shouldNudge = checkThresholds(mode, analysis);

    if (!shouldNudge) { process.exit(0); return; }

    var nudgeCount = state.nudge_count || 0;

    if (nudgeCount === 0) {
      // First nudge - deterministic
      emitDeterministicNudge(analysis, state, mode, currentTurn);
    } else if (nudgeCount === 1) {
      // Second nudge - LLM judge (agent-based hook)
      emitLLMJudgeAgent(transcriptPath, state, currentTurn);
    } else {
      // Third+ - stop trying
      process.exit(0);
    }
  } catch (e) {
    process.exit(0);
  }
});

function readActiveMode() {
  try {
    var claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude');
    var flagPath = path.join(claudeDir, '.gaslighter-active');
    var mode = fs.readFileSync(flagPath, 'utf8').trim();
    return normalizeMode(mode);
  } catch (e) {
    return getDefaultMode();
  }
}

function analyzeTranscript(transcriptPath) {
  var result = {
    tool_calls_count: 0,
    files_edited: 0,
    task_list_present: false,
    response_length: 0,
    mentions_bug: false,
    mentions_requirements: false,
    edited_files: [],
    cumulative_tool_calls: 0,
    cumulative_files_edited: 0,
  };

  if (!transcriptPath) return result;

  try {
    var content = fs.readFileSync(transcriptPath, 'utf8');
    var lines = content.trim().split('\n');

    // Parse from the end to find the last assistant turn
    var assistantMessages = [];
    var inAssistantTurn = false;

    for (var i = lines.length - 1; i >= 0; i--) {
      try {
        var entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant') {
          inAssistantTurn = true;
          assistantMessages.unshift(entry);
        } else if (inAssistantTurn) {
          break;
        }
      } catch (e) { continue; }
    }

    // For cumulative tracking, parse entire transcript
    var cumulativeEditedSet = {};
    var cumulativeToolCalls = 0;
    for (var i = 0; i < lines.length; i++) {
      try {
        var entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant') {
          var msgContent = entry.message && entry.message.content;
          if (!Array.isArray(msgContent)) continue;

          for (var k = 0; k < msgContent.length; k++) {
            var block = msgContent[k];
            if (block.type === 'tool_use') {
              cumulativeToolCalls++;
              var toolName = block.name || '';
              var toolInput = block.input || {};

              if (toolName === 'Edit' || toolName === 'Write') {
                var fp = toolInput.file_path || '';
                if (fp && !cumulativeEditedSet[fp]) {
                  cumulativeEditedSet[fp] = true;
                }
              }
            }
          }
        }
      } catch (e) { continue; }
    }
    result.cumulative_tool_calls = cumulativeToolCalls;
    result.cumulative_files_edited = Object.keys(cumulativeEditedSet).length;

    // Current turn analysis (existing logic)
    var editedSet = {};
    for (var j = 0; j < assistantMessages.length; j++) {
      var msg = assistantMessages[j];
      var msgContent = msg.message && msg.message.content;
      if (!Array.isArray(msgContent)) continue;

      for (var k = 0; k < msgContent.length; k++) {
        var block = msgContent[k];
        if (block.type === 'text') {
          result.response_length += (block.text || '').length;
          var textLower = (block.text || '').toLowerCase();
          if (/\b(bug|fix|error|broken|crash)\b/.test(textLower)) result.mentions_bug = true;
          if (/\b(requirement|requested|should|must|need)\b/.test(textLower)) result.mentions_requirements = true;
        }

        if (block.type === 'tool_use') {
          result.tool_calls_count++;
          var toolName = block.name || '';
          var toolInput = block.input || {};

          if (toolName === 'Edit' || toolName === 'Write') {
            var fp = toolInput.file_path || '';
            if (fp && !editedSet[fp]) {
              editedSet[fp] = true;
              result.edited_files.push(fp);
            }
          }

          if (toolName === 'TaskCreate' || toolName === 'TaskUpdate') {
            result.task_list_present = true;
          }
        }
      }
    }

    result.files_edited = result.edited_files.length;
  } catch (e) {}

  return result;
}

function checkThresholds(mode, analysis) {
  var t = THRESHOLDS[mode];
  if (!t) return false;

  // Use cumulative counts (whole conversation) for better multi-turn detection
  var filesCount = analysis.cumulative_files_edited || analysis.files_edited;
  var toolsCount = analysis.cumulative_tool_calls || analysis.tool_calls_count;

  if (mode === 'ultra') {
    return toolsCount >= t.tools || analysis.response_length > (t.responseLength || 500);
  }

  if (mode === 'lite') {
    return filesCount >= t.files ||
      (analysis.task_list_present && toolsCount >= t.tools);
  }

  // full: task list always triggers, OR both files+tools threshold met
  if (analysis.task_list_present) return true;
  if (t.requiresBoth) {
    return filesCount >= t.files && toolsCount >= t.tools;
  }
  return filesCount >= t.files || toolsCount >= t.tools;
}

// Nudge prompts keyed by context signal
var NUDGES = {
  plan_adherence: 'GASLIGHTER CHECK: You created a task list. Before finishing:\n' +
    '1. List each task by ID and status\n' +
    '2. For pending tasks: did this response complete them? If not, why are they still pending?\n' +
    '3. If any tasks remain incomplete, address them now or explain what blocks completion.',

  integration: 'GASLIGHTER CHECK: You edited multiple files. Before finishing:\n' +
    '1. Re-read the original request — did it specify "same file", "in X.py", or other file structure constraints?\n' +
    '2. If it specified structure, verify you followed it exactly\n' +
    '3. Verify cross-file consistency: imports correct? Function signatures match call sites? Types consistent across boundaries?\n' +
    '4. Check cross-references: if one file creates/stores an entity and another references it, does the referencing file validate existence?\n' +
    '5. If seed/example files were provided, verify your implementation follows the same patterns (naming, structure, conventions)',

  root_cause: 'GASLIGHTER CHECK: You mentioned a bug/error/fix. Before finishing:\n' +
    '1. Does this fix address the ROOT CAUSE or just the symptom?\n' +
    '2. If you patched one call site, grep for similar patterns that need the same fix\n' +
    '3. Will this prevent the same class of error from recurring?',

  requirements: 'GASLIGHTER CHECK: Before finishing:\n' +
    '1. Re-read the original user request word-for-word\n' +
    '2. Extract every requirement (explicit and implicit) and number them\n' +
    '3. For each: mark as [DONE], [PARTIAL], or [MISSING] with one-line justification\n' +
    '4. Check cross-file requirements: if requirement N says "update X to validate Y", did you actually update X?\n' +
    '5. If example/seed files were provided, verify your implementation matches their patterns\n' +
    '6. Address any [PARTIAL] or [MISSING] items now',

  general: 'GASLIGHTER CHECK: Before finishing:\n' +
    '1. Re-read the original request\n' +
    '2. List every explicit requirement mentioned by the user (numbered)\n' +
    '3. For each requirement, confirm it is fully addressed in your response\n' +
    '4. Pay special attention to requirements that say "update X to do Y" — open the file and verify the change is there\n' +
    '5. Check for implicit requirements:\n' +
    '   - If example/seed files exist, does your code follow the same patterns?\n' +
    '   - Error handling at trust boundaries\n' +
    '   - Edge cases mentioned or implied\n' +
    '   - Existing code conventions to preserve\n' +
    '6. Address any gaps',
};

function selectNudge(analysis) {
  // Early termination detection: very few tool calls suggests premature stop
  var earlyTermination = analysis.tool_calls_count < 5 && analysis.files_edited < 2;

  var baseNudge = '';
  if (analysis.task_list_present) baseNudge = NUDGES.plan_adherence;
  else if (analysis.files_edited >= 2) baseNudge = NUDGES.integration;
  else if (analysis.mentions_bug) baseNudge = NUDGES.root_cause;
  else if (analysis.mentions_requirements) baseNudge = NUDGES.requirements;
  else baseNudge = NUDGES.general;

  // If early termination detected, add emphasis
  if (earlyTermination) {
    return '⚠️ EARLY STOP DETECTED (few tool calls) — verify this is actually complete.\n\n' + baseNudge;
  }

  return baseNudge;
}

function emitDeterministicNudge(analysis, state, mode, currentTurn) {
  var nudgeText = selectNudge(analysis);

  // Update state
  state.nudge_count = (state.nudge_count || 0) + 1;
  state.last_nudge_turn = currentTurn;
  state.consecutive_nudges = (state.consecutive_nudges || 0) + 1;
  saveState(state);

  if (mode === 'lite') {
    writeNonBlockOutput(nudgeText);
  } else {
    writeBlockOutput(nudgeText);
  }
}

function emitLLMJudgeAgent(transcriptPath, state, currentTurn) {
  // Read original request and current response from transcript
  var context = extractRequestAndResponse(transcriptPath);

  // Prevent duplicate LLM judge calls in same turn
  if ((state.last_llm_judge_turn || -1) === currentTurn) {
    process.exit(0);
    return;
  }

  var judgePrompt = buildLLMJudgePrompt(context.originalRequest, context.currentResponse);

  var agentConfig = {
    type: 'agent',
    model: 'haiku',
    prompt: judgePrompt,
    schema: {
      type: 'object',
      properties: {
        complete: { type: 'boolean', description: 'True if ALL requirements from original request are met' },
        missing: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of requirement descriptions that are incomplete or missing (empty if complete)'
        },
        action: {
          type: 'string',
          enum: ['done', 'nudge', 'continue'],
          description: 'done if complete, nudge if incomplete, continue if mid-work'
        }
      },
      required: ['complete', 'missing', 'action']
    }
  };

  // Update state to track LLM judge call
  state.llm_judge_count = (state.llm_judge_count || 0) + 1;
  state.last_llm_judge_turn = currentTurn;
  saveState(state);

  // Output agent config (Claude Code will spawn agent and call us back with result)
  process.stdout.write(JSON.stringify(agentConfig));
  process.exit(0);
}

function handleLLMJudgeResult(agentResult, state, mode) {
  try {
    var result = typeof agentResult === 'string' ? JSON.parse(agentResult) : agentResult;

    if (result.action === 'done' || result.complete) {
      // LLM judge says complete - let through
      process.exit(0);
      return;
    }

    if (result.action === 'nudge' && result.missing && result.missing.length > 0) {
      // LLM judge found gaps - emit nudge with specific missing items
      var nudgeText = 'GASLIGHTER CHECK (LLM Judge): Incomplete requirements detected.\n\n' +
        'Missing or incomplete:\n' +
        result.missing.map(function(item, i) { return (i + 1) + '. ' + item; }).join('\n') +
        '\n\nPlease address these items before completing your response.';

      // Update nudge count
      state.nudge_count = (state.nudge_count || 0) + 1;
      state.consecutive_nudges = (state.consecutive_nudges || 0) + 1;
      saveState(state);

      if (mode === 'lite') {
        writeNonBlockOutput(nudgeText);
      } else {
        writeBlockOutput(nudgeText);
      }
      return;
    }

    // Default: let through if action unclear
    process.exit(0);
  } catch (e) {
    // On error, let through
    process.exit(0);
  }
}

function extractRequestAndResponse(transcriptPath) {
  var result = {
    originalRequest: '',
    currentResponse: ''
  };

  if (!transcriptPath) return result;

  try {
    var content = fs.readFileSync(transcriptPath, 'utf8');
    var lines = content.trim().split('\n');

    // Find first user message (original request)
    for (var i = 0; i < lines.length; i++) {
      try {
        var entry = JSON.parse(lines[i]);
        if (entry.type === 'user' && entry.message && entry.message.content) {
          var userContent = entry.message.content;
          if (typeof userContent === 'string') {
            result.originalRequest = userContent;
            break;
          } else if (Array.isArray(userContent)) {
            for (var k = 0; k < userContent.length; k++) {
              if (userContent[k].type === 'text') {
                result.originalRequest = userContent[k].text || '';
                break;
              }
            }
            if (result.originalRequest) break;
          }
        }
      } catch (e) { continue; }
    }

    // Find last assistant turn (current response)
    var assistantTexts = [];
    for (var i = lines.length - 1; i >= 0; i--) {
      try {
        var entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant' && entry.message && entry.message.content) {
          var msgContent = entry.message.content;
          if (Array.isArray(msgContent)) {
            for (var k = 0; k < msgContent.length; k++) {
              if (msgContent[k].type === 'text') {
                assistantTexts.unshift(msgContent[k].text || '');
              }
            }
          }
        } else if (entry.type === 'user') {
          break;
        }
      } catch (e) { continue; }
    }
    result.currentResponse = assistantTexts.join('\n');

  } catch (e) {}

  return result;
}

function buildLLMJudgePrompt(originalRequest, currentResponse) {
  return 'You are judging whether an AI agent completed all requirements from a user request.\n\n' +
    'Original request:\n' +
    '"""\n' + originalRequest + '\n"""\n\n' +
    'Agent\'s response (claiming completion):\n' +
    '"""\n' + currentResponse + '\n"""\n\n' +
    'Has the agent completed ALL stated requirements from the original request?\n\n' +
    'Pay special attention to:\n' +
    '- Requirements that reference other files ("update X to validate Y", "add field to Z")\n' +
    '- Cross-file consistency (if file A creates entities, does file B validate references to them?)\n' +
    '- Each numbered requirement is a separate check — do not merge or skip any\n\n' +
    'Reply with JSON:\n' +
    '{\n' +
    '  "complete": bool,\n' +
    '  "missing": [list of requirement descriptions that are incomplete],\n' +
    '  "action": "done"|"nudge"|"continue"\n' +
    '}\n\n' +
    '- complete: true if ALL requirements met\n' +
    '- missing: array of strings describing what\'s incomplete (empty if complete)\n' +
    '- action:\n' +
    '  - "done" if complete\n' +
    '  - "nudge" if incomplete (will show agent the missing list)\n' +
    '  - "continue" if agent is mid-work (not claiming completion)';
}

// Exported for testing
if (typeof module !== 'undefined') {
  module.exports = {
    analyzeTranscript: analyzeTranscript,
    checkThresholds: checkThresholds,
    selectNudge: selectNudge,
    NUDGES: NUDGES,
    buildLLMJudgePrompt: buildLLMJudgePrompt,
    extractRequestAndResponse: extractRequestAndResponse
  };
}
