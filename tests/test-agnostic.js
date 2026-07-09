#!/usr/bin/env node
// Unit tests for the harness-agnostic layer: env resolution, store, the shared
// decision core, and the OpenCode parsing helpers.

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var os = require('os');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ' + name); passed++; }
  catch (e) { console.log('XX  ' + name + ': ' + (e && e.stack || e.message)); failed++; }
}
function atest(name, fn) {
  return fn().then(function () { console.log('ok  ' + name); passed++; },
    function (e) { console.log('XX  ' + name + ': ' + (e && e.stack || e.message)); failed++; });
}

var engine = require('../hooks/lib/engine');
var env = require('../hooks/lib/env');
var core = require('../hooks/lib/core');
var createStore = require('../hooks/lib/store').createStore;
var oc = require('../hooks/lib/opencode');

// --- env resolution ---

test('env: GASLIGHTER_DATA_DIR wins over CLAUDE_PLUGIN_DATA', function () {
  var a = process.env.GASLIGHTER_DATA_DIR, b = process.env.CLAUDE_PLUGIN_DATA;
  process.env.GASLIGHTER_DATA_DIR = '/tmp/gs-generic';
  process.env.CLAUDE_PLUGIN_DATA = '/tmp/gs-claude';
  assert.strictEqual(env.resolveDataDir(), '/tmp/gs-generic');
  restore('GASLIGHTER_DATA_DIR', a); restore('CLAUDE_PLUGIN_DATA', b);
});

test('env: falls back to CLAUDE_PLUGIN_DATA then neutral default', function () {
  var a = process.env.GASLIGHTER_DATA_DIR, b = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.GASLIGHTER_DATA_DIR;
  process.env.CLAUDE_PLUGIN_DATA = '/tmp/gs-claude2';
  assert.strictEqual(env.resolveDataDir(), '/tmp/gs-claude2');
  delete process.env.CLAUDE_PLUGIN_DATA;
  assert.ok(env.resolveDataDir().indexOf('gaslighter') !== -1);
  restore('GASLIGHTER_DATA_DIR', a); restore('CLAUDE_PLUGIN_DATA', b);
});

test('env: session id precedence generic > claude > unknown', function () {
  var g = process.env.GASLIGHTER_SESSION_ID, c = process.env.CLAUDE_SESSION_ID;
  assert.strictEqual(env.resolveSessionId({ session_id: 'explicit' }), 'explicit');
  delete process.env.GASLIGHTER_SESSION_ID; delete process.env.CLAUDE_SESSION_ID;
  process.env.CLAUDE_SESSION_ID = 'claude-sid';
  assert.strictEqual(env.resolveSessionId({}), 'claude-sid');
  process.env.GASLIGHTER_SESSION_ID = 'generic-sid';
  assert.strictEqual(env.resolveSessionId({}), 'generic-sid');
  delete process.env.GASLIGHTER_SESSION_ID; delete process.env.CLAUDE_SESSION_ID;
  assert.strictEqual(env.resolveSessionId(), 'unknown');
  restore('GASLIGHTER_SESSION_ID', g); restore('CLAUDE_SESSION_ID', c);
});

function restore(k, v) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }

// --- store ---

test('store: state and config roundtrip in the given dir', function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-store-'));
  var s = createStore(dir);
  s.saveState({ nudge_count: 2, turn_count: 5 }, 'sid');
  assert.deepStrictEqual(s.loadState('sid'), { nudge_count: 2, turn_count: 5 });
  assert.ok(fs.existsSync(path.join(dir, 'state-sid.json')));
  s.saveConfig({ mode: 'full' });
  assert.deepStrictEqual(s.loadConfig(), { mode: 'full' });
});

// --- engine config resolution (smart model/cmd) ---

test('engine: resolveSmartModel env > cfg > default', function () {
  var e = process.env.GASLIGHTER_SMART_MODEL;
  delete process.env.GASLIGHTER_SMART_MODEL;
  assert.strictEqual(engine.resolveSmartModel({}), engine.DEFAULT_SMART_MODEL);
  assert.strictEqual(engine.resolveSmartModel({ smartModel: 'anthropic/claude-haiku' }), 'anthropic/claude-haiku');
  process.env.GASLIGHTER_SMART_MODEL = 'openai/gpt';
  assert.strictEqual(engine.resolveSmartModel({ smartModel: 'ignored' }), 'openai/gpt');
  restore('GASLIGHTER_SMART_MODEL', e);
});

// --- OpenCode parsing helpers ---

test('opencode.extractTurn: aggregates assistant turn, detects edit tools', function () {
  var msgs = [
    { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'do the thing' }] },
    { info: { id: 'a1', role: 'assistant' }, parts: [
      { type: 'text', text: 'working' },
      { type: 'tool', tool: 'edit' }
    ] }
  ];
  var t = oc.extractTurn(msgs);
  assert.strictEqual(t.text, 'working');
  assert.strictEqual(t.usedTools, true);
  assert.strictEqual(t.editedFiles, true);
  assert.strictEqual(t.uuid, 'a1');
  assert.strictEqual(t.complete, true);
});

test('opencode.extractTurn: read-only turn (no edit tools)', function () {
  var msgs = [
    { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'explain' }] },
    { info: { id: 'a1', role: 'assistant' }, parts: [{ type: 'text', text: 'here' }] }
  ];
  var t = oc.extractTurn(msgs);
  assert.strictEqual(t.usedTools, false);
  assert.strictEqual(t.editedFiles, false);
});

test('opencode.extractTurn: staleUuid stops the walk (no leak across cycles)', function () {
  var msgs = [
    { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'req' }] },
    { info: { id: 'a1', role: 'assistant' }, parts: [{ type: 'tool', tool: 'write' }] },
    { info: { id: 'a2', role: 'assistant' }, parts: [{ type: 'text', text: 'done, nothing changed' }] }
  ];
  var t = oc.extractTurn(msgs, 'a1');
  assert.strictEqual(t.uuid, 'a2');
  assert.strictEqual(t.usedTools, false, 'prior turn tool use must not leak forward');
});

test('opencode.extractTurn: null when no assistant message', function () {
  assert.strictEqual(oc.extractTurn([{ info: { id: 'u1', role: 'user' }, parts: [] }]), null);
  assert.strictEqual(oc.extractTurn([]), null);
});

test('opencode.firstUserText: returns first user message text', function () {
  var msgs = [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'the original ask' }] },
    { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'ok' }] },
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'later nudge' }] }
  ];
  assert.strictEqual(oc.firstUserText(msgs), 'the original ask');
});

test('opencode.parseModelId: splits provider/model, null otherwise', function () {
  assert.deepStrictEqual(oc.parseModelId('anthropic/claude-haiku-4-5'), { providerID: 'anthropic', modelID: 'claude-haiku-4-5' });
  assert.strictEqual(oc.parseModelId('claude-haiku'), null);
  assert.strictEqual(oc.parseModelId(''), null);
});

// --- shared core.decide ---

function turnStub(turn) { return function () { return Promise.resolve(turn); }; }
function baseCtx(over) {
  return Object.assign({
    mode: 'lite', maxNudges: 3, state: { nudge_count: 0, turn_count: 0 },
    stopHookActive: false, nudgeOnReadOnly: true,
    getQuiet: function () { return true; },
    getTurn: turnStub({ text: 'x', usedTools: true, editedFiles: true, uuid: 't1', complete: true }),
    runSmartCheck: function () { return Promise.resolve({ status: 'ok' }); },
    log: function () {}
  }, over || {});
}

var run = [];

run.push(atest('core: cap reached exits without delivering', function () {
  var ctx = baseCtx({ maxNudges: 3, state: { nudge_count: 3, turn_count: 1 } });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.action, 'exit');
    assert.strictEqual(p.reason, 'cap_reached');
    assert.strictEqual(ctx.state.turn_count, 2);
  });
}));

run.push(atest('core: lite first nudge (readonly bypass) delivers soft quiet', function () {
  var ctx = baseCtx({ mode: 'lite', nudgeOnReadOnly: true });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.action, 'deliver');
    assert.strictEqual(p.deliver.blocking, false);
    assert.strictEqual(p.deliver.quiet, true);
    assert.strictEqual(p.deliver.text, engine.FIRST_NUDGE);
    assert.strictEqual(ctx.state.nudge_count, 1);
  });
}));

run.push(atest('core: first-nudge read-only gate exits when nothing edited', function () {
  var ctx = baseCtx({ mode: 'lite', nudgeOnReadOnly: false,
    getTurn: turnStub({ text: 'answer', usedTools: false, editedFiles: false, uuid: 't1', complete: true }) });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.action, 'exit');
    assert.strictEqual(p.reason, 'no_edit_activity');
  });
}));

run.push(atest('core: subsequent turn with confidence exits', function () {
  var ctx = baseCtx({ state: { nudge_count: 1, turn_count: 1 },
    getTurn: turnStub({ text: 'I am 100% certain everything is covered', usedTools: true, editedFiles: true, uuid: 't2', complete: true }) });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.action, 'exit');
    assert.strictEqual(p.reason, 'confidence_declared');
  });
}));

run.push(atest('core: subsequent turn with no tool activity exits', function () {
  var ctx = baseCtx({ state: { nudge_count: 1, turn_count: 1 },
    getTurn: turnStub({ text: 'looks fine', usedTools: false, editedFiles: false, uuid: 't2', complete: true }) });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.action, 'exit');
    assert.strictEqual(p.reason, 'no_tool_activity');
  });
}));

run.push(atest('core: flush timeout (null turn) exits', function () {
  var ctx = baseCtx({ state: { nudge_count: 1, turn_count: 1 }, getTurn: turnStub(null) });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.action, 'exit');
    assert.strictEqual(p.reason, 'flush_timeout');
  });
}));

run.push(atest('core: full mode delivers blocking with systemMessage', function () {
  var ctx = baseCtx({ mode: 'full', maxNudges: Infinity, getQuiet: function () { return false; } });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.deliver.blocking, true);
    assert.ok(p.deliver.systemMessage.indexOf('nudge 1/unlimited') !== -1);
  });
}));

run.push(atest('core: smart ok exits silently', function () {
  var ctx = baseCtx({ mode: 'smart', maxNudges: 2, runSmartCheck: function () { return Promise.resolve({ status: 'ok' }); } });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.action, 'exit');
    assert.strictEqual(p.reason, 'smart_ok');
    assert.strictEqual(ctx.state.nudge_count, 0);
  });
}));

run.push(atest('core: smart gap delivers blocking with the reason', function () {
  var ctx = baseCtx({ mode: 'smart', maxNudges: 2, runSmartCheck: function () { return Promise.resolve({ status: 'gap', reason: 'missing error handling' }); } });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.deliver.blocking, true);
    assert.ok(p.deliver.text.indexOf('missing error handling') !== -1);
    assert.strictEqual(ctx.state.nudge_count, 1);
  });
}));

run.push(atest('core: smart failed falls back to soft lite nudge', function () {
  var ctx = baseCtx({ mode: 'smart', maxNudges: 2,
    getQuiet: function (m) { return m === 'lite'; },
    runSmartCheck: function () { return Promise.resolve({ status: 'failed', error: 'boom' }); } });
  return core.decide(ctx).then(function (p) {
    assert.strictEqual(p.deliver.blocking, false);
    assert.strictEqual(p.deliver.quiet, true);
    assert.strictEqual(p.deliver.smart, true);
  });
}));

Promise.all(run).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
