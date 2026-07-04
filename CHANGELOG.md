# Changelog

## [1.1.4] - 2026-07-04

### Added

- **Tool-activity escape hatch**: after the first nudge, if the model's answering turn contains zero tool calls, the hook stops nudging — it re-checked and changed nothing, so the exact wording of its confirmation no longer matters. The "100% certain" regex remains as a fast-path. Unreadable/missing transcripts are treated as unknown and keep nudging.

### Fixed

- **Infinite full-mode nudge loop.** Measured live: the harness flushes the turn's final text entry to `transcript_path` ~200ms *after* the Stop hook starts, so any immediate read sees a mid-flush or previous-turn file and the escape hatches never trigger (observed: 9 blind nudges on a bare "hi" until the harness force-override). Replaced `readStable()`'s blind length-based retries with `waitForTurn()`: poll every 150ms (up to 5s, tunable via `GASLIGHTER_FLUSH_WAIT_MS`) until the last turn's newest entry is an assistant *text* entry (= fully flushed), then judge it. On timeout the hook now fails quiet (no nudge) instead of nudging blind — a slow flush can no longer loop.

---

## [1.1.0] - 2026-07-04

### Added

- **Modes are back**: `lite` (non-blocking `additionalContext` nudge, default), `full` (hard `decision: "block"`), `off` — both delivered via stdout + exit 0 per the Stop hook JSON protocol.
- **Confidence escape hatch**: after the first nudge, if the model's last turn declares "100% certain/confident/sure" (read from `transcript_path`), the hook stops nudging immediately.
- **Persisted config**: mode and nudge cap stored in `${CLAUDE_PLUGIN_DATA}/config.json` via the `gaslighter:config` skill and `gaslighter-config-cli.js`; `GASLIGHTER_MODE` / `GASLIGHTER_MAX_NUDGES` env vars override per session.
- **LLM judge pipeline**: `gaslighter:judge` skill fans out one `judge-agent` per task to rate completeness and overcorrection; `evals/render_findings.py` regenerates all results tables from run data.
- **Eval suite expanded** to 5 arms (baseline, gaslighter-off/lite/full, nudge-prompt); findings merged across 6 runs (910 cells).
- `.claude-plugin/marketplace.json` — install via `claude plugin marketplace add LarryGF/gaslighter`.

### Fixed

- Race reading `transcript_path` before the harness finished flushing the turn, which broke the escape hatch.

### Removed

- Orphaned statusline scripts, unused `scripts/load.py` router, and `evals/inspect.sh`.

---

## [1.0.0] - 2026-06-29

### Summary

Simplification rewrite. The v0.2.x codebase (~750 lines of hook code across 8 files) performed worse than baseline in evals. Replaced with ~100 lines across 3 files using psychologically effective nudge wording instead of procedural checklists.

### Changed

- **Nudge approach**: Replaced 5 context-specific checklist nudges with 2 short psychological prompts ("are you absolutely sure?"). First nudge forces re-examination; subsequent nudges include escape hatch.
- **Threshold logic**: Simplified from mode-based matrix (lite/full/ultra × files/tools/tasks) to single check: did the model use Write or Edit tools?
- **Anti-loop guard**: Simplified from 7 state fields to 3 (`nudge_count`, `turn_count`, `last_nudge_turn`). Max 1 nudge per turn, max 3 per session.
- **Always blocking**: Removed lite/full/ultra distinction. One mode that works (exit code 2).
- **SessionStart**: Emits short framing prompt instead of full SKILL.md content.

### Removed

- `gaslighter-config.js` — inlined into nudge.js
- `gaslighter-runtime.js` — inlined into nudge.js
- `gaslighter-instructions.js` — inlined into activate.js
- `gaslighter-mode-tracker.js` — no more per-prompt mode tracking
- `gaslighter-precompact.js` — YAGNI (model preserves goals during compaction)
- `gaslighter-config-optionA.js` / `gaslighter-config-optionB.js` — dead A/B test code
- LLM judge (agent-based second nudge) — replaced by escape hatch in nudge text
- `UserPromptSubmit` and `PreCompact` hooks — removed from hooks.json
- `skills/data-enricher/` — not part of core plugin
- `scripts/enrich.py` — not part of core plugin
- `AUTONOMOUS-IMPROVEMENT.md` — process doc
- `docs/archive/` — 6 historical analysis files
- `docs/STATUS.md`, `docs/v0.2.1-*.md`, `docs/v0.2.2-*.md` — obsoleted
- `tests/test-llm-judge.js` — no more LLM judge

### Added

- `evals/config.json` — persistent eval defaults (runs, models, arms, workers, timeout)
- `--config`, `--timeout`, `--exclude-task` flags in `evals/run.py`

### File count

~15 files (down from ~35). Hook code: ~100 lines (down from ~750).

---

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
