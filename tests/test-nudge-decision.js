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
    GASLIGHTER_NUDGE_ON_READONLY: '1', // bypass Phase 1.1 edit-gate: no transcript_path is given here
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

var uuidCounter = 0;
function nextTestUuid() { return 'test-uuid-' + (++uuidCounter); }

// Real transcripts give every entry a unique uuid (waitForTurn's staleness
// guard depends on it); auto-assign one to assistant entries that don't
// already set one so fixtures match production shape.
function withUuid(entry) {
  if (entry.type === 'assistant' && entry.uuid === undefined) {
    return Object.assign({ uuid: nextTestUuid() }, entry);
  }
  return entry;
}

function writeTranscript(entries) {
  var p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-transcript-')), 'transcript.jsonl');
  fs.writeFileSync(p, entries.map(withUuid).map(function (e) { return JSON.stringify(e); }).join('\n') + '\n');
  return p;
}

// Simulates the model producing a new turn between two Stop-hook
// invocations against the same transcript file.
function appendToTranscript(transcriptPath, entry) {
  fs.appendFileSync(transcriptPath, JSON.stringify(withUuid(entry)) + '\n');
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
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Applied the fix.' }] } }
  ]);
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'lite', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  function fire() {
    return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
      input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
      env: env,
      encoding: 'utf8'
    });
  }
  fire(); // nudge 1 (first, edit-gate satisfied by the Edit tool_use above)
  // Simulates the model's response to nudge 1 landing as a new turn.
  appendToTranscript(transcript, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Confirmed: done.' }] } });
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

test('waitForTurn: rejects a stale tail sharing the previously-seen uuid, waits for a genuinely new one', function () {
  var p = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'previous turn' }] } }
  ]);
  var staleTurn = nudge.analyzeLastTurn(p);
  var freshLine = JSON.stringify(withUuid({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'fresh turn' }] } }));
  require('child_process').spawn('bash', ['-c', 'sleep 0.2 && printf "%s\\n" ' + JSON.stringify(freshLine) + ' >> ' + JSON.stringify(p)], { detached: true, stdio: 'ignore' }).unref();
  // Passing staleTurn.uuid as the exclude-guard: an immediate poll would see
  // the same (stale) tail first and must keep waiting for the appended line.
  var turn = nudge.waitForTurn(p, 2000, staleTurn.uuid);
  assert.ok(turn);
  assert.ok(turn.text.includes('fresh turn'));
  assert.notStrictEqual(turn.uuid, staleTurn.uuid);
});

test('waitForTurn: staleUuid guard times out if the tail never changes identity', function () {
  var p = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'same turn forever' }] } }
  ]);
  var turn = nudge.analyzeLastTurn(p);
  assert.strictEqual(nudge.waitForTurn(p, 300, turn.uuid), null);
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

// --- analyzeLastTurn: editedFiles ---

test('analyzeLastTurn: editedFiles true for Edit/Write/NotebookEdit/Bash tool_use', function () {
  ['Edit', 'Write', 'NotebookEdit', 'Bash'].forEach(function (toolName) {
    var p = writeTranscript([
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: toolName, input: {} }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }
    ]);
    assert.strictEqual(nudge.analyzeLastTurn(p).editedFiles, true, toolName);
  });
});

test('analyzeLastTurn: editedFiles false for read-only tools', function () {
  var p = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }
  ]);
  assert.strictEqual(nudge.analyzeLastTurn(p).editedFiles, false);
});

test('analyzeLastTurn: editedFiles false for a turn with no tool calls', function () {
  var p = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'hi' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'just an answer' }] } }
  ]);
  assert.strictEqual(nudge.analyzeLastTurn(p).editedFiles, false);
});

// --- Phase 1.1: first-nudge edit-activity gate ---

function runHookFull(env, payload) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
    input: JSON.stringify(payload),
    env: env,
    encoding: 'utf8'
  });
}

test('first-nudge gate: read-only turn produces no output', function () {
  var sessionId = 'test-gate-readonly-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'explain this' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the explanation.' }] } }
  ]);
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'lite', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var result = runHookFull(env, { session_id: sessionId, transcript_path: transcript });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

test('first-nudge gate: edit turn produces a nudge', function () {
  var sessionId = 'test-gate-edit-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'fix this' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed it.' }] } }
  ]);
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'lite', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var result = runHookFull(env, { session_id: sessionId, transcript_path: transcript });
  var out = JSON.parse(result.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('absolutely sure'));
});

test('first-nudge gate: GASLIGHTER_NUDGE_ON_READONLY=1 restores nudging on read-only turns', function () {
  var sessionId = 'test-gate-override-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'explain this' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the explanation.' }] } }
  ]);
  var env = Object.assign({}, process.env, {
    GASLIGHTER_MODE: 'lite', GASLIGHTER_NUDGE_ON_READONLY: '1',
    CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId
  });
  var result = runHookFull(env, { session_id: sessionId, transcript_path: transcript });
  var out = JSON.parse(result.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('absolutely sure'));
});

// --- Phase 1.3: quiet delivery ---

test('quiet lite (default): output has suppressOutput:true', function () {
  var sessionId = 'test-quiet-lite-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'fix this' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed it.' }] } }
  ]);
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'lite', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var result = runHookFull(env, { session_id: sessionId, transcript_path: transcript });
  var out = JSON.parse(result.stdout);
  assert.strictEqual(out.suppressOutput, true);
});

test('quiet lite: GASLIGHTER_QUIET=0 removes suppressOutput', function () {
  var sessionId = 'test-quiet-off-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'fix this' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed it.' }] } }
  ]);
  var env = Object.assign({}, process.env, {
    GASLIGHTER_MODE: 'lite', GASLIGHTER_QUIET: '0',
    CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId
  });
  var result = runHookFull(env, { session_id: sessionId, transcript_path: transcript });
  var out = JSON.parse(result.stdout);
  assert.strictEqual(out.suppressOutput, undefined);
});

test('full mode: output has systemMessage', function () {
  var sessionId = 'test-quiet-full-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'fix this' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed it.' }] } }
  ]);
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'full', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var result = runHookFull(env, { session_id: sessionId, transcript_path: transcript });
  var out = JSON.parse(result.stdout);
  assert.ok(out.systemMessage.includes('nudge 1/'));
});

test('off mode: still emits nothing', function () {
  var sessionId = 'test-quiet-off-mode-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'off', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var result = runHookFull(env, { session_id: sessionId });
  assert.strictEqual(result.stdout, '');
});

// --- Phase 1.4: stop_hook_active state-mismatch guard ---

test('state_mismatch: stop_hook_active=true with nudge_count 0 uses SUBSEQUENT_NUDGE, not FIRST_NUDGE', function () {
  var sessionId = 'test-mismatch-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'fix this' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed it.' }] } }
  ]);
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'lite', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var result = runHookFull(env, { session_id: sessionId, transcript_path: transcript, stop_hook_active: true });
  var out = JSON.parse(result.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('One more check'));
});

// --- Config CLI: quiet / nudgeOnReadOnly validation ---

test('config CLI: accepts quiet boolean', function () {
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-cfg-'));
  var env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir });
  var result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-config-cli.js'), '--set', '{"quiet":false}'], { env: env, encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(JSON.parse(result.stdout), { quiet: false });
});

test('config CLI: rejects non-boolean quiet', function () {
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-cfg-'));
  var env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir });
  var result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-config-cli.js'), '--set', '{"quiet":"yes"}'], { env: env, encoding: 'utf8' });
  assert.strictEqual(result.status, 1);
});

// --- Cleanup script ---

test('cleanup: removes own session state file and old files, keeps fresh ones', function () {
  var sessionId = 'test-cleanup-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-cleanup-'));
  var ownStatePath = path.join(dataDir, 'state-' + sessionId + '.json');
  var oldStatePath = path.join(dataDir, 'state-old-session.json');
  var freshStatePath = path.join(dataDir, 'state-fresh-session.json');
  fs.writeFileSync(ownStatePath, '{}');
  fs.writeFileSync(oldStatePath, '{}');
  fs.writeFileSync(freshStatePath, '{}');
  var eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldStatePath, eightDaysAgo, eightDaysAgo);

  var env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-cleanup.js')], {
    input: JSON.stringify({ session_id: sessionId }),
    env: env,
    encoding: 'utf8'
  });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(fs.existsSync(ownStatePath), false);
  assert.strictEqual(fs.existsSync(oldStatePath), false);
  assert.strictEqual(fs.existsSync(freshStatePath), true);
});

// --- Phase 3: request capture ---

var capture = require('../hooks/gaslighter-capture');

test('isTrivialPrompt: short prompts and slash commands are trivial', function () {
  assert.strictEqual(capture.isTrivialPrompt('yes'), true);
  assert.strictEqual(capture.isTrivialPrompt('continue'), true);
  assert.strictEqual(capture.isTrivialPrompt('/commit'), true);
  assert.strictEqual(capture.isTrivialPrompt('/gaslighter:config full'), true);
  assert.strictEqual(capture.isTrivialPrompt(''), true);
});

test('isTrivialPrompt: a real request (>=80 chars, not a slash command) is not trivial', function () {
  var longPrompt = 'Please add a new endpoint that accepts a URL and payload, validates both, and returns a structured error on failure.';
  assert.ok(longPrompt.length >= 80);
  assert.strictEqual(capture.isTrivialPrompt(longPrompt), false);
});

function runCapture(env, payload) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-capture.js')], {
    input: JSON.stringify(payload),
    env: env,
    encoding: 'utf8'
  });
}

test('capture: writes last_request into session state for a non-trivial prompt', function () {
  var sessionId = 'test-capture-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var longPrompt = 'Please add a new endpoint that accepts a URL and payload, validates both, and returns a structured error on failure.';
  var result = runCapture(env, { session_id: sessionId, prompt: longPrompt });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
  var state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state-' + sessionId + '.json'), 'utf8'));
  assert.strictEqual(state.last_request.prompt, longPrompt);
  assert.strictEqual(typeof state.last_request.ts, 'number');
});

test('capture: merges into existing state instead of clobbering it', function () {
  var sessionId = 'test-capture-merge-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  fs.writeFileSync(path.join(dataDir, 'state-' + sessionId + '.json'), JSON.stringify({ nudge_count: 2, turn_count: 2 }));
  var env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var longPrompt = 'Please add a new endpoint that accepts a URL and payload, validates both, and returns a structured error on failure.';
  runCapture(env, { session_id: sessionId, prompt: longPrompt });
  var state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state-' + sessionId + '.json'), 'utf8'));
  assert.strictEqual(state.nudge_count, 2);
  assert.strictEqual(state.last_request.prompt, longPrompt);
});

test('capture: skips short prompts and slash commands (no last_request written)', function () {
  ['yes', 'continue', '/commit'].forEach(function (prompt) {
    var sessionId = 'test-capture-skip-' + Date.now() + '-' + Math.random();
    var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
    var env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
    runCapture(env, { session_id: sessionId, prompt: prompt });
    assert.strictEqual(fs.existsSync(path.join(dataDir, 'state-' + sessionId + '.json')), false, prompt);
  });
});

test('capture: truncates to 2000 chars', function () {
  var sessionId = 'test-capture-truncate-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var hugePrompt = 'x'.repeat(3000);
  runCapture(env, { session_id: sessionId, prompt: hugePrompt });
  var state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state-' + sessionId + '.json'), 'utf8'));
  assert.strictEqual(state.last_request.prompt.length, 2000);
});

// --- buildSubsequentNudge ---

test('buildSubsequentNudge: falls back to generic SUBSEQUENT_NUDGE when no request captured', function () {
  assert.strictEqual(nudge.buildSubsequentNudge(undefined), nudge.SUBSEQUENT_NUDGE);
  assert.strictEqual(nudge.buildSubsequentNudge(''), nudge.SUBSEQUENT_NUDGE);
});

test('buildSubsequentNudge: embeds the captured request when present', function () {
  var text = nudge.buildSubsequentNudge('Add a widget endpoint.');
  assert.ok(text.includes('The original request was:'));
  assert.ok(text.includes('Add a widget endpoint.'));
  assert.ok(text.includes('Verify every requirement in it is implemented.'));
  assert.ok(text.includes('One more check')); // still includes the generic body
});

test('end-to-end: subsequent nudge embeds the captured request from state', function () {
  var sessionId = 'test-e2e-capture-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  fs.writeFileSync(path.join(dataDir, 'state-' + sessionId + '.json'), JSON.stringify({
    nudge_count: 1, turn_count: 1, last_request: { prompt: 'Add a widget endpoint.', ts: Date.now() }
  }));
  var transcript = writeTranscript([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Applied the fix.' }] } }
  ]);
  var env = Object.assign({}, process.env, { GASLIGHTER_MODE: 'lite', CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId });
  var result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
    env: env,
    encoding: 'utf8'
  });
  var out = JSON.parse(result.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('Add a widget endpoint.'));
});

// --- Phase 2: smart mode ---

function writeStub(scriptBody) {
  var p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gs-stub-')), 'stub.sh');
  fs.writeFileSync(p, '#!/bin/bash\n' + scriptBody + '\n');
  fs.chmodSync(p, 0o755);
  return p;
}

test('parseSmartOutput: extracts the JSON blob from the result field', function () {
  var parsed = nudge.parseSmartOutput(JSON.stringify({ result: 'sure, here: {"ok":true} thanks' }));
  assert.deepStrictEqual(parsed, { ok: true });
});

test('parseSmartOutput: throws on malformed/missing JSON', function () {
  assert.throws(function () { nudge.parseSmartOutput('not json'); });
  assert.throws(function () { nudge.parseSmartOutput(JSON.stringify({ result: 'no json blob here' })); });
});

test('firstUserMessage: returns the first real user message text', function () {
  var p = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'Please add a widget endpoint with validation.' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    { type: 'user', message: { role: 'user', content: 'more' } }
  ]);
  assert.strictEqual(nudge.firstUserMessage(p), 'Please add a widget endpoint with validation.');
});

test('buildSmartCheckPrompt: embeds both the request and the last turn text', function () {
  var prompt = nudge.buildSmartCheckPrompt('do X', 'did X');
  assert.ok(prompt.includes('do X'));
  assert.ok(prompt.includes('did X'));
  assert.ok(prompt.includes('Answer as JSON only'));
});

test('runSmartCheck: ok:true from the stub CLI', function () {
  var stub = writeStub('echo \'{"result":"{\\"ok\\":true}"}\'');
  var oldCmd = process.env.GASLIGHTER_SMART_CMD;
  process.env.GASLIGHTER_SMART_CMD = stub;
  try {
    var result = nudge.runSmartCheck({ transcript_path: null }, {}, { text: 'did the thing' });
    assert.deepStrictEqual(result, { status: 'ok' });
  } finally {
    process.env.GASLIGHTER_SMART_CMD = oldCmd;
  }
});

test('runSmartCheck: ok:false surfaces the reason as a gap', function () {
  var stub = writeStub('echo \'{"result":"{\\"ok\\":false,\\"reason\\":\\"missing error handling\\"}"}\'');
  var oldCmd = process.env.GASLIGHTER_SMART_CMD;
  process.env.GASLIGHTER_SMART_CMD = stub;
  try {
    var result = nudge.runSmartCheck({ transcript_path: null }, {}, { text: 'did the thing' });
    assert.deepStrictEqual(result, { status: 'gap', reason: 'missing error handling' });
  } finally {
    process.env.GASLIGHTER_SMART_CMD = oldCmd;
  }
});

test('runSmartCheck: malformed output fails quiet', function () {
  var stub = writeStub('echo \'not json\'');
  var oldCmd = process.env.GASLIGHTER_SMART_CMD;
  process.env.GASLIGHTER_SMART_CMD = stub;
  try {
    var result = nudge.runSmartCheck({ transcript_path: null }, {}, { text: 'did the thing' });
    assert.strictEqual(result.status, 'failed');
  } finally {
    process.env.GASLIGHTER_SMART_CMD = oldCmd;
  }
});

test('runSmartCheck: missing binary fails quiet', function () {
  var oldCmd = process.env.GASLIGHTER_SMART_CMD;
  process.env.GASLIGHTER_SMART_CMD = '/nonexistent/gaslighter-smart-stub-binary';
  try {
    var result = nudge.runSmartCheck({ transcript_path: null }, {}, { text: 'did the thing' });
    assert.strictEqual(result.status, 'failed');
  } finally {
    process.env.GASLIGHTER_SMART_CMD = oldCmd;
  }
});

test('smart mode end-to-end: ok:true exits silently (no output, no state increment)', function () {
  var sessionId = 'test-smart-ok-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var stub = writeStub('echo \'{"result":"{\\"ok\\":true}"}\'');
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'Please add a widget endpoint with validation.' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Added the endpoint.' }] } }
  ]);
  var env = Object.assign({}, process.env, {
    GASLIGHTER_MODE: 'smart', GASLIGHTER_SMART_CMD: stub,
    CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId
  });
  var result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
    env: env,
    encoding: 'utf8'
  });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
  var state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state-' + sessionId + '.json'), 'utf8'));
  assert.strictEqual(state.nudge_count || 0, 0);
});

test('smart mode end-to-end: ok:false hard-blocks with the flagged gap', function () {
  var sessionId = 'test-smart-gap-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var stub = writeStub('echo \'{"result":"{\\"ok\\":false,\\"reason\\":\\"missing error handling\\"}"}\'');
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'Please add a widget endpoint with validation.' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Added the endpoint.' }] } }
  ]);
  var env = Object.assign({}, process.env, {
    GASLIGHTER_MODE: 'smart', GASLIGHTER_SMART_CMD: stub,
    CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId
  });
  var result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
    env: env,
    encoding: 'utf8'
  });
  var out = JSON.parse(result.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.ok(out.reason.includes('missing error handling'));
});

test('smart mode end-to-end: check failure falls back to a plain lite-style nudge', function () {
  var sessionId = 'test-smart-fail-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
    { type: 'user', message: { role: 'user', content: 'Please add a widget endpoint with validation.' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Added the endpoint.' }] } }
  ]);
  var env = Object.assign({}, process.env, {
    GASLIGHTER_MODE: 'smart', GASLIGHTER_SMART_CMD: '/nonexistent/gaslighter-smart-stub-binary',
    CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SESSION_ID: sessionId
  });
  var result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-nudge.js')], {
    input: JSON.stringify({ session_id: sessionId, transcript_path: transcript }),
    env: env,
    encoding: 'utf8'
  });
  var out = JSON.parse(result.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('absolutely sure'));
  assert.strictEqual(out.suppressOutput, true);
});

test('smart mode: default cap is 2', function () {
  assert.strictEqual(nudge.getMaxNudges('smart'), 2);
});

test('config CLI: accepts smart as a valid mode', function () {
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-cfg-'));
  var env = Object.assign({}, process.env, { CLAUDE_PLUGIN_DATA: dataDir });
  var result = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'gaslighter-config-cli.js'), '--set', '{"mode":"smart"}'], { env: env, encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(JSON.parse(result.stdout), { mode: 'smart' });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
