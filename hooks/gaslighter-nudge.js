#!/usr/bin/env node
// gaslighter — Claude Code Stop hook (adapter).
//
// This file is the Claude Code *adapter* over the harness-agnostic core in
// ./lib. Its responsibilities are Claude-specific only:
//   - read the Stop hook payload from stdin
//   - parse Claude's JSONL transcript into an abstract "turn"
//   - run the smart check via the `claude` CLI
//   - translate the core's abstract plan into Claude's Stop-hook output shape
//     (decision:"block" | hookSpecificOutput.additionalContext + suppressOutput)
// All decision logic lives in ./lib/core.js and ./lib/engine.js and is shared
// with the OpenCode adapter. Persistence/paths come from ./lib/store.js and
// ./lib/env.js, which resolve generic GASLIGHTER_* vars before Claude's.

'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var execFileSync = require('child_process').execFileSync;

var engine = require('./lib/engine');
var env = require('./lib/env');
var createStore = require('./lib/store').createStore;
var core = require('./lib/core');

var DEBUG_LOG = process.env.GASLIGHTER_DEBUG ? path.join(os.tmpdir(), 'gaslighter-debug.jsonl') : null;
function debugLog(event, extra) {
  if (!DEBUG_LOG) return;
  try {
    var line = JSON.stringify(Object.assign({ ts: Date.now(), event: event, session: (extra && extra.session) || env.resolveSessionId() }, extra || {})) + '\n';
    fs.appendFileSync(DEBUG_LOG, line);
  } catch (e) {}
}

// --- persistence (agnostic store bound to the resolved data dir per call, so
// tests that flip CLAUDE_PLUGIN_DATA/GASLIGHTER_DATA_DIR between calls see it) ---
function store() { return createStore(env.resolveDataDir()); }
function getDataDir() { return store().getDataDir(); }
function getStatePath(sessionId) { return store().getStatePath(env.resolveSessionId(sessionId)); }
function loadState(sessionId) { return store().loadState(env.resolveSessionId(sessionId)); }
function saveState(state, sessionId) { return store().saveState(state, env.resolveSessionId(sessionId)); }
function getConfigPath() { return store().getConfigPath(); }
function loadConfig() { return store().loadConfig(); }
function saveConfig(cfg) { return store().saveConfig(cfg); }

// --- config resolution (thin wrappers preserving the zero/one-arg API) ---
function getMode(cfg) { return engine.resolveMode(cfg || loadConfig()); }
function getQuiet(mode, cfg) { return engine.resolveQuiet(mode, cfg || loadConfig()); }
function getNudgeOnReadOnly(cfg) { return engine.resolveNudgeOnReadOnly(cfg || loadConfig()); }
function getMaxNudges(mode, cfg) { return engine.resolveMaxNudges(mode, cfg || loadConfig()); }

// Re-exported text/predicate for back-compat.
var FIRST_NUDGE = engine.FIRST_NUDGE;
var SUBSEQUENT_NUDGE = engine.SUBSEQUENT_NUDGE;
var MODE_DEFAULT_MAX = engine.MODE_DEFAULT_MAX;
var confidenceDeclared = engine.confidenceDeclared;
var buildSmartCheckPrompt = engine.buildSmartCheckPrompt;
var parseSmartOutput = engine.parseSmartOutput;

// ---------------------------------------------------------------------------
// Claude transcript parsing (JSONL). This is Claude Code's on-disk format, so
// it stays in the Claude adapter. It produces the abstract "turn" the core
// consumes: { text, usedTools, editedFiles, complete, uuid }.
// ---------------------------------------------------------------------------

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {}
}

// Walks the last assistant turn (everything back to the previous real user
// message; tool_result entries belong to the turn) and reports its combined
// text, whether any tool was called, and whether the turn looks fully flushed
// (its newest entry is an assistant text entry — the harness writes the final
// text entry last). Returns null when the transcript is missing/unreadable or
// holds no assistant entry.
// staleUuid, when given, is the uuid of the last assistant entry already
// judged by a prior nudge cycle. Lite mode's additionalContext delivery
// never inserts a real user-turn boundary, so without this the backward walk
// keeps merging every turn since the last real human message into one — a
// tool_use from turns ago (already judged and nudged on) would permanently
// poison usedTools/editedFiles for every later turn, even a plain-text one.
function analyzeLastTurn(transcriptPath, staleUuid) {
  if (!transcriptPath) return null;
  var lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); } catch (e) { return null; }
  var texts = [];
  var usedTools = false;
  var editedFiles = false;
  var sawAssistant = false;
  var complete = false;
  var uuid = null;
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim();
    if (!line) continue;
    var entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (!entry.message || !entry.message.content) continue;
    var content = entry.message.content;
    if (entry.type === 'assistant') {
      if (staleUuid && entry.uuid === staleUuid) break; // already-judged turn boundary
      var hasText = false;
      if (typeof content === 'string' && content) { texts.unshift(content); hasText = true; }
      if (Array.isArray(content)) {
        content.forEach(function (c) {
          if (!c) return;
          if (c.type === 'text' && c.text) { texts.unshift(c.text); hasText = true; }
          if (c.type === 'tool_use') {
            usedTools = true;
            if (c.name === 'Edit' || c.name === 'Write' || c.name === 'NotebookEdit' || c.name === 'Bash') {
              editedFiles = true;
            }
          }
        });
      }
      // The newest assistant entry decides flush state: a trailing tool_use
      // or thinking entry means the final text hasn't been written yet. Its
      // uuid is this turn's identity, so callers can tell a freshly-flushed
      // turn apart from a stale one still sitting at the tail from before.
      if (!sawAssistant) { complete = hasText; uuid = entry.uuid || null; }
      sawAssistant = true;
    } else if (entry.type === 'user') {
      var isToolResult = Array.isArray(content) && content.some(function (c) {
        return c && c.type === 'tool_result';
      });
      if (!isToolResult) break; // real user message = turn boundary
    }
  }
  if (!sawAssistant) return null;
  return { text: texts.join('\n'), usedTools: usedTools, editedFiles: editedFiles, complete: complete, uuid: uuid };
}

// The harness flushes the turn's final text entry to transcript_path AFTER
// the Stop hook starts (measured live: ~200ms). Poll until the last turn is
// fully flushed; null on timeout — callers must fail quiet, never nudge blind.
// staleUuid forces the poll to keep waiting until a turn with a *different*
// identity shows up complete (the previous turn also looks complete).
function waitForTurn(transcriptPath, deadlineMs, staleUuid) {
  var start = Date.now();
  while (true) {
    var turn = analyzeLastTurn(transcriptPath, staleUuid);
    if (turn && turn.complete && turn.uuid !== staleUuid) return turn;
    if (Date.now() - start >= deadlineMs) return null;
    sleepSync(150);
  }
}

// Back-compat helper: text of the last assistant turn.
function lastAssistantText(transcriptPath) {
  var turn = analyzeLastTurn(transcriptPath);
  return turn ? turn.text : '';
}

// Smart mode's ground truth for the original ask when capture didn't fire:
// the first real user message in the transcript.
function firstUserMessage(transcriptPath) {
  if (!transcriptPath) return '';
  var lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); } catch (e) { return ''; }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (entry.type !== 'user' || !entry.message || !entry.message.content) continue;
    var content = entry.message.content;
    if (typeof content === 'string' && content) return content;
    if (Array.isArray(content)) {
      if (content.some(function (c) { return c && c.type === 'tool_result'; })) continue;
      var text = content.filter(function (c) { return c && c.type === 'text' && c.text; })
        .map(function (c) { return c.text; }).join('\n');
      if (text) return text;
    }
  }
  return '';
}

var SMART_TIMEOUT_MS = 20000;

// Shells out to a cheap model asking whether the last turn actually missed a
// requirement. Never throws: any failure (missing binary, non-zero exit,
// timeout, malformed output) becomes { status: 'failed' } so the caller falls
// back to a plain nudge. Binary/model are configurable via engine resolvers.
function runSmartCheck(payload, state, turn) {
  var cfg = loadConfig();
  var originalRequest = (state.last_request && state.last_request.prompt) ||
    firstUserMessage(payload.transcript_path) || '(original request unavailable)';
  var prompt = engine.buildSmartCheckPrompt(originalRequest, (turn && turn.text) || '');
  var binary = engine.resolveSmartCmd(cfg);
  var model = engine.resolveSmartModel(cfg);
  try {
    var stdout = execFileSync(binary,
      ['-p', prompt, '--model', model, '--output-format', 'json', '--max-turns', '1'],
      { timeout: SMART_TIMEOUT_MS, encoding: 'utf8' });
    var parsed = engine.parseSmartOutput(stdout);
    if (parsed && parsed.ok === true) return { status: 'ok' };
    if (parsed && parsed.ok === false) return { status: 'gap', reason: parsed.reason || 'unspecified' };
    return { status: 'failed', error: 'unexpected response shape' };
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
}

// Maps a core exit reason to its debug-log event name (parity with prior logs).
var EXIT_LOG_EVENT = {
  flush_timeout: 'exit_flush_timeout',
  confidence_declared: 'exit_confidence_declared',
  no_tool_activity: 'exit_no_tool_activity',
  no_edit_activity: 'exit_no_edit_activity',
  smart_ok: 'smart_ok'
};

// ---------------------------------------------------------------------------
// Adapter entry point.
// ---------------------------------------------------------------------------
if (require.main === module) {
  var input = '';
  process.stdin.on('data', function (chunk) { input += chunk; });
  process.stdin.on('end', function () {
    run(input).then(function () { process.exit(0); }, function (e) {
      debugLog('hook_error', { error: e && e.message });
      process.exit(0);
    });
  });
}

async function run(input) {
  var payload;
  try {
    payload = JSON.parse(input.replace(/^\ufeff/, ''));
  } catch (e) {
    debugLog('hook_error', { error: e.message });
    return;
  }

  var sessionId = env.resolveSessionId(payload);
  var cfg = loadConfig();
  var mode = getMode(cfg);
  debugLog('hook_invoked', { mode: mode, session: sessionId });

  if (mode === 'off') { debugLog('exit_mode_off'); return; }

  // Claude-specific: session is pausing for background work, not finishing.
  var pendingBackgroundWork = (payload.background_tasks && payload.background_tasks.length > 0) ||
    (payload.session_crons && payload.session_crons.length > 0);
  if (pendingBackgroundWork) {
    debugLog('exit_background_pending', {
      session: sessionId,
      tasks: (payload.background_tasks || []).length,
      crons: (payload.session_crons || []).length
    });
    return;
  }

  var state = loadState(sessionId);
  var flushWaitMs = parseInt(process.env.GASLIGHTER_FLUSH_WAIT_MS, 10) || 5000;

  var plan = await core.decide({
    mode: mode,
    maxNudges: getMaxNudges(mode, cfg),
    state: state,
    stopHookActive: payload.stop_hook_active === true,
    nudgeOnReadOnly: getNudgeOnReadOnly(cfg),
    getQuiet: function (m) { return engine.resolveQuiet(m, cfg); },
    getTurn: function (staleUuid) { return waitForTurn(payload.transcript_path, flushWaitMs, staleUuid); },
    runSmartCheck: function (st, turn) { return runSmartCheck(payload, st, turn); },
    log: function (event, extra) { debugLog(event, Object.assign({ session: sessionId }, extra)); }
  });

  if (plan.action === 'exit') {
    saveState(state, sessionId);
    var ev = EXIT_LOG_EVENT[plan.reason];
    if (ev) debugLog(ev, { nudge_count: state.nudge_count, session: sessionId });
    return;
  }

  // action === 'deliver'
  saveState(state, sessionId);
  var d = plan.deliver;
  debugLog('nudge_fired', d.smart
    ? { nudge_count: state.nudge_count, mode: mode, session: sessionId, smart_status: plan.reason === 'smart_gap' ? 'gap' : 'failed' }
    : { nudge_count: state.nudge_count, mode: mode, session: sessionId });

  process.stdout.write(JSON.stringify(formatClaudeOutput(d)));
}

// Translates the core's abstract delivery into Claude's Stop-hook output shape.
function formatClaudeOutput(d) {
  if (d.blocking) {
    var blockOut = { decision: 'block', reason: d.text };
    if (d.systemMessage) blockOut.systemMessage = d.systemMessage;
    return blockOut;
  }
  var softOut = { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: d.text } };
  if (d.quiet) softOut.suppressOutput = true;
  return softOut;
}

// Exported for testing and for the other hook scripts (capture/cleanup/config).
if (typeof module !== 'undefined') {
  module.exports = {
    getMode: getMode, loadState: loadState, saveState: saveState,
    FIRST_NUDGE: FIRST_NUDGE, SUBSEQUENT_NUDGE: SUBSEQUENT_NUDGE,
    confidenceDeclared: confidenceDeclared, lastAssistantText: lastAssistantText,
    analyzeLastTurn: analyzeLastTurn, waitForTurn: waitForTurn,
    loadConfig: loadConfig, saveConfig: saveConfig, getConfigPath: getConfigPath,
    getMaxNudges: getMaxNudges, MODE_DEFAULT_MAX: MODE_DEFAULT_MAX,
    getQuiet: getQuiet, getNudgeOnReadOnly: getNudgeOnReadOnly,
    getStatePath: getStatePath, getDataDir: getDataDir,
    firstUserMessage: firstUserMessage, buildSmartCheckPrompt: buildSmartCheckPrompt,
    parseSmartOutput: parseSmartOutput, runSmartCheck: runSmartCheck,
    formatClaudeOutput: formatClaudeOutput
  };
}
