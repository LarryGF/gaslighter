#!/usr/bin/env node
// gaslighter — UserPromptSubmit hook
// Tracks /gaslighter commands, increments turn count, reinforces per-turn

const { getDefaultMode, normalizeMode, isDeactivationCommand } = require('./gaslighter-config');
const { clearMode, setMode, loadState, saveState, writeHookOutput } = require('./gaslighter-runtime');

var input = '';
process.stdin.on('data', function (chunk) { input += chunk; });
process.stdin.on('end', function () {
  try {
    var data = JSON.parse(input.replace(/^﻿/, ''));
    var prompt = (data.prompt || '').trim().toLowerCase();

    var state = loadState();
    state.turn_count = (state.turn_count || 0) + 1;
    // Reset consecutive nudges on new user turn
    state.consecutive_nudges = 0;
    saveState(state);

    // /gaslighter commands
    if (/^[/@$]gaslighter/.test(prompt)) {
      var parts = prompt.split(/\s+/);
      var arg = parts[1] || '';
      var mode = null;

      if (arg === 'lite') mode = 'lite';
      else if (arg === 'full') mode = 'full';
      else if (arg === 'ultra') mode = 'ultra';
      else if (arg === 'off') mode = 'off';
      else mode = getDefaultMode();

      if (mode && mode !== 'off') {
        setMode(mode);
        writeHookOutput('GASLIGHTER MODE CHANGED — level: ' + mode);
      } else if (mode === 'off') {
        clearMode();
        writeHookOutput('GASLIGHTER MODE OFF');
      }
      return;
    }

    if (isDeactivationCommand(prompt)) {
      clearMode();
      writeHookOutput('GASLIGHTER MODE OFF');
      return;
    }
  } catch (e) {}
});
