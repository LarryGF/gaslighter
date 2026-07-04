#!/usr/bin/env node
// Unit tests for gaslighter nudge logic

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var os = require('os');
var spawnSync = require('child_process').spawnSync;

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('ok  ' + name);
    passed++;
  } catch (e) {
    console.log('XX  ' + name + ': ' + e.message);
    failed++;
  }
}

var nudge = require('../hooks/gaslighter-nudge');

// --- getMode ---

test('getMode: defaults to lite when env not set', function () {
  var orig = process.env.GASLIGHTER_MODE;
  delete process.env.GASLIGHTER_MODE;
  assert.strictEqual(nudge.getMode(), 'lite');
  if (orig !== undefined) process.env.GASLIGHTER_MODE = orig;
});

test('getMode: reads GASLIGHTER_MODE env var', function () {
  var orig = process.env.GASLIGHTER_MODE;
  process.env.GASLIGHTER_MODE = 'lite';
  assert.strictEqual(nudge.getMode(), 'lite');
  process.env.GASLIGHTER_MODE = 'off';
  assert.strictEqual(nudge.getMode(), 'off');
  process.env.GASLIGHTER_MODE = 'FULL';
  assert.strictEqual(nudge.getMode(), 'full');
  if (orig !== undefined) process.env.GASLIGHTER_MODE = orig;
  else delete process.env.GASLIGHTER_MODE;
});

// --- nudge text variants ---

test('FIRST_NUDGE contains "absolutely sure"', function () {
  assert.ok(nudge.FIRST_NUDGE.includes('absolutely sure'));
});

test('FIRST_NUDGE has no escape hatch', function () {
  assert.ok(!nudge.FIRST_NUDGE.includes('100% certain'));
});

test('SUBSEQUENT_NUDGE has escape hatch', function () {
  assert.ok(nudge.SUBSEQUENT_NUDGE.includes('100% certain'));
});

// --- state management ---

test('loadState returns defaults on missing file', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  var origSession = process.env.CLAUDE_SESSION_ID;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  process.env.CLAUDE_SESSION_ID = 'test-missing-' + Date.now();
  var state = nudge.loadState();
  assert.strictEqual(state.nudge_count, 0);
  assert.strictEqual(state.turn_count, 0);
  process.env.CLAUDE_PLUGIN_DATA = origData;
  process.env.CLAUDE_SESSION_ID = origSession;
});

test('saveState + loadState round-trips', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  var origSession = process.env.CLAUDE_SESSION_ID;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  process.env.CLAUDE_SESSION_ID = 'test-roundtrip-' + Date.now();
  var s = { nudge_count: 2, turn_count: 5 };
  nudge.saveState(s);
  var loaded = nudge.loadState();
  assert.strictEqual(loaded.nudge_count, 2);
  assert.strictEqual(loaded.turn_count, 5);
  process.env.CLAUDE_PLUGIN_DATA = origData;
  process.env.CLAUDE_SESSION_ID = origSession;
});

// --- config: load/save round-trip ---

test('loadConfig returns {} on missing file', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-config-'));
  assert.deepStrictEqual(nudge.loadConfig(), {});
  process.env.CLAUDE_PLUGIN_DATA = origData;
});

test('saveConfig + loadConfig round-trips', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-config-'));
  nudge.saveConfig({ mode: 'full', maxNudges: 5 });
  var loaded = nudge.loadConfig();
  assert.strictEqual(loaded.mode, 'full');
  assert.strictEqual(loaded.maxNudges, 5);
  process.env.CLAUDE_PLUGIN_DATA = origData;
});

// --- getMode: persisted config vs env precedence ---

test('getMode: uses persisted config mode when env unset', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  var origMode = process.env.GASLIGHTER_MODE;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-config-'));
  delete process.env.GASLIGHTER_MODE;
  nudge.saveConfig({ mode: 'full' });
  assert.strictEqual(nudge.getMode(), 'full');
  process.env.CLAUDE_PLUGIN_DATA = origData;
  if (origMode !== undefined) process.env.GASLIGHTER_MODE = origMode;
});

test('getMode: env var wins over persisted config', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  var origMode = process.env.GASLIGHTER_MODE;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-config-'));
  nudge.saveConfig({ mode: 'full' });
  process.env.GASLIGHTER_MODE = 'off';
  assert.strictEqual(nudge.getMode(), 'off');
  process.env.CLAUDE_PLUGIN_DATA = origData;
  if (origMode !== undefined) process.env.GASLIGHTER_MODE = origMode;
  else delete process.env.GASLIGHTER_MODE;
});

// --- getMaxNudges ---

test('getMaxNudges: mode defaults (off=0, lite=3, full=Infinity)', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  var origMax = process.env.GASLIGHTER_MAX_NUDGES;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-config-'));
  delete process.env.GASLIGHTER_MAX_NUDGES;
  assert.strictEqual(nudge.getMaxNudges('off'), 0);
  assert.strictEqual(nudge.getMaxNudges('lite'), 3);
  assert.strictEqual(nudge.getMaxNudges('full'), Infinity);
  process.env.CLAUDE_PLUGIN_DATA = origData;
  if (origMax !== undefined) process.env.GASLIGHTER_MAX_NUDGES = origMax;
});

test('getMaxNudges: persisted maxNudges overrides mode default', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  var origMax = process.env.GASLIGHTER_MAX_NUDGES;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-config-'));
  delete process.env.GASLIGHTER_MAX_NUDGES;
  nudge.saveConfig({ mode: 'lite', maxNudges: 7 });
  assert.strictEqual(nudge.getMaxNudges('lite'), 7);
  process.env.CLAUDE_PLUGIN_DATA = origData;
  if (origMax !== undefined) process.env.GASLIGHTER_MAX_NUDGES = origMax;
});

test('getMaxNudges: env GASLIGHTER_MAX_NUDGES overrides persisted config', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  var origMax = process.env.GASLIGHTER_MAX_NUDGES;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-config-'));
  nudge.saveConfig({ mode: 'lite', maxNudges: 7 });
  process.env.GASLIGHTER_MAX_NUDGES = '2';
  assert.strictEqual(nudge.getMaxNudges('lite'), 2);
  process.env.GASLIGHTER_MAX_NUDGES = 'infinite';
  assert.strictEqual(nudge.getMaxNudges('lite'), Infinity);
  process.env.CLAUDE_PLUGIN_DATA = origData;
  if (origMax !== undefined) process.env.GASLIGHTER_MAX_NUDGES = origMax;
  else delete process.env.GASLIGHTER_MAX_NUDGES;
});

// --- delivery protocol (stdout + exit 0) ---

function runHook(mode, sessionId) {
  var env = Object.assign({}, process.env, {
    GASLIGHTER_MODE: mode,
    CLAUDE_PLUGIN_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-')),
    CLAUDE_SESSION_ID: sessionId
  });
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
    input: JSON.stringify({ session_id: sessionId }),
    env: env,
    encoding: 'utf8'
  });
}

test('lite mode: exits 0 and emits additionalContext on stdout', function () {
  var result = runHook('lite', 'test-lite-' + Date.now());
  assert.strictEqual(result.status, 0);
  var out = JSON.parse(result.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'Stop');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('absolutely sure'));
  assert.strictEqual(result.stderr, '');
});

test('full mode: exits 0 and emits block decision on stdout', function () {
  var result = runHook('full', 'test-full-' + Date.now());
  assert.strictEqual(result.status, 0);
  var out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.ok(out.reason.includes('absolutely sure'));
  assert.strictEqual(result.stderr, '');
});

// --- confidenceDeclared ---

test('confidenceDeclared: matches "100% certain"', function () {
  assert.ok(nudge.confidenceDeclared('I am 100% certain that everything is covered.'));
});

test('confidenceDeclared: matches "100% confident"', function () {
  assert.ok(nudge.confidenceDeclared('100% confident this is done.'));
});

test('confidenceDeclared: does not match plain confirmation', function () {
  assert.ok(!nudge.confidenceDeclared('Confirmed: I have implemented exactly what was asked.'));
});

test('confidenceDeclared: does not match empty/undefined', function () {
  assert.ok(!nudge.confidenceDeclared(''));
  assert.ok(!nudge.confidenceDeclared(undefined));
});

// --- lastAssistantText ---

function writeTranscript(entries) {
  var p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-transcript-')), 'transcript.jsonl');
  fs.writeFileSync(p, entries.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n');
  return p;
}

test('lastAssistantText: returns text of most recent assistant turn', function () {
  var p = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first reply' }] } },
    { type: 'user', message: { role: 'user', content: 'more' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I am 100% certain.' }] } }
  ]);
  assert.strictEqual(nudge.lastAssistantText(p), 'I am 100% certain.');
});

test('lastAssistantText: skips trailing tool-call-only entry, falls back to prior text', function () {
  var p = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I am 100% certain.' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } }
  ]);
  assert.strictEqual(nudge.lastAssistantText(p), 'I am 100% certain.');
});

test('lastAssistantText: returns empty string for missing path', function () {
  assert.strictEqual(nudge.lastAssistantText(undefined), '');
  assert.strictEqual(nudge.lastAssistantText('/no/such/file.jsonl'), '');
});

// --- anti-loop: stops early once confidence is declared, without hitting the cap of 3 ---

test('anti-loop: nudges again after a confirmation turn that still used tools', function () {
  var sessionId = 'test-noconf-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Confirmed: done.' }] } }
  ]);
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'lite', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  function fire() {
    return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
      input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
      env: env,
      encoding: 'utf8'
    });
  }
  fire(); // nudge 1 (first, unconditional)
  var second = fire(); // nudge 2: last assistant text has no confidence declaration -> nudges again
  var out = JSON.parse(second.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('One more check'));
});

test('anti-loop: stops nudging as soon as the model declares 100% confidence, before hitting the cap of 3', function () {
  var sessionId = 'test-conf-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'lite', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  function fire(transcript) {
    return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
      input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
      env: env,
      encoding: 'utf8'
    });
  }
  fire(writeTranscript([])); // nudge 1: forced regardless of transcript
  fire(writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Confirmed: done.' }] } }
  ])); // nudge 2: still no confidence declared yet
  var third = fire(writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I am 100% certain that everything is covered.' }] } }
  ])); // nudge 3 would normally fire (count=2 < 3), but model already declared confidence -> should stay silent
  assert.strictEqual(third.stdout, '');
  assert.strictEqual(third.status, 0);
});

// --- tool-activity heuristic: a text-only answer to a nudge ends the loop ---

test('anti-loop: stops nudging when the model answers a nudge without any tool call', function () {
  var sessionId = 'test-notools-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'lite', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  function fire(transcript) {
    return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
      input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
      env: env,
      encoding: 'utf8'
    });
  }
  fire(writeTranscript([
    { type: 'user', message: { role: 'user', content: 'what time is it?' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I do not have access to the current time.' }] } }
  ])); // nudge 1: forced regardless of transcript
  var second = fire(writeTranscript([
    { type: 'user', message: { role: 'user', content: 'what time is it?' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I did address it — nothing further to implement.' }] } }
  ])); // model re-checked without tools -> no wording match needed, stay silent
  assert.strictEqual(second.stdout, '');
  assert.strictEqual(second.status, 0);
});

test('anti-loop: unreadable transcript fails quiet after the first nudge (never nudge blind)', function () {
  var sessionId = 'test-noread-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'full', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId, GASLIGHTER_FLUSH_WAIT_MS: '200' });
  function fire() {
    return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
      input: JSON.stringify({ session_id: sessionId, transcript_path: '/no/such/file.jsonl' }),
      env: env,
      encoding: 'utf8'
    });
  }
  fire(); // nudge 1 (unconditional)
  var second = fire();
  assert.strictEqual(second.stdout, '');
  assert.strictEqual(second.status, 0);
});

test('anti-loop: waits out a late flush instead of misreading the previous turn', function () {
  var sessionId = 'test-lateflush-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'full', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId, GASLIGHTER_FLUSH_WAIT_MS: '2000' });
  function fire(transcript) {
    return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
      input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
      env: env,
      encoding: 'utf8'
    });
  }
  fire(writeTranscript([])); // nudge 1
  // Transcript initially ends mid-turn (tool_use last, no final text) — like
  // the live flush race. The final text-only confirmation lands 300ms later.
  var p = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', message: { role: 'user', content: 'Stop hook feedback: check again' } }
  ]);
  var finalLine = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All covered, nothing missing.' }] } });
  require('child_process').spawn('bash', ['-c', 'sleep 0.3 && printf "%s\\n" ' + JSON.stringify(finalLine) + ' >> ' + JSON.stringify(p)], { detached: true, stdio: 'ignore' }).unref();
  var second = fire(p);
  // Turn after the nudge was text-only -> stays quiet, even though the text
  // arrived after the hook started.
  assert.strictEqual(second.stdout, '');
  assert.strictEqual(second.status, 0);
});

// --- analyzeLastTurn ---

test('analyzeLastTurn: scopes to the last turn and detects tool use', function () {
  var p = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }
  ]);
  var turn = nudge.analyzeLastTurn(p);
  assert.strictEqual(turn.text, 'done');
  assert.strictEqual(turn.usedTools, true);
});

test('analyzeLastTurn: prior turn tool use does not leak into the last turn', function () {
  var p = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', message: { role: 'user', content: 'thanks, anything else?' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'all good' }] } }
  ]);
  var turn = nudge.analyzeLastTurn(p);
  assert.strictEqual(turn.text, 'all good');
  assert.strictEqual(turn.usedTools, false);
});

test('analyzeLastTurn: returns null for missing path or transcript without assistant entries', function () {
  assert.strictEqual(nudge.analyzeLastTurn(undefined), null);
  assert.strictEqual(nudge.analyzeLastTurn('/no/such/file.jsonl'), null);
  assert.strictEqual(nudge.analyzeLastTurn(writeTranscript([
    { type: 'user', message: { role: 'user', content: 'hi' } }
  ])), null);
});

// --- waitForTurn: polls until the turn is fully flushed ---

test('waitForTurn: waits for the final text entry before returning the turn', function () {
  var p = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }
  ]);
  var finalLine = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'fresh text' }] } });
  require('child_process').spawn('bash', ['-c', 'sleep 0.2 && printf "%s\\n" ' + JSON.stringify(finalLine) + ' >> ' + JSON.stringify(p)], { detached: true, stdio: 'ignore' }).unref();
  var turn = nudge.waitForTurn(p, 2000);
  assert.ok(turn);
  assert.strictEqual(turn.complete, true);
  assert.ok(turn.text.includes('fresh text'));
  assert.strictEqual(turn.usedTools, true);
});

test('waitForTurn: returns null on timeout when the turn never flushes', function () {
  var p = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'hi' } }
  ]);
  assert.strictEqual(nudge.waitForTurn(p, 300), null);
});

// --- end-to-end: persisted full config with no cap overrides a high nudge_count ---

test('end-to-end: persisted full config (no GASLIGHTER_MODE) still nudges past 50 prior nudges', function () {
  var sessionId = 'test-e2e-full-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ mode: 'full' }));
  fs.writeFileSync(path.join(dataDir, 'state-' + sessionId + '.json'), JSON.stringify({ nudge_count: 50, turn_count: 50 }));
  var transcript = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Applied the fix.' }] } }
  ]);
  var env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  delete env.GASLIGHTER_MODE;
  var result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
    env: env,
    encoding: 'utf8'
  });
  var out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.ok(out.reason.includes('One more check'));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
