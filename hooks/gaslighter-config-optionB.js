// Option B: Drop requiresBoth (OR logic instead of AND)
const THRESHOLDS = {
  lite:  { files: 2, tools: 4, toolsRequiresTask: true },
  full:  { files: 1, tools: 3, toolsRequiresTask: false, requiresBoth: false },  // requiresBoth: true → false
  ultra: { files: 0, tools: 1, toolsRequiresTask: false, responseLength: 500 },
};

module.exports = { THRESHOLDS };
