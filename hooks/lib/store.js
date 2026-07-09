// gaslighter — harness-agnostic persistence.
//
// createStore(dataDir) returns state/config readers and writers bound to a
// single data directory. Keeping the directory explicit (rather than reading
// env vars in here) lets any harness supply its own location: the Claude Code
// hooks resolve it via lib/env.js, while the OpenCode plugin derives it from
// the SDK context.
//
// State files are per-session (state-<id>.json); config is a single shared
// config.json in the same directory.

'use strict';

var fs = require('fs');
var path = require('path');

function createStore(dataDir) {
  function getDataDir() {
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
    return dataDir;
  }

  function getStatePath(sessionId) {
    return path.join(getDataDir(), 'state-' + (sessionId || 'unknown') + '.json');
  }

  function loadState(sessionId) {
    try {
      return JSON.parse(fs.readFileSync(getStatePath(sessionId), 'utf8'));
    } catch (e) {
      return { nudge_count: 0, turn_count: 0 };
    }
  }

  function saveState(state, sessionId) {
    var p = getStatePath(sessionId);
    try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch (e) {}
    fs.writeFileSync(p, JSON.stringify(state));
  }

  function getConfigPath() {
    return path.join(getDataDir(), 'config.json');
  }

  function loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
    } catch (e) {
      return {};
    }
  }

  function saveConfig(cfg) {
    var p = getConfigPath();
    try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch (e) {}
    fs.writeFileSync(p, JSON.stringify(cfg));
  }

  return {
    getDataDir: getDataDir,
    getStatePath: getStatePath,
    loadState: loadState,
    saveState: saveState,
    getConfigPath: getConfigPath,
    loadConfig: loadConfig,
    saveConfig: saveConfig
  };
}

module.exports = { createStore: createStore };
