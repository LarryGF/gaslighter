#!/usr/bin/env node
// gaslighter config CLI — thin wrapper around gaslighter-nudge's config helpers.

var nudge = require('./gaslighter-nudge');

var VALID_MODES = ['off', 'lite', 'full', 'smart'];

function validate(cfg) {
  if (cfg.mode !== undefined && VALID_MODES.indexOf(cfg.mode) === -1) {
    throw new Error('mode must be one of: ' + VALID_MODES.join(', '));
  }
  if (cfg.maxNudges !== undefined && cfg.maxNudges !== null) {
    if (cfg.maxNudges === 'infinite') {
      // ok
    } else if (typeof cfg.maxNudges === 'number' && Number.isInteger(cfg.maxNudges) && cfg.maxNudges > 0) {
      // ok
    } else {
      throw new Error('maxNudges must be a positive integer, "infinite", or omitted');
    }
  }
  if (cfg.quiet !== undefined && typeof cfg.quiet !== 'boolean') {
    throw new Error('quiet must be a boolean');
  }
  if (cfg.nudgeOnReadOnly !== undefined && typeof cfg.nudgeOnReadOnly !== 'boolean') {
    throw new Error('nudgeOnReadOnly must be a boolean');
  }
  if (cfg.smartModel !== undefined && (typeof cfg.smartModel !== 'string' || !cfg.smartModel)) {
    throw new Error('smartModel must be a non-empty string');
  }
  if (cfg.smartCmd !== undefined && (typeof cfg.smartCmd !== 'string' || !cfg.smartCmd)) {
    throw new Error('smartCmd must be a non-empty string');
  }
}

var args = process.argv.slice(2);

if (args[0] === '--get') {
  process.stdout.write(JSON.stringify(nudge.loadConfig()) + '\n');
} else if (args[0] === '--set') {
  var cfg;
  try {
    cfg = JSON.parse(args[1] || '{}');
  } catch (e) {
    process.stderr.write('Invalid JSON: ' + e.message + '\n');
    process.exit(1);
  }
  try {
    validate(cfg);
  } catch (e) {
    process.stderr.write(e.message + '\n');
    process.exit(1);
  }
  nudge.saveConfig(cfg);
  process.stdout.write(JSON.stringify(nudge.loadConfig()) + '\n');
} else {
  process.stderr.write('Usage: gaslighter-config-cli.js --get | --set \'{"mode":"lite","maxNudges":3}\'\n');
  process.exit(1);
}
