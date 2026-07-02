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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
