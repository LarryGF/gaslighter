# Gaslighter Plugin

Claude Code plugin that uses Stop hooks to nudge Claude into verifying requirement completeness.

## How It Works — Hybrid Nudge Pattern

Gaslighter uses **progressive escalation** from cheap → expensive:

### First Nudge (Deterministic)
When thresholds met (files edited, tool calls, task list present):
- Uses pattern-matching on transcript (existing logic)
- Selects nudge based on context: plan_adherence, integration, root_cause, requirements, or general
- **Cost:** $0 (deterministic)

### Second Nudge (LLM Judge)
If deterministic nudge didn't resolve the issue:
- Hook returns agent config (agent-based hook pattern)
- Claude Code spawns Haiku agent with structured output schema
- Agent judges: `{ complete: bool, missing: string[], action: "continue"|"nudge"|"done" }`
- If judge says "done" → let through (agent was right, no second nudge)
- If judge says "incomplete" → nudge with specific missing requirements
- **Cost:** ~$0.001 per judge call (Haiku agent)

### Third Strike
If two nudges already fired:
- Let response through (either agent is correct or genuinely stuck)
- Avoids infinite nudge loops

### Cost Analysis
- Most conversations: 1 deterministic nudge, agent fixes → **$0/run**
- Stubborn cases: 1 deterministic + 1 LLM judge → **$0.001/run**
- Average across 120-cell eval: ~**$0.0005/run** (negligible vs. $0.10 full run cost)

## Autonomous Eval-Driven Improvement Workflow

Use this workflow to iteratively improve gaslighter based on eval results.

### Step 1: Run evals

```bash
cd evals && python3 run.py --task hard-* --models haiku,sonnet --runs 4
```

Output: `runs/<timestamp>/` with 120 cells (5 tasks × 3 arms × 2 models × 4 runs)

### Step 2: Judge completeness

```
/gaslighter:judge runs/<timestamp>
```

This reads task prompts, judges each workspace for completeness (0-3) and overcorrection (0-3), writes `judge.json`, and displays aggregate statistics by arm.

### Step 3: Classify failures

Read `runs/<timestamp>/judge.json` and classify each gaslighter failure:

**Threshold miss** (nudge should have fired but didn't):
- Check: `grep -i "GASLIGHTER CHECK" runs/<timestamp>/<task>__gaslighter__<model>__<run>/_claude.stderr.txt`
- If empty: thresholds too high or signals missing
- **Fix:** Lower thresholds in `hooks/gaslighter-config.js` THRESHOLDS object, or add new signals to `analyzeTranscript()` in `hooks/gaslighter-nudge.js`

**Ineffective deterministic nudge** (first nudge fired but didn't catch gap):
- Check stderr for `GASLIGHTER CHECK: <type>` (not "LLM Judge")
- Agent saw nudge but still missed requirements
- **Fix:** Update nudge prompt in `NUDGES` object in `hooks/gaslighter-nudge.js` to be more specific about what to check

**Ineffective LLM judge** (second nudge fired but judge missed gaps):
- Check stderr for `GASLIGHTER CHECK (LLM Judge):`
- Judge said "done" or gave wrong missing list
- **Fix:** Update `buildLLMJudgePrompt()` in `hooks/gaslighter-nudge.js` to give judge better context or instructions

**Overcorrection** (nudge caused unnecessary restructuring):
- Check workspace: files split when task wanted single file, or vice versa
- **Fix:** Add constraint to nudge prompts: "Re-read original request for file structure requirements FIRST"

**Late firing** (nudge fired after implementation complete):
- Can't fix with Stop hook (fires at end of response)
- **Fix:** Requires PreWrite or TaskCreate hooks (future work)

### Step 4: Implement fixes

Based on classification, edit the relevant files:
- Thresholds: `hooks/gaslighter-config.js`
- Deterministic nudge prompts: `hooks/gaslighter-nudge.js` NUDGES object
- LLM judge prompt: `hooks/gaslighter-nudge.js` buildLLMJudgePrompt()
- Transcript analysis signals: `hooks/gaslighter-nudge.js` analyzeTranscript()

### Step 5: Re-run evals

```bash
cd evals && python3 run.py --task hard-* --models haiku,sonnet --runs 4
```

Compare new `runs/<timestamp>/summary.json` against previous run. Repeat Steps 2-5 until:
- Gaslighter complete_rate ≥ baseline on all tasks
- No regressions on tasks that were already working

### Step 6: Ship

When gaslighter ≥ baseline:
- Document improvements in `docs/vX.X.X-<name>.md`
- Update version in `.claude-plugin/plugin.json`
- Commit and push

## Quick Start — Validate v0.2.1 Improvements

To verify the threshold/nudge improvements fixed the eval regression:

### 1. Run evals on both haiku and sonnet

```bash
cd evals && python3 run.py --task hard-* --models haiku,sonnet --runs 4
```

This creates `runs/<timestamp>/` with **120 cells**:
- 5 tasks × 3 arms × 2 models × 4 runs
- ~10 minutes wall clock (4 workers in parallel)
- ~$10 total cost ($5 haiku + $5 sonnet)

### 2. Analyze results

After evals complete, analyze the results systematically:

#### a) Summary statistics
```bash
cd evals/runs/<timestamp>
cat summary.json | jq '.[] | select(.model=="haiku") | {task, arm, complete_rate_mean, correct_rate, turns_mean}'
```

**Expected outcome**: Gaslighter arm should match or exceed baseline:
- `complete_rate_mean` ≥ 0.94 (baseline is 0.94-1.00)
- `correct_rate` ≥ 0.94
- No significant overcorrection

#### b) Identify failure patterns
Find cells where gaslighter < baseline completion:
```bash
cd evals
python3 -c "
import json
from pathlib import Path
r = json.loads((Path('runs/<timestamp>/results.json')).read_text())
failures = [x for x in r['results'] if x['arm']=='gaslighter' and x.get('complete_rate',0) < 0.9]
for f in sorted(failures, key=lambda x: x.get('complete_rate', 0)):
    print(f\"{f['task']:30} {f.get('complete_rate', 0):.2f}  {f.get('reason', 'N/A')}\")
"
```

#### c) Deep-dive on specific failures
For cells with low completion rates, inspect the workspace:
```bash
cd runs/<timestamp>/hard-service-refactor__gaslighter__haiku__0
ls -la                    # see what files were created
cat services/*.py         # check implementation
cat _claude.stderr.txt    # check for errors
```

**Common failure patterns to look for** (from prior analysis):
1. **File structure mismatch**: Code split across files when task expected single file
2. **Missing implicit requirements**: Scorer looks for patterns not explicitly stated (e.g., "decorator in same file as usage")
3. **Cross-file integration gaps**: Event handler doesn't validate related model existence
4. **Early termination**: Only 1-2 endpoints implemented when task asked for multiple

#### d) Compare gaslighter vs baseline on same task
```bash
diff -r runs/<timestamp>/hard-api-integration__baseline__haiku__0/ \
        runs/<timestamp>/hard-api-integration__gaslighter__haiku__0/
```

#### e) Check nudge firing patterns
For gaslighter failures, check if nudge actually fired:
```bash
cd runs/<timestamp>/hard-service-refactor__gaslighter__haiku__0
grep -i "GASLIGHTER CHECK" _claude.stderr.txt
```

**Nudge types to look for:**
- `GASLIGHTER CHECK: <type>` — First nudge (deterministic)
- `GASLIGHTER CHECK (LLM Judge):` — Second nudge (LLM judge with specific missing items)

**Diagnostic patterns:**
- No nudge found: threshold didn't trigger (threshold calibration issue)
- First nudge only, still failed: nudge content ineffective (prompt design issue)
- Second nudge (LLM judge) fired: hybrid escalation working, check if missing items were correct
- Two nudges fired, still failed: either agent stuck or task genuinely ambiguous (third strike rule applied)

### 3. Root cause classification

Based on analysis, classify each failure:
- **Threshold miss**: Nudge should have fired but didn't (files/tools below threshold) — v0.2.1 LLM judge should catch these
- **Late firing**: Nudge fired after implementation complete (Stop hook timing)
- **Ineffective nudge (deterministic)**: First nudge fired but didn't catch the gap (prompt content issue)
- **Ineffective nudge (LLM judge)**: Second nudge fired but LLM judge missed gaps or gave wrong assessment
- **Overcorrection**: Nudge caused unnecessary restructuring (e.g., split to multi-file when task wanted single file)

### 4. Decision tree

If gaslighter ≥ baseline on both models:
- ✅ v0.2.1 fixes worked, ready to ship

If gaslighter < baseline:
- Threshold misses → LLM judge should have caught on second nudge, check judge prompt
- Late firing → can't fix with Stop hook, need PreWrite/TaskCreate hooks
- Ineffective nudge (deterministic) → rewrite nudge prompts with more specific checks
- Ineffective nudge (LLM judge) → iterate on judge prompt or add more context
- Overcorrection → add "re-read original requirements FIRST" to all nudges

See `docs/archive/eval-findings-20260623-175006.md` for detailed v0.2.0 failure mode analysis.
See `docs/v0.2.1-hybrid-nudge.md` for hybrid pattern design.

## Structure

- `.claude-plugin/plugin.json` — plugin manifest
- `hooks/` — all hook scripts (Node.js, CommonJS)
  - `gaslighter-nudge.js` — core Stop hook decision engine
  - `gaslighter-activate.js` — SessionStart activation
  - `gaslighter-mode-tracker.js` — UserPromptSubmit mode tracking
  - `gaslighter-precompact.js` — PreCompact goal preservation
  - `gaslighter-config.js` — shared config resolution
  - `gaslighter-runtime.js` — shared state/flag file ops
  - `gaslighter-instructions.js` — SKILL.md reader + mode filtering
- `skills/gaslighter/SKILL.md` — behavioral instructions injected at session start
- `evals/` — benchmark suite (tasks.py, run.py, judge.py)
- `tests/` — unit tests for decision algorithm

## Running tests

**Unit tests** (threshold decision logic):
```bash
node tests/test-nudge-decision.js
```

**Eval suite** (requirement completeness benchmarks):
```bash
cd evals

# Validate scorers (no API spend)
python3 run.py --selftest

# Run pilot evals (5 easy tasks × 3 arms × 4 runs)
python3 run.py --pilot --runs 4

# Run all hard tasks
python3 run.py --task hard-* --runs 4

# Results written to runs/<timestamp>/
```

**Judging results** (LLM-based evaluation of completeness + overcorrection):

After running evals, use the `gaslighter:judge` skill to analyze results:
```
/gaslighter:judge runs/<timestamp>
```

This reads task prompts, judges each workspace for completeness (0-3) and overcorrection (0-3), writes `judge.json` to the run directory, and displays aggregate statistics by arm.

**Expected outcome**: Gaslighter arm should match or exceed baseline completion rate (target: 94-100%) without triggering overcorrection.

**Processing results**: See "Quick Start" section above for systematic analysis workflow including:
- Summary statistics extraction
- Failure pattern identification
- Workspace inspection
- Baseline comparison
- Nudge firing verification
- Root cause classification

## Key conventions

- Hook paths use `${CLAUDE_PLUGIN_ROOT}`, never `CLAUDE_SKILL_DIR`
- Session state stored in `${CLAUDE_PLUGIN_DATA}/state-{session_id}.json`
- Flag file at `$CLAUDE_CONFIG_DIR/.gaslighter-active`
- All hooks have `commandWindows` equivalents
