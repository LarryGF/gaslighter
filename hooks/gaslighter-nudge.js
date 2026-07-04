#!/usr/bin/env node
// gaslighter v1.0 — Stop hook
// Check if active, anti-loop guard, emit psychologically effective nudge.

var fs = require('fs');
var path = require('path');
var os = require('os');

var DEBUG_LOG = process.env.GASLIGHTER_DEBUG ? path.join(os.tmpdir(), 'gaslighter-debug.jsonl') : null;
function debugLog(event, extra) {
  if (!DEBUG_LOG) return;
  try {
    var line = JSON.stringify(Object.assign({ ts: Date.now(), event: event, session: (extra && extra.session) || process.env.CLAUDE_SESSION_ID || 'unknown' }, extra || {})) + '\n';
    fs.appendFileSync(DEBUG_LOG, line);
  } catch (e) {}
}

var input = '';
process.stdin.on('data', function (chunk) { input += chunk; });
process.stdin.on('end', function () {
  try {
    var payload = JSON.parse(input.replace(/^﻿/, ''));
    var sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';

    var mode = getMode();
    debugLog('hook_invoked', { mode: mode, session: sessionId });

    if (mode === 'off') { debugLog('exit_mode_off'); process.exit(0); }

    var state = loadState(sessionId);
    state.turn_count = (state.turn_count || 0) + 1;

    if ((state.nudge_count || 0) >= getMaxNudges(mode)) { saveState(state, sessionId); process.exit(0); }

    var isFirst = (state.nudge_count || 0) === 0;

    if (!isFirst) {
      var turn = waitForTurn(payload.transcript_path, parseInt(process.env.GASLIGHTER_FLUSH_WAIT_MS, 10) || 5000);
      // Couldn't observe a fully-flushed turn in time: stay quiet. Nudging
      // blind is what caused infinite full-mode loops (observed live: the
      // harness flushes the final text entry ~200ms AFTER the Stop hook
      // starts, so an unwaited read sees the previous turn or nothing).
      if (!turn) {
        debugLog('exit_flush_timeout', { nudge_count: state.nudge_count, session: sessionId });
        saveState(state, sessionId);
        process.exit(0);
      }
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
    }

    state.nudge_count = (state.nudge_count || 0) + 1;
    saveState(state, sessionId);

    var nudge = isFirst ? FIRST_NUDGE : SUBSEQUENT_NUDGE;

    debugLog('nudge_fired', { nudge_count: state.nudge_count, mode: mode, session: sessionId });
    if (mode === 'lite') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'Stop', additionalContext: nudge }
      }));
    } else {
      process.stdout.write(JSON.stringify({ decision: 'block', reason: nudge }));
    }
    process.exit(0);
  } catch (e) {
    debugLog('hook_error', { error: e.message });
    process.exit(0);
  }
});

var FIRST_NUDGE =
  "Hold on — are you absolutely sure you've addressed every single requirement " +
  "from the original request? Don't just assume you did. Go back, re-read what was asked, " +
  "and confirm each point is actually implemented. If anything is missing, fix it now.";

var SUBSEQUENT_NUDGE =
  "One more check — go back to the original request and verify every requirement " +
  "is implemented. If after re-reading you are 100% certain everything is covered, " +
  "say so explicitly and finish. If anything is missing, fix it now.";

var MODE_DEFAULT_MAX = { off: 0, lite: 3, full: Infinity };

function getMode() {
  return (process.env.GASLIGHTER_MODE || loadConfig().mode || 'lite').toLowerCase();
}

function parseMaxNudges(value) {
  if (value === 'infinite' || value === 'unlimited' || value === -1 || value === '-1') return Infinity;
  var n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

function getMaxNudges(mode) {
  if (process.env.GASLIGHTER_MAX_NUDGES !== undefined) {
    var fromEnv = parseMaxNudges(process.env.GASLIGHTER_MAX_NUDGES);
    if (fromEnv !== undefined) return fromEnv;
  }
  var cfg = loadConfig();
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
function analyzeLastTurn(transcriptPath) {
  if (!transcriptPath) return null;
  var lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); } catch (e) { return null; }
  var texts = [];
  var usedTools = false;
  var sawAssistant = false;
  var complete = false;
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim();
    if (!line) continue;
    var entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (!entry.message || !entry.message.content) continue;
    var content = entry.message.content;
    if (entry.type === 'assistant') {
      var hasText = false;
      if (typeof content === 'string' && content) { texts.unshift(content); hasText = true; }
      if (Array.isArray(content)) {
        content.forEach(function (c) {
          if (!c) return;
          if (c.type === 'text' && c.text) { texts.unshift(c.text); hasText = true; }
          if (c.type === 'tool_use') usedTools = true;
        });
      }
      // The newest assistant entry decides flush state: a trailing tool_use
      // or thinking entry means the final text hasn't been written yet.
      if (!sawAssistant) complete = hasText;
      sawAssistant = true;
    } else if (entry.type === 'user') {
      var isToolResult = Array.isArray(content) && content.some(function (c) {
        return c && c.type === 'tool_result';
      });
      if (!isToolResult) break; // real user message = turn boundary
    }
  }
  if (!sawAssistant) return null;
  return { text: texts.join('\n'), usedTools: usedTools, complete: complete };
}

// The harness flushes the turn's final text entry to transcript_path AFTER
// the Stop hook starts (measured live: ~200ms). Poll until the last turn is
// fully flushed; null on timeout — callers must fail quiet, never nudge blind.
function waitForTurn(transcriptPath, deadlineMs) {
  var start = Date.now();
  while (true) {
    var turn = analyzeLastTurn(transcriptPath);
    if (turn && turn.complete) return turn;
    if (Date.now() - start >= deadlineMs) return null;
    sleepSync(150);
  }
}

// Back-compat helper: text of the last assistant turn.
function lastAssistantText(transcriptPath) {
  var turn = analyzeLastTurn(transcriptPath);
  return turn ? turn.text : '';
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
    getMode, loadState, saveState, FIRST_NUDGE, SUBSEQUENT_NUDGE, confidenceDeclared, lastAssistantText, analyzeLastTurn, waitForTurn,
    loadConfig, saveConfig, getConfigPath, getMaxNudges, MODE_DEFAULT_MAX
  };
}
