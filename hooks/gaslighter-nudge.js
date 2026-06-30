#!/usr/bin/env node
// gaslighter v1.0 — Stop hook
// Check if active, anti-loop guard, emit psychologically effective nudge.

var fs = require('fs');
var path = require('path');
var os = require('os');

var input = '';
process.stdin.on('data', function (chunk) { input += chunk; });
process.stdin.on('end', function () {
  try {
    var data = JSON.parse(input.replace(/^﻿/, ''));
    var transcriptPath = data.transcript_path;

    if (!isActive()) { process.exit(0); return; }
    if (!usedWriteOrEdit(transcriptPath)) { process.exit(0); return; }

    var state = loadState();
    state.turn_count = (state.turn_count || 0) + 1;

    // lkb: anti-loop — one nudge per turn, max 3 per session
    if (state.last_nudge_turn === state.turn_count) { saveState(state); process.exit(0); return; }
    if ((state.nudge_count || 0) >= 3) { saveState(state); process.exit(0); return; }

    var isFirst = (state.nudge_count || 0) === 0;

    state.nudge_count = (state.nudge_count || 0) + 1;
    state.last_nudge_turn = state.turn_count;
    saveState(state);

    var nudge = isFirst ? FIRST_NUDGE : SUBSEQUENT_NUDGE;

    process.stderr.write(JSON.stringify({ decision: 'block', reason: nudge }));
    process.exitCode = 2;
  } catch (e) {
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

function isActive() {
  try {
    var claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    var flag = fs.readFileSync(path.join(claudeDir, '.gaslighter-active'), 'utf8').trim();
    return flag && flag !== 'off';
  } catch (e) {
    return false;
  }
}

function usedWriteOrEdit(transcriptPath) {
  if (!transcriptPath) return false;
  try {
    var content = fs.readFileSync(transcriptPath, 'utf8');
    var lines = content.trim().split('\n');
    // Scan last assistant turn for Write/Edit tool use
    for (var i = lines.length - 1; i >= 0; i--) {
      try {
        var entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant') {
          var blocks = entry.message && entry.message.content;
          if (!Array.isArray(blocks)) continue;
          for (var k = 0; k < blocks.length; k++) {
            var name = blocks[k].name || '';
            if (blocks[k].type === 'tool_use' && (name === 'Write' || name === 'Edit')) {
              return true;
            }
          }
        } else if (entry.type === 'user') {
          break;
        }
      } catch (e) { continue; }
    }
  } catch (e) {}
  return false;
}

function getStatePath() {
  var dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data', 'gaslighter');
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
  var sessionId = process.env.CLAUDE_SESSION_ID || 'unknown';
  return path.join(dataDir, 'state-' + sessionId + '.json');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
  } catch (e) {
    return { nudge_count: 0, turn_count: 0, last_nudge_turn: -1 };
  }
}

function saveState(state) {
  var p = getStatePath();
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch (e) {}
  fs.writeFileSync(p, JSON.stringify(state));
}

// Exported for testing
if (typeof module !== 'undefined') {
  module.exports = { isActive, usedWriteOrEdit, loadState, saveState, FIRST_NUDGE, SUBSEQUENT_NUDGE };
}
