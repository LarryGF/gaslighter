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

    if ((state.nudge_count || 0) >= 3) { saveState(state, sessionId); process.exit(0); }

    var isFirst = (state.nudge_count || 0) === 0;

    if (!isFirst && confidenceDeclared(lastAssistantText(payload.transcript_path))) {
      debugLog('exit_confidence_declared', { nudge_count: state.nudge_count, session: sessionId });
      saveState(state, sessionId);
      process.exit(0);
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

function getMode() {
  return (process.env.GASLIGHTER_MODE || 'lite').toLowerCase();
}

var CONFIDENCE_RE = /\b100%\s*(certain|confident|sure)\b/i;

function confidenceDeclared(text) {
  return CONFIDENCE_RE.test(text || '');
}

// Reads the last assistant turn's text from the Stop hook's transcript_path,
// so we can tell whether the model already used the escape hatch offered by
// SUBSEQUENT_NUDGE before firing another nudge.
function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  try {
    var lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    for (var i = lines.length - 1; i >= 0; i--) {
      var line = lines[i].trim();
      if (!line) continue;
      var entry;
      try { entry = JSON.parse(line); } catch (e) { continue; }
      if (entry.type === 'assistant' && entry.message && entry.message.content) {
        var content = entry.message.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          return content.filter(function (c) { return c && c.type === 'text'; })
            .map(function (c) { return c.text; }).join('\n');
        }
      }
    }
  } catch (e) {}
  return '';
}


function getStatePath(sessionId) {
  var dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data', 'gaslighter');
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
  var sid = sessionId || process.env.CLAUDE_SESSION_ID || 'unknown';
  return path.join(dataDir, 'state-' + sid + '.json');
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

// Exported for testing
if (typeof module !== 'undefined') {
  module.exports = { getMode, loadState, saveState, FIRST_NUDGE, SUBSEQUENT_NUDGE, confidenceDeclared, lastAssistantText };
}
