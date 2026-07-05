#!/usr/bin/env node
// gaslighter — UserPromptSubmit hook: captures the original request text into
// session state so a later Stop nudge can quote it verbatim (defense in
// depth — after compaction the model may not have the original ask in
// context verbatim, and it's ground truth for a future LLM-gated check).

var nudge = require('./gaslighter-nudge');

var TRIVIAL_MIN_LENGTH = 80;
var CAPTURE_MAX_LENGTH = 2000;

function isTrivialPrompt(prompt) {
  var trimmed = (prompt || '').trim();
  if (trimmed.length < TRIVIAL_MIN_LENGTH) return true;
  if (trimmed.charAt(0) === '/') return true;
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
      var sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
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
