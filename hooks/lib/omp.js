// gaslighter — omp-specific parsing helpers (pure, testable in Node).
//
// omp's `session_stop` extension event hands over the full message list for
// the session (oldest -> newest) plus `last_assistant_message`, already
// settled (the event fires once the turn is finished, so unlike Claude's
// Stop hook there is no async-flush race to poll for). Tool results are
// their own message kind (`role: "toolResult"`), not embedded inside a user
// message the way Claude's JSONL nests `tool_result` blocks — so the walk
// only has to treat `role: "user"` as a real turn boundary.
//
// These helpers turn that message list into the same abstract "turn" shape
// the shared core consumes: { text, usedTools, editedFiles, complete, uuid }.
// Kept as CommonJS (not the extension module) so the unit tests can exercise
// the extraction logic without a running omp instance.

'use strict';

// Tools whose use counts as a file modification (the read-only gate). omp's
// built-in mutating tools use lower-cased names.
var EDIT_TOOLS = { edit: 1, write: 1, bash: 1 };

function contentBlocks(content) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (Array.isArray(content)) return content;
  return [];
}

// Builds the abstract turn from an ordered message list (oldest -> newest, as
// delivered on the session_stop event). Aggregates every assistant message
// since the last real user message boundary. staleIndex, when given, is the
// array index of the newest assistant message a prior nudge cycle already
// judged — the walk stops there instead of re-merging an already-judged turn
// into a later one.
function extractTurn(messages, staleIndex) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  var texts = [];
  var usedTools = false;
  var editedFiles = false;
  var sawAssistant = false;
  var newestAssistantIdx = -1;

  for (var i = messages.length - 1; i >= 0; i--) {
    if (staleIndex != null && i <= staleIndex) break;
    var msg = messages[i];
    if (!msg) continue;
    var role = msg.role;
    if (role === 'assistant') {
      if (newestAssistantIdx === -1) newestAssistantIdx = i;
      sawAssistant = true;
      var blocks = contentBlocks(msg.content);
      blocks.forEach(function (block) {
        if (!block) return;
        if (block.type === 'text' && block.text) texts.unshift(block.text);
        if (block.type === 'tool_use') {
          usedTools = true;
          var name = (block.name || '').toLowerCase();
          if (EDIT_TOOLS[name]) editedFiles = true;
        }
      });
    } else if (role === 'toolResult') {
      // Tool results are their own message kind in omp — continuation of the
      // same turn, not a boundary.
      continue;
    } else if (role === 'user') {
      break; // real user message = turn boundary
    }
  }

  if (!sawAssistant) return null;
  return {
    text: texts.join('\n'),
    usedTools: usedTools,
    editedFiles: editedFiles,
    complete: true, // session_stop fires post-settle; no async flush to await
    uuid: newestAssistantIdx >= 0 ? String(newestAssistantIdx) : null
  };
}

// First real user message text in a session (smart-mode ground truth when
// capture didn't fire, e.g. the extension loaded mid-session).
function firstUserText(messages) {
  if (!Array.isArray(messages)) return null;
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg && msg.role === 'user') {
      var blocks = contentBlocks(msg.content);
      var text = blocks.filter(function (b) { return b && b.type === 'text' && b.text; })
        .map(function (b) { return b.text; }).join('\n');
      if (text) return text;
    }
  }
  return null;
}

// staleUuid (a string index, or null) -> the numeric index for comparisons,
// or null when absent/unparseable.
function parseStaleIndex(staleUuid) {
  if (staleUuid == null) return null;
  var n = parseInt(staleUuid, 10);
  return Number.isNaN(n) ? null : n;
}

function parseSmartStreamOutput(stdout) {
  var lines = String(stdout).split('\n');
  var lastMessage = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var evt;
    try { evt = JSON.parse(line); } catch (e) { continue; }
    if (evt.type === 'turn_end' && evt.message) lastMessage = evt.message;
    else if (evt.type === 'agent_end' && Array.isArray(evt.messages) && evt.messages.length) {
      var last = evt.messages[evt.messages.length - 1];
      if (last && last.role === 'assistant') lastMessage = last;
    }
  }
  if (!lastMessage) throw new Error('no assistant turn found in omp json stream');
  var text = contentBlocks(lastMessage.content)
    .filter(function (b) { return b && b.type === 'text' && b.text; })
    .map(function (b) { return b.text; })
    .join('\n');
  if (!text) throw new Error('assistant turn had no text content');
  return text;
}

module.exports = {
  EDIT_TOOLS: EDIT_TOOLS,
  extractTurn: extractTurn,
  firstUserText: firstUserText,
  parseStaleIndex: parseStaleIndex,
  parseSmartStreamOutput: parseSmartStreamOutput
};