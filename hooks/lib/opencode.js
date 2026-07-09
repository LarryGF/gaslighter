// gaslighter — OpenCode-specific parsing helpers (pure, testable in Node).
//
// The OpenCode SDK returns a session's history as an array of
// { info: Message, parts: Part[] } objects rather than Claude's JSONL
// transcript. These helpers turn that into the same abstract "turn" shape the
// shared core consumes: { text, usedTools, editedFiles, complete, uuid }.
//
// Kept as CommonJS (not the ESM plugin) so the unit tests can exercise the
// extraction logic without a running OpenCode instance.

'use strict';

// Tools whose use counts as a file modification (the read-only gate). OpenCode's
// built-in mutating tools are lower-cased names.
var EDIT_TOOLS = { edit: 1, write: 1, bash: 1, patch: 1, multiedit: 1, notebookedit: 1 };

function messageRole(msg) {
  if (!msg) return undefined;
  if (msg.info && msg.info.role) return msg.info.role;
  return msg.role;
}

function messageId(msg) {
  if (!msg) return null;
  if (msg.info && msg.info.id) return msg.info.id;
  return msg.id || null;
}

function messageParts(msg) {
  if (!msg) return [];
  if (Array.isArray(msg.parts)) return msg.parts;
  if (msg.info && Array.isArray(msg.info.parts)) return msg.info.parts;
  return [];
}

function partToolName(part) {
  if (!part) return null;
  // Different OpenCode versions expose the tool name as `tool` or `name`.
  var name = part.tool || part.name;
  return name ? String(name).toLowerCase() : null;
}

// Builds the abstract turn from an ordered message list (oldest -> newest, as
// returned by client.session.messages). Aggregates every assistant message
// since the last real user message — matching the Claude adapter's notion of a
// "turn". staleUuid, when given, is the id of the last assistant message a
// prior nudge already judged; the walk stops there so an earlier tool call
// can't poison a later plain-text turn.
function extractTurn(messages, staleUuid) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  var texts = [];
  var usedTools = false;
  var editedFiles = false;
  var sawAssistant = false;
  var uuid = null;

  for (var i = messages.length - 1; i >= 0; i--) {
    var msg = messages[i];
    var role = messageRole(msg);
    if (role === 'assistant') {
      var id = messageId(msg);
      if (staleUuid && id === staleUuid) break; // already-judged boundary
      if (!sawAssistant) uuid = id;
      sawAssistant = true;
      var parts = messageParts(msg);
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        if (!p) continue;
        if (p.type === 'text' && p.text) texts.unshift(p.text);
        if (p.type === 'tool' || p.type === 'tool-invocation' || p.tool) {
          usedTools = true;
          var tn = partToolName(p);
          if (tn && EDIT_TOOLS[tn]) editedFiles = true;
        }
      }
    } else if (role === 'user') {
      break; // real user message = turn boundary
    }
  }

  if (!sawAssistant) return null;
  // session.idle fired, so the turn is by definition fully flushed.
  return { text: texts.join('\n'), usedTools: usedTools, editedFiles: editedFiles, complete: true, uuid: uuid };
}

// First real user message text in a session (smart-mode ground truth).
function firstUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (var i = 0; i < messages.length; i++) {
    if (messageRole(messages[i]) !== 'user') continue;
    var parts = messageParts(messages[i]);
    var text = parts.filter(function (p) { return p && p.type === 'text' && p.text; })
      .map(function (p) { return p.text; }).join('\n');
    if (text) return text;
  }
  return '';
}

// Splits a configured smart model id "provider/model" into SDK model coords.
// Returns null when no '/' is present (caller falls back / skips smart).
function parseModelId(id) {
  if (!id || typeof id !== 'string') return null;
  var idx = id.indexOf('/');
  if (idx === -1) return null;
  return { providerID: id.slice(0, idx), modelID: id.slice(idx + 1) };
}

module.exports = {
  EDIT_TOOLS: EDIT_TOOLS,
  messageRole: messageRole,
  messageId: messageId,
  messageParts: messageParts,
  partToolName: partToolName,
  extractTurn: extractTurn,
  firstUserText: firstUserText,
  parseModelId: parseModelId
};
