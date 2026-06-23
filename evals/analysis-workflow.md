# Eval Analysis Workflow

Systematic approach to analyzing gaslighter eval results.

## 1. Summary Statistics

Extract completion rates by arm/model:

```bash
RUN_DIR=runs/20260623-XXXXXX
python3 analyze.py summary $RUN_DIR
```

**Look for:**
- Gaslighter complete_rate ≥ baseline (target: 94-100%)
- No significant overcorrection (gaslighter shouldn't be much higher than baseline)
- Similar performance across haiku and sonnet

## 2. Identify Failures

Find cells where gaslighter underperformed:

```bash
python3 analyze.py failures $RUN_DIR 0.9
```

**Classify each failure:**
- **Threshold miss**: Nudge should have fired but didn't
- **Late firing**: Nudge fired after implementation complete
- **Ineffective nudge**: Nudge fired but didn't catch the gap
- **Overcorrection**: Nudge caused unnecessary restructuring

## 3. Check Nudge Firing

For each gaslighter failure, verify if nudge actually fired:

```bash
./inspect.sh check_nudge $RUN_DIR/hard-api-integration__gaslighter__haiku__0
```

If no "GASLIGHTER CHECK" found → threshold didn't trigger → adjust thresholds  
If found → nudge content ineffective → rewrite nudge prompts

## 4. Compare Implementations

For specific failures, compare baseline vs gaslighter:

```bash
./inspect.sh compare_files $RUN_DIR hard-api-integration haiku 0
```

Look for:
- File structure differences (single vs multi-file)
- Missing integrations (imports, function calls)
- Architectural mismatches (inline vs separate modules)

## 5. Inspect Workspaces

Deep-dive on specific failures:

```bash
cd $RUN_DIR/hard-service-refactor__gaslighter__haiku__0
./inspect.sh show_impl .
```

Cross-reference with scorer implementation in `tasks_hard.py` to see exactly what check failed.

## 6. Root Cause Classification

After analyzing failures, tally them by category:

- **Threshold misses**: Count of failures where nudge didn't fire
- **Late firing**: Count where nudge fired but too late
- **Ineffective nudges**: Count where nudge fired but didn't help
- **Overcorrection**: Count where gaslighter > baseline (unnecessary work)

## 7. Decision Tree

Based on tallies:

**If gaslighter ≥ baseline:**
- ✅ v0.2.0 fixes worked, ready to ship

**If threshold misses dominate:**
- Lower thresholds further
- Add new signals (e.g., task list creation, file count changes)

**If late firing dominates:**
- Can't fix with Stop hook alone
- Need PreWrite or TaskCreate hooks

**If ineffective nudges dominate:**
- Rewrite nudge prompts
- Add specific checks (e.g., "verify imports between edited files")
- Reference seed file patterns explicitly

**If overcorrection appears:**
- Add "re-read original requirements FIRST" to all nudges
- Emphasize "do NOT add unrequested features"

## 8. Document Findings

Create `docs/eval-findings-YYYY-MM-DD.md` with:
- Summary statistics table
- Specific failure examples
- Root cause classification counts
- Improvement recommendations with expected impact
