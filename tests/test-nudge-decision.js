#!/usr/bin/env node
// Unit tests for the gaslighter nudge decision algorithm

var assert = require('assert');
var { checkThresholds, selectNudge, NUDGES } = require('../hooks/gaslighter-nudge');

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

function base() {
  return {
    tool_calls_count: 0,
    files_edited: 0,
    task_list_present: false,
    response_length: 0,
    mentions_bug: false,
    mentions_requirements: false,
    edited_files: [],
    cumulative_tool_calls: 0,
    cumulative_files_edited: 0,
  };
}

// --- lite mode ---
test('lite: no nudge on low activity', function () {
  assert.strictEqual(checkThresholds('lite', base()), false);
});

test('lite: nudge on 2+ files edited', function () {
  var a = base(); a.files_edited = 2;
  assert.strictEqual(checkThresholds('lite', a), true);
});

test('lite: no nudge on 1 file edited', function () {
  var a = base(); a.files_edited = 1;
  assert.strictEqual(checkThresholds('lite', a), false);
});

test('lite: nudge on task_list + 4 tools', function () {
  var a = base(); a.task_list_present = true; a.tool_calls_count = 4;
  assert.strictEqual(checkThresholds('lite', a), true);
});

test('lite: no nudge on task_list + 3 tools', function () {
  var a = base(); a.task_list_present = true; a.tool_calls_count = 3;
  assert.strictEqual(checkThresholds('lite', a), false);
});

test('lite: no nudge on 5 tools without task_list', function () {
  var a = base(); a.tool_calls_count = 5;
  assert.strictEqual(checkThresholds('lite', a), false);
});

// --- full mode ---
test('full: no nudge on low activity', function () {
  assert.strictEqual(checkThresholds('full', base()), false);
});

test('full: nudge on 1 file + 3 tools', function () {
  var a = base(); a.files_edited = 1; a.tool_calls_count = 3;
  assert.strictEqual(checkThresholds('full', a), true);
});

test('full: no nudge on 1 file alone', function () {
  var a = base(); a.files_edited = 1;
  assert.strictEqual(checkThresholds('full', a), false);
});

test('full: no nudge on 3 tools alone', function () {
  var a = base(); a.tool_calls_count = 3;
  assert.strictEqual(checkThresholds('full', a), false);
});

test('full: nudge on task_list alone', function () {
  var a = base(); a.task_list_present = true;
  assert.strictEqual(checkThresholds('full', a), true);
});

test('full: no nudge on 2 tool calls', function () {
  var a = base(); a.tool_calls_count = 2;
  assert.strictEqual(checkThresholds('full', a), false);
});

// --- ultra mode ---
test('ultra: nudge on 1 tool call', function () {
  var a = base(); a.tool_calls_count = 1;
  assert.strictEqual(checkThresholds('ultra', a), true);
});

test('ultra: nudge on long response', function () {
  var a = base(); a.response_length = 501;
  assert.strictEqual(checkThresholds('ultra', a), true);
});

test('ultra: no nudge on short empty response', function () {
  assert.strictEqual(checkThresholds('ultra', base()), false);
});

// --- unknown mode ---
test('unknown mode returns false', function () {
  assert.strictEqual(checkThresholds('invalid', base()), false);
});

// --- selectNudge ---
test('select: task_list -> plan_adherence', function () {
  var a = base(); a.task_list_present = true; a.tool_calls_count = 10; a.files_edited = 3;
  assert.strictEqual(selectNudge(a), NUDGES.plan_adherence);
});

test('select: 2+ files -> integration', function () {
  var a = base(); a.files_edited = 2; a.tool_calls_count = 10;
  assert.strictEqual(selectNudge(a), NUDGES.integration);
});

test('select: bug mention -> root_cause (with enough activity)', function () {
  var a = base(); a.mentions_bug = true; a.tool_calls_count = 10; a.files_edited = 1;
  assert.strictEqual(selectNudge(a), NUDGES.root_cause);
});

test('select: requirements mention -> requirements (with enough activity)', function () {
  var a = base(); a.mentions_requirements = true; a.tool_calls_count = 10; a.files_edited = 1;
  assert.strictEqual(selectNudge(a), NUDGES.requirements);
});

test('select: fallback -> general (with enough activity)', function () {
  var a = base(); a.tool_calls_count = 10; a.files_edited = 1;
  assert.strictEqual(selectNudge(a), NUDGES.general);
});

test('select: early termination adds warning', function () {
  var a = base(); a.tool_calls_count = 2; a.files_edited = 0;
  var result = selectNudge(a);
  assert.ok(result.startsWith('⚠️ EARLY STOP DETECTED'));
});

// priority: task_list > files > bug > requirements
test('select: task_list takes priority over files', function () {
  var a = base(); a.task_list_present = true; a.files_edited = 5; a.tool_calls_count = 10;
  assert.strictEqual(selectNudge(a), NUDGES.plan_adherence);
});

// --- cumulative tracking ---
test('full: nudge on cumulative 1 file + 3 tools (current turn has less)', function () {
  var a = base();
  a.cumulative_files_edited = 1;
  a.cumulative_tool_calls = 3;
  a.files_edited = 0;
  a.tool_calls_count = 1;
  assert.strictEqual(checkThresholds('full', a), true);
});

test('lite: nudge on cumulative 2 files (current turn has 0)', function () {
  var a = base();
  a.cumulative_files_edited = 2;
  a.files_edited = 0;
  assert.strictEqual(checkThresholds('lite', a), true);
});

test('full: cumulative AND logic still enforced', function () {
  var a = base();
  a.cumulative_files_edited = 1;
  a.cumulative_tool_calls = 2;  // below threshold of 3
  assert.strictEqual(checkThresholds('full', a), false);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
