# Changelog

## [0.2.0] - 2026-06-23

### Summary

Performance fixes targeting eval regression (v0.1.0: 78.5-96.5% vs baseline 94-100%). Implemented fixes for 3 of 5 failure modes identified in root cause analysis. Target: match or exceed baseline.

### Fixed

**1. Threshold Recalibration** (Failure Mode 2)

Problem: OR logic fired too early on single-turn tasks.

- **Full mode**: `files >= 2 OR tools >= 3` → `(files >= 1 AND tools >= 3) OR task_list_present`
- **Lite mode**: `files >= 3` → `files >= 2`, `tools >= 5` → `tools >= 4`
- **Rationale**: AND requires BOTH signals (files + tools), reducing false positives. Task list always triggers (high signal).

Files: `hooks/gaslighter-config.js:9-17`, `hooks/gaslighter-nudge.js:159-173`

**2. Nudge Prompt Rewrite** (Failure Mode 3 - Overcorrection)

Problem: Generic nudges caused unnecessary restructuring (e.g., splitting single file to multi-file when task expected single file).

- **Integration nudge**: Now checks "did it specify file structure?" FIRST before validating multi-file
- **All nudges**: Rewritten as numbered checklists with specific verification steps
- **Format**: "Re-read request → enumerate requirements → mark [DONE]/[PARTIAL]/[MISSING] → fix gaps"

Files: `hooks/gaslighter-nudge.js:178-209`

Example before/after:
```diff
- GASLIGHTER CHECK: You edited multiple files. Trace the data flow between them...
+ GASLIGHTER CHECK: You edited multiple files. Before finishing:
+ 1. Re-read the original request — did it specify "same file", "in X.py", or other file structure constraints?
+ 2. If it specified structure, verify you followed it exactly
+ 3. If structure was unspecified, verify: imports correct? Function signatures match call sites?
```

**3. Early Termination Detection** (Failure Mode 1 - partial)

Problem: Stop hook fires AFTER Claude commits to "done", can't prevent early termination.

- Added detection: if `tool_calls < 5 AND files < 2`, prepend "⚠️ EARLY STOP DETECTED" to nudge
- Can't prevent (Stop hook timing limitation) but flags for reconsideration

Files: `hooks/gaslighter-nudge.js:211-228`

**4. Reduced Activation Overhead** (Failure Mode 5)

- Removed duplicate "GASLIGHTER MODE ACTIVE" prefix from SessionStart output

Files: `hooks/gaslighter-activate.js:15-16`

### Changed

- Plugin description updated to clarify multi-turn focus and opt-in nature
- Version bumped to 0.2.0
- All tests updated and passing (23/23)

### Documentation

**New files**:
- `docs/eval-findings-2026-06-23.md` — v0.1.0 eval results (5 tasks, 3 arms, 4 runs)
- `docs/root-cause-analysis-2026-06-23.md` — 5 failure modes with detailed analysis
- `docs/v0.2.0-implementation.md` — this session's implementation notes

**Updated**:
- `README.md` — threshold table updated to match new config
- `CLAUDE.md` — added comprehensive eval workflow:
  - Multi-model testing (`--models haiku,sonnet`)
  - Systematic analysis steps (summary stats, failure patterns, workspace inspection, nudge verification)
  - Root cause classification framework
  - Decision tree for next steps

### Testing

**Unit tests**: 23 tests, all passing
- Threshold logic (lite, full, ultra modes)
- Nudge selection priority
- Early termination detection
- Edge cases (unknown mode, empty analysis)

**Eval plan** (not yet run):
```bash
cd evals && python3 run.py --task hard-* --models haiku,sonnet --runs 4
```
120 cells (5 tasks × 3 arms × 2 models × 4 runs), ~$10, ~10 min

### Known Issues (Not Fixed)

**Failure Mode 1 (Early Termination)** — Stop hook fires AFTER Claude finishes, not before. Can't fix without new hook primitives (PreWrite, TaskCreate). Workaround: detection flag only.

**Failure Mode 4 (Static > Dynamic)** — Static nudge-prompt outperformed dynamic hooks on some tasks (97% vs 91% on hard-webhook-feature). If v0.2.0 evals still show this, consider shipping static approach as alternative.

### Success Criteria

**Minimum viable**: Gaslighter ≥ 90% completion (up from 78.5-96.5%)  
**Target**: Gaslighter ≥ baseline (94-100%)  
**Stretch**: Gaslighter > baseline (catches requirements baseline missed)

### Next Steps

1. **Validate**: Run evals on haiku + sonnet, analyze results per CLAUDE.md workflow
2. **If gaslighter ≥ baseline**: ✅ ship v0.2.0
3. **If still underperforming**:
   - Threshold miss → lower thresholds further
   - Late firing → unfixable with current hooks, prototype PreWrite
   - Ineffective nudge → iterate on prompt design
   - Overcorrection → add more "re-read requirements" emphasis
4. **Long-term**: Multi-turn eval suite, PreWrite/TaskCreate hooks, static nudge-prompt mode

---

## [0.1.0] - 2026-06-20

Initial release — Stop hook-based reconsideration nudges with three modes (lite/full/ultra).
