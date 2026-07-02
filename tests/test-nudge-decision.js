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

test('lastAssistantText: returns empty string for missing path', function () {
  assert.strictEqual(nudge.lastAssistantText(undefined), '');
  assert.strictEqual(nudge.lastAssistantText('/no/such/file.jsonl'), '');
});

// --- anti-loop: stops early once confidence is declared, without hitting the cap of 3 ---

test('anti-loop: nudges again after a plain confirmation (no escape hatch used)', function () {
  var sessionId = 'test-noconf-' + Date.now();
  var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  var transcript = writeTranscript([
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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
