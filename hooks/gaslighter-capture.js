#!/usr/bin/env node
// gaslighter — UserPromptSubmit hook: captures the original request text into
// session state so a later Stop nudge can quote it verbatim (defense in
// depth — after compaction the model may not have the original ask in
// context verbatim, and it's ground truth for a future LLM-gated check).

var nudge = require('./gaslighter-nudge');
var env = require('./lib/env');

var TRIVIAL_MIN_LENGTH = 80;
var CAPTURE_MAX_LENGTH = 2000;

// Background task/agent notifications get replayed into the transcript as a
// synthetic "user" turn to resume the session — the harness fires
// UserPromptSubmit for that turn same as a real one. Without this check,
// notification text (which easily clears TRIVIAL_MIN_LENGTH and doesn't
// start with "/") gets captured as last_request and quoted back to the
// model later as if it were the user's original ask.
var SYNTHETIC_PROMPT_PREFIXES = ['<task-notification', '<system-reminder', '[SYSTEM NOTIFICATION'];

function isTrivialPrompt(prompt) {
  var trimmed = (prompt || '').trim();
  if (trimmed.length < TRIVIAL_MIN_LENGTH) return true;
  if (trimmed.charAt(0) === '/') return true;
  for (var i = 0; i < SYNTHETIC_PROMPT_PREFIXES.length; i++) {
    if (trimmed.indexOf(SYNTHETIC_PROMPT_PREFIXES[i]) === 0) return true;
  }
  return false;
}

// Guarded the same way as gaslighter-nudge.js: requiring this file as a
// library (from tests) must not attach real stdin listeners on the host
// process.
if (require.main === module) {
  var input = '';
  process.stdin.on('data', function (chunk) { input += chunk; });
  process.stdin.on('end', function () {
    try {
      var payload = JSON.parse(input.replace(/^﻿/, ''));
      var sessionId = env.resolveSessionId(payload);
      var prompt = payload.prompt || '';
      if (!isTrivialPrompt(prompt)) {
        var state = nudge.loadState(sessionId);
        state.last_request = { prompt: prompt.slice(0, CAPTURE_MAX_LENGTH), ts: Date.now() };
        nudge.saveState(state, sessionId);
      }
    } catch (e) {}
    process.exit(0);
  });
}

// Exported for testing
if (typeof module !== 'undefined') {
  module.exports = { isTrivialPrompt: isTrivialPrompt, TRIVIAL_MIN_LENGTH: TRIVIAL_MIN_LENGTH, CAPTURE_MAX_LENGTH: CAPTURE_MAX_LENGTH };
}
