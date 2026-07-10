# Changelog

## [1.6.0](https://github.com/LarryGF/gaslighter/compare/v1.5.0...v1.6.0) (2026-07-10)


### Features

* **config:** add smartModel and smartCmd config validation ([385806f](https://github.com/LarryGF/gaslighter/commit/385806f82fc3d302047b9cfb4c5aa92badd2e350))
* **evals:** add cross-version comparison chart ([469084c](https://github.com/LarryGF/gaslighter/commit/469084c65639eb7aaa35fc123e622abc0147bbc7))
* **evals:** add plugin version tracking and release-cohort bucketing ([01f1fed](https://github.com/LarryGF/gaslighter/commit/01f1fed5fc81ccce5e6efabcdfcbbd1b336b3a88))
* **evals:** add three new hard-tier eval tasks ([383e4ad](https://github.com/LarryGF/gaslighter/commit/383e4adafabf1dab9844f0f2656cb6e030c9b4e0))
* **evals:** add version-scoped metrics and split benchmark charts ([5fc47a6](https://github.com/LarryGF/gaslighter/commit/5fc47a6f6a139c06e90e458edda9c8fc1cdfd4d6))


### Bug Fixes

* **evals:** check run_dir/workspaces first in judge.py collect() ([be0e40a](https://github.com/LarryGF/gaslighter/commit/be0e40ae600a675de200fe2c84ac2691c2ba626e))
* **evals:** replace broken --bare flag and add delta columns ([6306fd7](https://github.com/LarryGF/gaslighter/commit/6306fd7bd11d0a4de2871db6e31eff28d1e72e4c))
* **evals:** scope --chart flag to current version like render() path ([b6a1524](https://github.com/LarryGF/gaslighter/commit/b6a15246454262d2f973a975990092174fdb0a60))
* **evals:** scope intro to current version, fix chart subtitles ([81a8e95](https://github.com/LarryGF/gaslighter/commit/81a8e95f4402a7cb813977f2f3d7f7ba303a49ce))
* **evals:** use hermetic data dir for selftest isolation ([c7653d7](https://github.com/LarryGF/gaslighter/commit/c7653d7bb2da735951b24197d992b1cf7bbe3d6f))
* **gaslighter:** pass CLAUDE_PLUGIN_DATA to config CLI in SKILL.md ([c2df3a7](https://github.com/LarryGF/gaslighter/commit/c2df3a7d457c8ba7b5a27a5b799b6b503d193341))


### Documentation

* **evals:** update benchmark results from 20260709-151040 run ([38d601e](https://github.com/LarryGF/gaslighter/commit/38d601eaa5e4e4e6cda469329771d719c7141a17))
* **eval:** update skill docs with new defaults and output location ([b14fdad](https://github.com/LarryGF/gaslighter/commit/b14fdad1e714fe9ce84a9241f15ab58b108e84d3))
* **project:** document harness-agnostic architecture ([50287c6](https://github.com/LarryGF/gaslighter/commit/50287c6cfb7e3d9e400106ae54ffd36f3885fab2))
* **readme:** add OpenCode section and smart config docs ([f2ed712](https://github.com/LarryGF/gaslighter/commit/f2ed71237de6b387f11c16f86b5362b296cf2db1))


### Miscellaneous

* **evals:** add sonnet to default eval models ([97dccbc](https://github.com/LarryGF/gaslighter/commit/97dccbcdf36fb3fde7346228ca02575609c46a0c))
* **evals:** reduce default matrix to lean benchmark ([fae8299](https://github.com/LarryGF/gaslighter/commit/fae829979c2f02b307690f76d15c4d847caa23b0))
* **evals:** update benchmark results with 20260710-143019 run data ([8aca0b2](https://github.com/LarryGF/gaslighter/commit/8aca0b2729db664b4862a9c4a01ec02cd6d826e1))

## [1.5.0](https://github.com/LarryGF/gaslighter/compare/v1.4.0...v1.5.0) (2026-07-07)


### Features

* **eval:** add buried constraints to hard-tasks suite ([dbf4a39](https://github.com/LarryGF/gaslighter/commit/dbf4a398f47052ed5eddc4e11b49595102300d45))


### Bug Fixes

* **eval:** read hook telemetry from debug log instead of state file ([fb2eba2](https://github.com/LarryGF/gaslighter/commit/fb2eba2188727b0cd84c50d8ace345d3c2b2d807))
* **nudge:** reword overcorrection guard to allow cascade completion ([f95c7b8](https://github.com/LarryGF/gaslighter/commit/f95c7b827862e83b430708b34110013ec3426237))

## [1.4.0](https://github.com/LarryGF/gaslighter/compare/v1.3.0...v1.4.0) (2026-07-06)


### Features

* **evals:** add smart mode to eval suite ([bd024a9](https://github.com/LarryGF/gaslighter/commit/bd024a9eb30753c977d52d872a74dab1e1e65059))


### Bug Fixes

* **capture:** filter synthetic prompts from request capture ([14c1a98](https://github.com/LarryGF/gaslighter/commit/14c1a983f5cf9a6cc6eeca1e920fa8699cd82216))


### Documentation

* **capture:** document synthetic prompt filter in CLAUDE.md ([966b292](https://github.com/LarryGF/gaslighter/commit/966b2920f6462b88f47812583d2b1fdc8f33fdea))


### Miscellaneous

* **evals:** update benchmark data with run 7 results ([25fc879](https://github.com/LarryGF/gaslighter/commit/25fc8796ad1fb1ac4b9cec22966b163ea70ad7d9))

## [1.3.0] - 2026-07-06

### Added

- **Background-work filter**: the Stop hook now skips entirely (no state mutation, no nudge) when `background_tasks` or `session_crons` is non-empty in the hook input (Claude Code v2.1.145+) — a session pausing for a backgrounded Bash command, a spawned subagent, or a scheduled cron is not actually finishing, so nudging there would be premature and would silently waste a cap slot.

### Fixed

- **Turn-merging bug in `analyzeLastTurn`**: lite mode's `additionalContext` delivery never inserts a real user-turn boundary in the transcript, so the backward scan for "the last turn" only stopped at an *actual* human message — meaning a tool call from turns ago kept leaking into every later turn's `usedTools`/`editedFiles` result. Live-observed nudging 3 times in a row despite two consecutive tool-free confirmations, because the stale tool call from before the first nudge permanently defeated the `!turn.usedTools` early-exit. Fixed by scoping `analyzeLastTurn` to entries strictly after the previously-judged turn's `uuid`, not just the last real user message.

### Known limitation

- **`quiet` delivery does not fully hide the nudge**: `hookSpecificOutput.additionalContext` itself isn't rendered as a chat message, but the CLI separately surfaces it via a `hook_additional_context` attachment and a `stop_hook_summary` line (`● Ran N stop hooks ⎿ Stop hook feedback: ...`) that `suppressOutput` does not affect — confirmed by inspecting a live session's transcript JSONL. Filed as feedback to Anthropic; no code-side fix currently possible.

## [1.2.0] - 2026-07-05

### Added

- **`smart` mode**: instead of nudging unconditionally, shells out to a cheap model (`claude -p ... --model claude-haiku-4-5`) asking whether the turn actually missed a requirement, and only hard-blocks with the specific gap when it says so. Falls back to a plain nudge on any check failure (missing binary, timeout, malformed output) — never crashes, never blocks on the failed check. Default cap 2/session.
- **First-nudge edit gate**: the first nudge now only fires if the turn actually touched files (`Edit`/`Write`/`NotebookEdit`/`Bash`) — pure Q&A turns get no nudge and no added latency. `nudgeOnReadOnly: true` (config/env) restores the old unconditional behavior.
- **Anti-overcorrection guard**: both nudge texts now explicitly say not to add unrequested features, refactors, tests, or "improvements" beyond scope.
- **`quiet` delivery**: `lite` mode's nudge is now hidden from the transcript by default (`suppressOutput: true`) while still reaching the model via `additionalContext`; `full` mode always shows a one-line `systemMessage` instead, since its block is inherently user-visible.
- **Request capture**: a new `UserPromptSubmit` hook captures non-trivial user prompts into session state, so subsequent nudges (and `smart` mode's check) can quote the original request verbatim even after compaction.
- **Session cleanup**: a new `SessionEnd` hook deletes the ending session's state file and any state files older than 7 days.
- `stop_hook_active` cross-check: a first-nudge Stop where the harness reports it's a continuation (but our own state shows `nudge_count === 0`, i.e. state file missing/mismatched) is now treated as a continuation instead of re-firing the first nudge.

### Fixed

- **Stale-turn race in the anti-loop guard**: `waitForTurn` accepted any trailing turn that merely *looked* complete, without checking it was actually new since the last invocation. If the hook's first poll landed before the harness finished flushing the just-generated turn, it would silently re-judge the *previous* turn instead — observed live as a turn explicitly declaring "100% certain" getting skipped entirely, causing an extra nudge. Fixed by tagging each turn with its transcript `uuid` and requiring a genuinely new one before accepting it as fresh.

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
