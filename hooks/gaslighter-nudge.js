#!/usr/bin/env node
// gaslighter v1.0 — Stop hook
// Check if active, anti-loop guard, emit psychologically effective nudge.

var fs = require('fs');
var path = require('path');
var os = require('os');
var execFileSync = require('child_process').execFileSync;

var DEBUG_LOG = process.env.GASLIGHTER_DEBUG ? path.join(os.tmpdir(), 'gaslighter-debug.jsonl') : null;
function debugLog(event, extra) {
  if (!DEBUG_LOG) return;
  try {
    var line = JSON.stringify(Object.assign({ ts: Date.now(), event: event, session: (extra && extra.session) || process.env.CLAUDE_SESSION_ID || 'unknown' }, extra || {})) + '\n';
    fs.appendFileSync(DEBUG_LOG, line);
  } catch (e) {}
}

// Guard against side effects when required as a library (e.g. by
// gaslighter-cleanup.js for its getDataDir/getStatePath helpers): attaching
// these stdin listeners unconditionally would race the requiring script's
// own stdin handling and call process.exit(0) out from under it.
if (require.main === module) {
  var input = '';
  process.stdin.on('data', function (chunk) { input += chunk; });
  process.stdin.on('end', function () {
  try {
    var payload = JSON.parse(input.replace(/^﻿/, ''));
    var sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';

    var cfg = loadConfig(); // read once per invocation, pass through below
    var mode = getMode(cfg);
    debugLog('hook_invoked', { mode: mode, session: sessionId });

    if (mode === 'off') { debugLog('exit_mode_off'); process.exit(0); }

    // Session is pausing for background work (a backgrounded Bash command, a
    // spawned subagent, a scheduled cron), not actually finishing — nudging
    // here is premature and untracked (we'd never see whether the model acts
    // on it before the real stop). Available since Claude Code v2.1.145;
    // undefined on older CLI versions, which is treated as "nothing pending".
    var pendingBackgroundWork = (payload.background_tasks && payload.background_tasks.length > 0) ||
      (payload.session_crons && payload.session_crons.length > 0);
    if (pendingBackgroundWork) {
      debugLog('exit_background_pending', {
        session: sessionId,
        tasks: (payload.background_tasks || []).length,
        crons: (payload.session_crons || []).length
      });
      process.exit(0);
    }

    var state = loadState(sessionId);
    state.turn_count = (state.turn_count || 0) + 1;

    if ((state.nudge_count || 0) >= getMaxNudges(mode, cfg)) { saveState(state, sessionId); process.exit(0); }

    var isFirst = (state.nudge_count || 0) === 0;

    // stop_hook_active true means the harness itself considers this a
    // continuation of a prior Stop-hook block; nudge_count===0 alongside
    // that means our own state file is missing/mismatched (e.g. wrong data
    // dir). Don't fire FIRST_NUDGE again — treat it as a continuation.
    if (isFirst && payload.stop_hook_active === true) {
      debugLog('state_mismatch', { session: sessionId });
      isFirst = false;
    }

    var flushWaitMs = parseInt(process.env.GASLIGHTER_FLUSH_WAIT_MS, 10) || 5000;
    var turn;

    if (!isFirst) {
      turn = waitForTurn(payload.transcript_path, flushWaitMs, state.last_turn_uuid);
      // Couldn't observe a fully-flushed turn in time: stay quiet. Nudging
      // blind is what caused infinite full-mode loops (observed live: the
      // harness flushes the final text entry ~200ms AFTER the Stop hook
      // starts, so an unwaited read sees the previous turn or nothing).
      if (!turn) {
        debugLog('exit_flush_timeout', { nudge_count: state.nudge_count, session: sessionId });
        saveState(state, sessionId);
        process.exit(0);
      }
      state.last_turn_uuid = turn.uuid;
      if (confidenceDeclared(turn.text)) {
        debugLog('exit_confidence_declared', { nudge_count: state.nudge_count, session: sessionId });
        saveState(state, sessionId);
        process.exit(0);
      }
      // Model answered a nudge without a single tool call: it re-checked and
      // changed nothing, so another identical nudge is pure noise. Stop here
      // regardless of how the model phrased its confirmation.
      if (!turn.usedTools) {
        debugLog('exit_no_tool_activity', { nudge_count: state.nudge_count, session: sessionId });
        saveState(state, sessionId);
        process.exit(0);
      }
    } else if (!getNudgeOnReadOnly(cfg)) {
      // First nudge on a pure Q&A turn (no Edit/Write/NotebookEdit/Bash) is
      // noise — re-reading requirements only matters once something changed.
      turn = waitForTurn(payload.transcript_path, flushWaitMs, state.last_turn_uuid);
      if (!turn) {
        debugLog('exit_flush_timeout', { nudge_count: state.nudge_count, session: sessionId });
        saveState(state, sessionId);
        process.exit(0);
      }
      state.last_turn_uuid = turn.uuid;
      if (!turn.editedFiles) {
        debugLog('exit_no_edit_activity', { nudge_count: state.nudge_count, session: sessionId });
        saveState(state, sessionId);
        process.exit(0);
      }
    }

    // Smart mode needs the last turn's text for its check prompt even on a
    // first-nudge path that skipped waitForTurn above (nudgeOnReadOnly=true).
    if (mode === 'smart' && !turn) {
      turn = waitForTurn(payload.transcript_path, flushWaitMs, state.last_turn_uuid);
      if (!turn) {
        debugLog('exit_flush_timeout', { nudge_count: state.nudge_count, session: sessionId });
        saveState(state, sessionId);
        process.exit(0);
      }
      state.last_turn_uuid = turn.uuid;
    }

    if (mode === 'smart') {
      var check = runSmartCheck(payload, state, turn);
      if (check.status === 'ok') {
        debugLog('smart_ok', { session: sessionId });
        saveState(state, sessionId);
        process.exit(0);
      }
      if (check.status === 'failed') {
        debugLog('smart_check_failed', { session: sessionId, error: check.error });
      }

      state.nudge_count = (state.nudge_count || 0) + 1;
      saveState(state, sessionId);
      debugLog('nudge_fired', { nudge_count: state.nudge_count, mode: mode, session: sessionId, smart_status: check.status });

      if (check.status === 'gap') {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: 'Requirement check flagged gaps: ' + check.reason + '. Fix only these — do not add anything unrequested.'
        }));
      } else {
        // Check failed/unavailable: never crash, never block on it — fall
        // back to lite-style delivery of the standard nudge.
        var fallbackNudge = isFirst ? FIRST_NUDGE : buildSubsequentNudge(state.last_request && state.last_request.prompt);
        var fallbackOut = { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: fallbackNudge } };
        if (getQuiet('lite', cfg)) fallbackOut.suppressOutput = true;
        process.stdout.write(JSON.stringify(fallbackOut));
      }
      process.exit(0);
    }

    state.nudge_count = (state.nudge_count || 0) + 1;
    saveState(state, sessionId);

    var nudge = isFirst ? FIRST_NUDGE : buildSubsequentNudge(state.last_request && state.last_request.prompt);
    var quiet = getQuiet(mode, cfg);

    debugLog('nudge_fired', { nudge_count: state.nudge_count, mode: mode, session: sessionId });
    if (mode === 'lite') {
      var out = { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: nudge } };
      if (quiet) out.suppressOutput = true;
      process.stdout.write(JSON.stringify(out));
    } else {
      var cap = getMaxNudges(mode, cfg);
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: nudge,
        systemMessage: 'gaslighter: verifying completeness (nudge ' + state.nudge_count + '/' + (cap === Infinity ? 'unlimited' : cap) + ')'
      }));
    }
    process.exit(0);
  } catch (e) {
    debugLog('hook_error', { error: e.message });
    process.exit(0);
  }
  });
}

var OVERCORRECTION_GUARD =
  " Only fix what was actually asked — do NOT add unrequested features, refactors, tests, " +
  "or \"improvements\" beyond the original scope.";

var FIRST_NUDGE =
  "Hold on — are you absolutely sure you've addressed every single requirement " +
  "from the original request? Don't just assume you did. Go back, re-read what was asked, " +
  "and confirm each point is actually implemented. If anything is missing, fix it now." +
  OVERCORRECTION_GUARD;

var SUBSEQUENT_NUDGE =
  "One more check — go back to the original request and verify every requirement " +
  "is implemented. If after re-reading you are 100% certain everything is covered, " +
  "say so explicitly and finish. If anything is missing, fix it now." +
  OVERCORRECTION_GUARD;

// Embeds the Phase-3 captured original request (ground truth surviving
// compaction) ahead of the generic subsequent-nudge text when present;
// FIRST_NUDGE stays generic since the request is still live in context on a
// turn's first stop.
function buildSubsequentNudge(lastRequestPrompt) {
  if (!lastRequestPrompt) return SUBSEQUENT_NUDGE;
  return "The original request was:\n---\n" + lastRequestPrompt + "\n---\n" +
    "Verify every requirement in it is implemented.\n\n" + SUBSEQUENT_NUDGE;
}

var MODE_DEFAULT_MAX = { off: 0, lite: 3, full: Infinity, smart: 2 };

function getMode(cfg) {
  return (process.env.GASLIGHTER_MODE || (cfg || loadConfig()).mode || 'lite').toLowerCase();
}

function parseBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  var s = String(value).toLowerCase();
  if (s === '1' || s === 'true') return true;
  if (s === '0' || s === 'false') return false;
  return fallback;
}

function getQuiet(mode, cfg) {
  var envVal = process.env.GASLIGHTER_QUIET;
  if (envVal !== undefined) return parseBool(envVal, mode === 'lite');
  cfg = cfg || loadConfig();
  if (cfg.quiet !== undefined) return parseBool(cfg.quiet, mode === 'lite');
  return mode === 'lite';
}

function getNudgeOnReadOnly(cfg) {
  var envVal = process.env.GASLIGHTER_NUDGE_ON_READONLY;
  if (envVal !== undefined) return parseBool(envVal, false);
  cfg = cfg || loadConfig();
  return parseBool(cfg.nudgeOnReadOnly, false);
}

function parseMaxNudges(value) {
  if (value === 'infinite' || value === 'unlimited' || value === -1 || value === '-1') return Infinity;
  var n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

function getMaxNudges(mode, cfg) {
  if (process.env.GASLIGHTER_MAX_NUDGES !== undefined) {
    var fromEnv = parseMaxNudges(process.env.GASLIGHTER_MAX_NUDGES);
    if (fromEnv !== undefined) return fromEnv;
  }
  cfg = cfg || loadConfig();
  if (cfg.maxNudges !== undefined && cfg.maxNudges !== null) {
    var fromCfg = parseMaxNudges(cfg.maxNudges);
    if (fromCfg !== undefined) return fromCfg;
  }
  return MODE_DEFAULT_MAX[mode];
}

var CONFIDENCE_RE = /\b100%\s*(certain|confident|sure)\b/i;

function confidenceDeclared(text) {
  return CONFIDENCE_RE.test(text || '');
}

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
// never inserts a real user-turn boundary (see waitForTurn's comment below),
// so without this the backward walk keeps merging every turn since the last
// real human message into one — a tool_use from turns ago (already judged
// and nudged on) would permanently poison usedTools/editedFiles for every
// later turn, even a plain-text one with no tool calls of its own.
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
//
// staleUuid guards against a race the naive "is the tail complete" check
// missed: if the hook's first read lands before the harness appends the
// just-finished turn, the tail is still the *previous* turn — which already
// looks complete, since it too ended in a real text entry. That stale read
// satisfies `turn.complete` immediately, so the hook judges old content
// (observed live: a turn declaring "100% certain" got skipped entirely
// because the poll returned the prior turn moments before the real one
// landed). Passing the previously-processed turn's uuid forces the poll to
// keep waiting until a turn with a *different* identity shows up complete.
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

// Smart mode's ground truth for the original ask when Phase 3's capture
// didn't fire (e.g. session started before the capture hook existed): the
// first real user message in the transcript.
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

function buildSmartCheckPrompt(originalRequest, lastTurnText) {
  return "Original request:\n---\n" + originalRequest + "\n---\n\n" +
    "Last turn's response:\n---\n" + lastTurnText + "\n---\n\n" +
    "Did the response address every explicit requirement in the request? Answer as JSON only: " +
    "{\"ok\": true} or {\"ok\": false, \"reason\": \"<the specific missing requirement(s)>\"}. " +
    "Missing = explicitly asked and not done. Extra unrequested work is not a missing requirement.";
}

// Parses `claude --output-format json` stdout: the wrapper's `result` field
// holds the model's reply text, which itself should be a JSON blob.
function parseSmartOutput(stdout) {
  var outer = JSON.parse(stdout);
  var resultText = typeof outer.result === 'string' ? outer.result : JSON.stringify(outer.result);
  var match = resultText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON object found in result');
  return JSON.parse(match[0]);
}

var SMART_TIMEOUT_MS = 20000;

// Shells out to a cheap model asking whether the last turn actually missed a
// requirement, instead of nudging unconditionally. Never throws: any failure
// (missing binary, non-zero exit, timeout, malformed output) becomes
// { status: 'failed' } so the caller can fall back to a plain nudge.
function runSmartCheck(payload, state, turn) {
  var originalRequest = (state.last_request && state.last_request.prompt) ||
    firstUserMessage(payload.transcript_path) || '(original request unavailable)';
  var prompt = buildSmartCheckPrompt(originalRequest, (turn && turn.text) || '');
  var binary = process.env.GASLIGHTER_SMART_CMD || 'claude';
  try {
    var stdout = execFileSync(binary,
      ['-p', prompt, '--model', 'claude-haiku-4-5', '--output-format', 'json', '--max-turns', '1'],
      { timeout: SMART_TIMEOUT_MS, encoding: 'utf8' });
    var parsed = parseSmartOutput(stdout);
    if (parsed && parsed.ok === true) return { status: 'ok' };
    if (parsed && parsed.ok === false) return { status: 'gap', reason: parsed.reason || 'unspecified' };
    return { status: 'failed', error: 'unexpected response shape' };
  } catch (e) {
    return { status: 'failed', error: e.message };
  }
}


function getDataDir() {
  var dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data', 'gaslighter');
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
  return dataDir;
}

function getStatePath(sessionId) {
  var sid = sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  return path.join(getDataDir(), 'state-' + sid + '.json');
}

function loadState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(sessionId), 'utf8'));
  } catch (e) {
    return { nudge_count: 0, turn_count: 0 };
  }
}

function saveState(state, sessionId) {
  var p = getStatePath(sessionId);
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch (e) {}
  fs.writeFileSync(p, JSON.stringify(state));
}

function getConfigPath() {
  return path.join(getDataDir(), 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveConfig(cfg) {
  var p = getConfigPath();
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch (e) {}
  fs.writeFileSync(p, JSON.stringify(cfg));
}

// Exported for testing
if (typeof module !== 'undefined') {
  module.exports = {
    getMode, loadState, saveState, FIRST_NUDGE, SUBSEQUENT_NUDGE, buildSubsequentNudge, confidenceDeclared, lastAssistantText, analyzeLastTurn, waitForTurn,
    loadConfig, saveConfig, getConfigPath, getMaxNudges, MODE_DEFAULT_MAX, getQuiet, getNudgeOnReadOnly, getStatePath, getDataDir,
    firstUserMessage, buildSmartCheckPrompt, parseSmartOutput, runSmartCheck
  };
}
