#!/usr/bin/env node
// gaslighter — SessionStart activation hook
//
// 1. Writes flag file at $CLAUDE_CONFIG_DIR/.gaslighter-active
// 2. Cleans stale session state files (>24h old)
// 3. Emits gaslighter instructions as SessionStart context
// 4. Detects missing statusline config and emits setup nudge

const fs = require('fs');
const path = require('path');
const { getDefaultMode, getClaudeDir, isShellSafe } = require('./gaslighter-config');
const { getGaslighterInstructions } = require('./gaslighter-instructions');
const { clearMode, setMode, writeHookOutput, cleanStaleState } = require('./gaslighter-runtime');

var claudeDir = getClaudeDir();
var settingsPath = path.join(claudeDir, 'settings.json');
var mode = getDefaultMode();

if (mode === 'off') {
  clearMode();
  writeHookOutput('OK');
  process.exit(0);
}

try { setMode(mode); } catch (e) {}

cleanStaleState();

var output = getGaslighterInstructions(mode);

try {
  var hasStatusline = false;
  if (fs.existsSync(settingsPath)) {
    var raw = fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, '');
    var settings = JSON.parse(raw);
    if (settings.statusLine) hasStatusline = true;
  }

  if (!hasStatusline) {
    var isWindows = process.platform === 'win32';
    var scriptName = isWindows ? 'gaslighter-statusline.ps1' : 'gaslighter-statusline.sh';
    var scriptPath = path.join(__dirname, scriptName);
    if (isShellSafe(scriptPath)) {
      var command = isWindows
        ? 'powershell -ExecutionPolicy Bypass -File "' + scriptPath + '"'
        : 'bash "' + scriptPath + '"';
      var snippet = '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
      output += '\n\nSTATUSLINE SETUP NEEDED: The gaslighter plugin includes a statusline badge showing active mode ' +
        '(e.g. [GASLIGHTER], [GASLIGHTER:ULTRA]). It is not configured yet. ' +
        'To enable, add this to ~/.claude/settings.json: ' + snippet + ' ' +
        'Proactively offer to set this up for the user on first interaction.';
    } else {
      output += '\n\nSTATUSLINE SETUP NEEDED: The gaslighter plugin includes a statusline badge showing active mode. ' +
        'Its install path contains characters unsafe to embed in a shell command, so configure it manually: ' +
        'add a statusLine command of type "command" that runs ' + scriptName +
        ' from the plugin\'s hooks directory to ~/.claude/settings.json, quoting/escaping the path for your shell. ' +
        'Proactively offer to set this up for the user on first interaction.';
    }
  }
} catch (e) {}

try {
  writeHookOutput(output);
} catch (e) {}
