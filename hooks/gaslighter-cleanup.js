#!/usr/bin/env node
// gaslighter — SessionEnd hook: delete this session's state file and any
// state-*.json left behind from sessions older than 7 days.

var fs = require('fs');
var path = require('path');
var nudge = require('./gaslighter-nudge');

var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

var input = '';
process.stdin.on('data', function (chunk) { input += chunk; });
process.stdin.on('end', function () {
  try {
    var payload = JSON.parse(input.replace(/^﻿/, ''));
    var sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID || 'unknown';
    var dataDir = nudge.getDataDir();

    try { fs.unlinkSync(nudge.getStatePath(sessionId)); } catch (e) {}

    var now = Date.now();
    var files = [];
    try { files = fs.readdirSync(dataDir); } catch (e) {}
    files.forEach(function (name) {
      if (!/^state-.*\.json$/.test(name)) return;
      var p = path.join(dataDir, name);
      try {
        if (now - fs.statSync(p).mtimeMs > MAX_AGE_MS) fs.unlinkSync(p);
      } catch (e) {}
    });
  } catch (e) {}
  process.exit(0);
});
