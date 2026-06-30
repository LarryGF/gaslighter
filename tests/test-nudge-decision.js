#!/usr/bin/env node
// Unit tests for gaslighter v1.0 nudge logic

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var os = require('os');

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

// --- usedWriteOrEdit ---

function tmpTranscript(lines) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaslighter-test-'));
  var p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map(function (l) { return JSON.stringify(l); }).join('\n'));
  return p;
}

var nudge = require('../hooks/gaslighter-nudge');

test('usedWriteOrEdit: true when Edit tool used', function () {
  var p = tmpTranscript([
    { type: 'user', message: { content: 'fix the bug' } },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Edit', input: { file_path: 'foo.js' } }
    ] } }
  ]);
  assert.strictEqual(nudge.usedWriteOrEdit(p), true);
});

test('usedWriteOrEdit: true when Write tool used', function () {
  var p = tmpTranscript([
    { type: 'user', message: { content: 'create file' } },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Write', input: { file_path: 'bar.js' } }
    ] } }
  ]);
  assert.strictEqual(nudge.usedWriteOrEdit(p), true);
});

test('usedWriteOrEdit: false when only Read tools used', function () {
  var p = tmpTranscript([
    { type: 'user', message: { content: 'explain code' } },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Read', input: { file_path: 'foo.js' } },
      { type: 'text', text: 'Here is the explanation.' }
    ] } }
  ]);
  assert.strictEqual(nudge.usedWriteOrEdit(p), false);
});

test('usedWriteOrEdit: false on pure text response', function () {
  var p = tmpTranscript([
    { type: 'user', message: { content: 'hello' } },
    { type: 'assistant', message: { content: [
      { type: 'text', text: 'Hi there!' }
    ] } }
  ]);
  assert.strictEqual(nudge.usedWriteOrEdit(p), false);
});

test('usedWriteOrEdit: false on null/missing path', function () {
  assert.strictEqual(nudge.usedWriteOrEdit(null), false);
  assert.strictEqual(nudge.usedWriteOrEdit(''), false);
});

test('usedWriteOrEdit: only checks last assistant turn', function () {
  var p = tmpTranscript([
    { type: 'user', message: { content: 'first' } },
    { type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Write', input: { file_path: 'old.js' } }
    ] } },
    { type: 'user', message: { content: 'second' } },
    { type: 'assistant', message: { content: [
      { type: 'text', text: 'Just chatting now.' }
    ] } }
  ]);
  assert.strictEqual(nudge.usedWriteOrEdit(p), false);
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
  assert.strictEqual(state.last_nudge_turn, -1);
  process.env.CLAUDE_PLUGIN_DATA = origData;
  process.env.CLAUDE_SESSION_ID = origSession;
});

test('saveState + loadState round-trips', function () {
  var origData = process.env.CLAUDE_PLUGIN_DATA;
  var origSession = process.env.CLAUDE_SESSION_ID;
  process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-state-'));
  process.env.CLAUDE_SESSION_ID = 'test-roundtrip-' + Date.now();
  var s = { nudge_count: 2, turn_count: 5, last_nudge_turn: 4 };
  nudge.saveState(s);
  var loaded = nudge.loadState();
  assert.strictEqual(loaded.nudge_count, 2);
  assert.strictEqual(loaded.last_nudge_turn, 4);
  process.env.CLAUDE_PLUGIN_DATA = origData;
  process.env.CLAUDE_SESSION_ID = origSession;
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
