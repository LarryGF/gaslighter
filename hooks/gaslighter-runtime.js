const fs = require('fs');
const path = require('path');
const { getClaudeDir, getDataDir, getSessionId } = require('./gaslighter-config');

const FLAG_FILE = '.gaslighter-active';

function getFlagPath() {
  return path.join(getClaudeDir(), FLAG_FILE);
}

function setMode(mode) {
  const p = getFlagPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, mode);
}

function clearMode() {
  try { fs.unlinkSync(getFlagPath()); } catch (e) {}
}

function getStatePath() {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'state-' + getSessionId() + '.json');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
  } catch (e) {
    return {
      nudge_count: 0,
      turn_count: 0,
      last_nudge_turn: -1,
      consecutive_nudges: 0,
      llm_judge_count: 0,
      last_llm_judge_turn: -1
    };
  }
}

function saveState(state) {
  const p = getStatePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

function cleanStaleState() {
  const dataDir = getDataDir();
  try {
    const files = fs.readdirSync(dataDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (!f.startsWith('state-')) continue;
      const fp = path.join(dataDir, f);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAge) fs.unlinkSync(fp);
      } catch (e) {}
    }
  } catch (e) {}
}

function writeHookOutput(context) {
  process.stdout.write(context);
}

function writeBlockOutput(reason) {
  process.stderr.write(JSON.stringify({ decision: 'block', reason: reason }));
  process.exitCode = 2;
}

function writeNonBlockOutput(context) {
  process.stdout.write(JSON.stringify({ additionalContext: context }));
}

module.exports = {
  setMode,
  clearMode,
  getStatePath,
  loadState,
  saveState,
  cleanStaleState,
  writeHookOutput,
  writeBlockOutput,
  writeNonBlockOutput,
};
