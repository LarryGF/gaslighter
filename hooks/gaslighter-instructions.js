const fs = require('fs');
const path = require('path');
const { DEFAULT_MODE, normalizeMode } = require('./gaslighter-config');

const SKILL_PATH = path.join(__dirname, '..', 'skills', 'gaslighter', 'SKILL.md');

function filterSkillBodyForMode(body, mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  const withoutFrontmatter = String(body || '').replace(/^---[\s\S]*?---\s*/, '');

  return withoutFrontmatter
    .split(/\r?\n/)
    .filter(function (line) {
      var tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
      if (tableLabel) {
        var labelMode = normalizeMode(tableLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }
      return true;
    })
    .join('\n');
}

function getFallbackInstructions(mode) {
  return 'GASLIGHTER MODE ACTIVE — level: ' + mode + '\n\n' +
    'You will receive reconsideration nudges before completing complex responses. ' +
    'These are HELPFUL, not adversarial. When nudged:\n' +
    '1. Re-read the original request\n' +
    '2. List every stated requirement\n' +
    '3. Check each requirement against what you actually implemented\n' +
    '4. Fix gaps — do NOT add unrequested features\n\n' +
    'Treat nudges as a self-review checkpoint, not criticism.\n\n' +
    'IMPORTANT: Implement first, verify after. Do NOT enter plan mode or create task lists ' +
    'because of these instructions. Write the code, then use nudges to verify completeness.';
}

function getGaslighterInstructions(mode) {
  var effectiveMode = normalizeMode(mode) || DEFAULT_MODE;

  try {
    return 'GASLIGHTER MODE ACTIVE — level: ' + effectiveMode + '\n\n' +
      filterSkillBodyForMode(fs.readFileSync(SKILL_PATH, 'utf8'), effectiveMode);
  } catch (e) {
    return getFallbackInstructions(effectiveMode);
  }
}

module.exports = {
  filterSkillBodyForMode,
  getFallbackInstructions,
  getGaslighterInstructions,
};
