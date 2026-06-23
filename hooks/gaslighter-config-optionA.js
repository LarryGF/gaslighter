// Option A: Lower tools threshold from 3 to 2
const THRESHOLDS = {
  lite:  { files: 2, tools: 4, toolsRequiresTask: true },
  full:  { files: 1, tools: 2, toolsRequiresTask: false, requiresBoth: true },  // tools: 3 → 2
  ultra: { files: 0, tools: 1, toolsRequiresTask: false, responseLength: 500 },
};

module.exports = { THRESHOLDS };
