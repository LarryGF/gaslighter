// gaslighter — harness-agnostic decision engine.
//
// Pure logic only: nudge text, mode/cap/quiet/read-only resolution, confidence
// detection, and smart-check prompt build/parse. No filesystem access, no
// harness-specific I/O. Every consumer (the Claude Code Stop hook, the OpenCode
// plugin, tests) shares this module so the *decision* is identical everywhere;
// only delivery differs per harness.
//
// Config-resolution helpers read process.env for GASLIGHTER_* overrides (which
// are already harness-neutral) but never load config from disk — callers pass
// an already-loaded `cfg` object. This keeps the engine free of any storage or
// path assumptions.

'use strict';

var OVERCORRECTION_GUARD =
  " Don't invent features, refactors, or tests nobody asked for. But completing the " +
  "requested change everywhere it needs to happen — every call site, caller, serializer, " +
  "or related file it touches — is part of the request, not extra scope.";

var FIRST_NUDGE =
  "Hold on — are you absolutely sure you've addressed every single requirement " +
  "from the original request? Don't just assume you did. Go back, re-read what was asked, " +
  "and confirm each point is actually implemented. If anything is missing, fix it now." +
  OVERCORRECTION_GUARD;

var SUBSEQUENT_NUDGE =
  "One more check — go back to the original request and verify every requirement " +
  "is implemented. If after re-reading you are 100% certain everything is covered, " +
  "say so explicitly and finish. If anything is missing, fix it now." +
  OVERCORRECTION_GUARD;

var MODE_DEFAULT_MAX = { off: 0, lite: 3, full: Infinity, smart: 2 };

var DEFAULT_SMART_MODEL = 'claude-haiku-4-5';

var CONFIDENCE_RE = /\b100%\s*(certain|confident|sure)\b/i;

function parseBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  var s = String(value).toLowerCase();
  if (s === '1' || s === 'true') return true;
  if (s === '0' || s === 'false') return false;
  return fallback;
}

function parseMaxNudges(value) {
  if (value === 'infinite' || value === 'unlimited' || value === -1 || value === '-1') return Infinity;
  var n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

// cfg is an already-loaded config object ({} when none). Callers that support
// on-disk config pass it in; the engine never reads or writes storage.
function resolveMode(cfg) {
  return (process.env.GASLIGHTER_MODE || (cfg && cfg.mode) || 'lite').toLowerCase();
}

function resolveQuiet(mode, cfg) {
  var envVal = process.env.GASLIGHTER_QUIET;
  if (envVal !== undefined) return parseBool(envVal, mode === 'lite');
  if (cfg && cfg.quiet !== undefined) return parseBool(cfg.quiet, mode === 'lite');
  return mode === 'lite';
}

function resolveNudgeOnReadOnly(cfg) {
  var envVal = process.env.GASLIGHTER_NUDGE_ON_READONLY;
  if (envVal !== undefined) return parseBool(envVal, false);
  return parseBool(cfg && cfg.nudgeOnReadOnly, false);
}

function resolveMaxNudges(mode, cfg) {
  if (process.env.GASLIGHTER_MAX_NUDGES !== undefined) {
    var fromEnv = parseMaxNudges(process.env.GASLIGHTER_MAX_NUDGES);
    if (fromEnv !== undefined) return fromEnv;
  }
  if (cfg && cfg.maxNudges !== undefined && cfg.maxNudges !== null) {
    var fromCfg = parseMaxNudges(cfg.maxNudges);
    if (fromCfg !== undefined) return fromCfg;
  }
  return MODE_DEFAULT_MAX[mode];
}

// Smart-mode backing model/command are configurable so any CLI or provider can
// answer the completeness check — the Claude binary is just the default.
function resolveSmartModel(cfg) {
  return process.env.GASLIGHTER_SMART_MODEL || (cfg && cfg.smartModel) || DEFAULT_SMART_MODEL;
}

function resolveSmartCmd(cfg) {
  return process.env.GASLIGHTER_SMART_CMD || (cfg && cfg.smartCmd) || 'claude';
}

function confidenceDeclared(text) {
  return CONFIDENCE_RE.test(text || '');
}

function buildSmartCheckPrompt(originalRequest, lastTurnText) {
  return "Original request:\n---\n" + originalRequest + "\n---\n\n" +
    "Last turn's response:\n---\n" + lastTurnText + "\n---\n\n" +
    "Did the response address every explicit requirement in the request? Answer as JSON only: " +
    "{\"ok\": true} or {\"ok\": false, \"reason\": \"<the specific missing requirement(s)>\"}. " +
    "Missing = explicitly asked and not done. Extra unrequested work is not a missing requirement.";
}

// Parses `claude --output-format json` stdout: the wrapper's `result` field
// holds the model's reply text, which itself should be a JSON blob.
function parseSmartOutput(stdout) {
  var outer = JSON.parse(stdout);
  var resultText = typeof outer.result === 'string' ? outer.result : JSON.stringify(outer.result);
  return extractSmartJson(resultText);
}

// Shared by both adapters: pull the {ok,...} object out of a model's raw reply
// text (OpenCode returns the reply text directly rather than a CLI wrapper).
function extractSmartJson(resultText) {
  var match = String(resultText).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON object found in result');
  return JSON.parse(match[0]);
}

module.exports = {
  OVERCORRECTION_GUARD: OVERCORRECTION_GUARD,
  FIRST_NUDGE: FIRST_NUDGE,
  SUBSEQUENT_NUDGE: SUBSEQUENT_NUDGE,
  MODE_DEFAULT_MAX: MODE_DEFAULT_MAX,
  DEFAULT_SMART_MODEL: DEFAULT_SMART_MODEL,
  CONFIDENCE_RE: CONFIDENCE_RE,
  parseBool: parseBool,
  parseMaxNudges: parseMaxNudges,
  resolveMode: resolveMode,
  resolveQuiet: resolveQuiet,
  resolveNudgeOnReadOnly: resolveNudgeOnReadOnly,
  resolveMaxNudges: resolveMaxNudges,
  resolveSmartModel: resolveSmartModel,
  resolveSmartCmd: resolveSmartCmd,
  confidenceDeclared: confidenceDeclared,
  buildSmartCheckPrompt: buildSmartCheckPrompt,
  parseSmartOutput: parseSmartOutput,
  extractSmartJson: extractSmartJson
};
