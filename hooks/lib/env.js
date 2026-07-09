// gaslighter — harness-agnostic environment resolution.
//
// Resolves where state/config live and what the session id is, using a
// generic-first precedence chain so the plugin isn't bound to Claude Code's
// env vars:
//
//   data dir : GASLIGHTER_DATA_DIR  >  CLAUDE_PLUGIN_DATA  >  neutral default
//   session  : (explicit id)  >  GASLIGHTER_SESSION_ID  >  CLAUDE_SESSION_ID  >  'unknown'
//
// The neutral default follows the XDG data-dir convention (or the OS-native
// equivalent) so a non-Claude host that sets neither env var still gets a
// stable, per-user location. Adapters that already know their data dir (e.g.
// the OpenCode plugin, which derives it from the SDK context) can bypass this
// and pass a dir straight to the store.

'use strict';

var os = require('os');
var path = require('path');

function neutralDataDir() {
  if (process.platform === 'win32') {
    var base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'gaslighter');
  }
  var xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'gaslighter');
}

function resolveDataDir() {
  return process.env.GASLIGHTER_DATA_DIR ||
    process.env.CLAUDE_PLUGIN_DATA ||
    neutralDataDir();
}

// Accepts either a raw id string or a hook payload ({ session_id }).
function resolveSessionId(payloadOrId) {
  var explicit = null;
  if (typeof payloadOrId === 'string') explicit = payloadOrId;
  else if (payloadOrId && payloadOrId.session_id) explicit = payloadOrId.session_id;
  return explicit ||
    process.env.GASLIGHTER_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID ||
    'unknown';
}

module.exports = {
  neutralDataDir: neutralDataDir,
  resolveDataDir: resolveDataDir,
  resolveSessionId: resolveSessionId
};
