#!/usr/bin/env node
// gaslighter v1.0 — SessionStart activation hook

var fs = require('fs');
var path = require('path');
var os = require('os');

var claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
var mode = (process.env.GASLIGHTER_DEFAULT_MODE || 'on').toLowerCase();

if (mode === 'off') {
  try { fs.unlinkSync(path.join(claudeDir, '.gaslighter-active')); } catch (e) {}
  process.stdout.write('OK');
  process.exit(0);
}

// Write flag file
var flagPath = path.join(claudeDir, '.gaslighter-active');
try { fs.mkdirSync(path.dirname(flagPath), { recursive: true }); } catch (e) {}
fs.writeFileSync(flagPath, mode);

// Emit framing prompt
var output =
  'You have a requirement completeness checker active. When you finish implementing ' +
  'code changes, you\'ll be asked to verify you haven\'t missed anything. This is a ' +
  'helpful self-review, not criticism. When prompted, genuinely re-examine the original ' +
  'request rather than assuming you\'re done.';

// Statusline detection
try {
  var settingsPath = path.join(claudeDir, 'settings.json');
  var hasStatusline = false;
  if (fs.existsSync(settingsPath)) {
    var settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''));
    if (settings.statusLine) hasStatusline = true;
  }
  if (!hasStatusline) {
    var scriptName = process.platform === 'win32' ? 'gaslighter-statusline.ps1' : 'gaslighter-statusline.sh';
    var scriptPath = path.join(__dirname, scriptName);
    var command = process.platform === 'win32'
      ? 'powershell -ExecutionPolicy Bypass -File "' + scriptPath + '"'
      : 'bash "' + scriptPath + '"';
    var snippet = '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
    output += '\n\nSTATUSLINE SETUP NEEDED: Add this to ~/.claude/settings.json to show gaslighter mode badge: ' + snippet;
  }
} catch (e) {}

process.stdout.write(output);
