const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_MODE = 'full';
const VALID_MODES = ['off', 'lite', 'full', 'ultra'];
const SESSION_NUDGE_CAP = 10;
const CONSECUTIVE_NUDGE_CAP = 2;

// lite: nudge when files_edited >= 2 OR (task_list_present AND tool_calls >= 4)
// full: nudge when task_list_present OR (files_edited >= 1 AND tool_calls >= 3)
// ultra: nudge when tool_calls >= 1 OR response_length > 500
const THRESHOLDS = {
  lite:  { files: 2, tools: 4, toolsRequiresTask: true },
  full:  { files: 1, tools: 3, toolsRequiresTask: false, requiresBoth: true },
  ultra: { files: 0, tools: 1, toolsRequiresTask: false, responseLength: 500 },
};

function normalizeMode(mode) {
  if (typeof mode !== 'string') return null;
  const normalized = mode.trim().toLowerCase();
  return VALID_MODES.includes(normalized) ? normalized : null;
}

function isDeactivationCommand(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return t === 'stop gaslighter' || t === 'normal mode';
}

function isShellSafe(p) {
  return typeof p === 'string' && /^[A-Za-z0-9 _.\-:/\\~]+$/.test(p);
}

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'gaslighter');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'gaslighter'
    );
  }
  return path.join(os.homedir(), '.config', 'gaslighter');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function getClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function getDataDir() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data', 'gaslighter');
}

function getSessionId() {
  return process.env.CLAUDE_SESSION_ID || 'unknown';
}

function getDefaultMode() {
  const envMode = process.env.GASLIGHTER_DEFAULT_MODE;
  if (envMode && VALID_MODES.includes(envMode.toLowerCase())) {
    return envMode.toLowerCase();
  }
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
    if (config.defaultMode && VALID_MODES.includes(config.defaultMode.toLowerCase())) {
      return config.defaultMode.toLowerCase();
    }
  } catch (e) {}
  return DEFAULT_MODE;
}

module.exports = {
  DEFAULT_MODE,
  VALID_MODES,
  SESSION_NUDGE_CAP,
  CONSECUTIVE_NUDGE_CAP,
  THRESHOLDS,
  normalizeMode,
  isDeactivationCommand,
  isShellSafe,
  getConfigDir,
  getConfigPath,
  getClaudeDir,
  getDataDir,
  getSessionId,
  getDefaultMode,
};
