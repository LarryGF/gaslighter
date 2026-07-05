# Gaslighter Improvement Plan

Target: a separate session should be able to implement this document end-to-end without
extra research. Every change lists the file, the exact behavior, and its acceptance check.
Read `CLAUDE.md` and `hooks/gaslighter-nudge.js` before starting; run
`node tests/test-nudge-decision.js` and `python evals/run.py --selftest` after every phase.

## Context: what the research found

### Current eval data (docs/eval-findings.md, 910 cells, 6 runs)

| Arm | Correct | Cost/run | Turns | Overcorrection |
|---|---|---|---|---|
| baseline | 0.923 | $0.1116 | 7.9 | 0.23 |
| gaslighter-lite | 0.945 | $0.1538 (+38%) | 8.3 | 0.25 |
| gaslighter-full | 0.989 | $0.1616 (+45%) | 11.5 | 0.30 (worst) |
| nudge-prompt | 0.918 | $0.1038 | 7.7 | 0.22 |

Diagnosis:
- **lite is poor value**: +0.022 correctness for +38% cost. It nudges every session
  unconditionally, including turns where nothing was missed (which is most of them —
  4 of 5 tasks sit at ~1.000 correct for every arm).
- **full works but overcorrects**: all of its gain comes from one task
  (`hard-cascade-update`, 0.717 → 0.957), and it has the worst overcorrection (0.67 on
  `hard-preserve-behavior`). The nudge text never says "don't add unrequested things";
  the eval's own `NUDGE_PROMPT` does and its arm shows no overcorrection penalty.
- **nudge-prompt underperforms baseline** — keep the arm as the standing refutation of
  "just put a line in CLAUDE.md" (this came up on Reddit; the data answers it).

### Reddit thread feedback (r/ClaudeCode, screenshots reviewed 2026-07-05)

1. **Drift detection** (u/ucbmckee): he built deterministic rules + an LLM judge; wanted to
   detect *actual* drift rather than nudge blindly, found it hard, fell back to weak
   signals. → motivates the `smart` mode below.
2. **Defense in depth** (OP's own reply): multiple hook points — capture requirements at
   prompt time, verify at stop time — instead of one Stop nudge. → motivates the
   UserPromptSubmit capture below.
3. **"Just verify with a method"** (u/AppropriateQuote3073): OP's stated goal is catching
   ~80% automatically without per-prompt effort; improvements must not require the user
   to change how they prompt.
4. **"Just add a CLAUDE.md line"** (u/unkownuser436): already refuted by the
   `nudge-prompt` arm; no action beyond keeping that arm in evals.

### Hooks API capabilities we are not using (code.claude.com/docs/en/hooks + hooks-guide)

- `suppressOutput: true` (universal JSON field): hides the hook's stdout from the
  transcript UI while `additionalContext` still reaches the model. **This — not the exit
  code — is the mechanism for "lite mode doesn't show to the user."** Exit codes cannot
  express this: both modes must exit 0 because JSON output is only processed on exit 0,
  and exit 2 (the only other meaningful code for Stop) hard-blocks with stderr as the
  message — strictly less capable than `decision:"block"` JSON (no `systemMessage`, no
  `suppressOutput`). So: no exit-code changes; add a `quiet` config option instead.
- `systemMessage` (universal): one-line warning shown to the user. Lets full mode tell
  the human "gaslighter is re-checking (nudge 2/3)" without polluting model context.
- `stop_hook_active` (Stop input field): true when the current stop is the result of a
  prior Stop-hook continuation. Cross-checks our own state file (guards against the
  data-dir mismatch class of bug, e.g. the `-inline` suffix issue noted in evals/run.py).
- **Built-in loop cap**: Claude Code force-overrides a Stop hook after **8 consecutive
  blocks without progress** (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it). Document
  that `full` + `maxNudges: infinite` is effectively capped at 8 by the harness.
- `type: "prompt"` hooks: single Haiku call returning `{"ok": bool, "reason": str}`;
  for Stop, `ok:false` feeds `reason` back and Claude keeps working. Zero shell code.
  Limitation: prompt hooks are static hooks.json entries — they cannot read our
  config.json, so they cannot be mode-gated. (This drives the smart-mode design below.)
- `type: "agent"` hooks: subagent with file tools, same ok/reason contract. Experimental;
  do not build on it yet — note as future work only.

---

## Phase 1 — precision and hygiene (pure wins, no new latency)

### 1.1 Gate the first nudge on file-modifying activity

`hooks/gaslighter-nudge.js`. Today the first nudge fires unconditionally on every
session's first Stop — including pure Q&A turns where "re-read the requirements" is
noise, latency, and wasted tokens. This is lite mode's cost problem.

- Extend `analyzeLastTurn()` to also return `editedFiles: bool` — true if any `tool_use`
  entry in the turn has `name` in `{"Edit", "Write", "NotebookEdit"}` or `name === "Bash"`.
  (Bash counts: eval tasks may write files via shell. The `tool_use` content items
  already being walked have a `.name` field.)
- In the main flow, make the **first** nudge also call `waitForTurn()` (currently only
  subsequent nudges do) and skip the nudge (`exit 0`, state saved, debugLog
  `exit_no_edit_activity`) when `!turn.editedFiles`. On `waitForTurn` timeout keep the
  existing fail-quiet behavior.
- Config/env override: `nudgeOnReadOnly: true` in config.json or
  `GASLIGHTER_NUDGE_ON_READONLY=1` restores old behavior (same precedence pattern as
  `maxNudges`: env > config > default `false`).
- Cost note: this adds up to ~200ms typical (one flush wait) to the first Stop of coding
  sessions and removes the nudge entirely from non-coding turns.

### 1.2 Anti-overcorrection nudge text

`hooks/gaslighter-nudge.js`. Append to both `FIRST_NUDGE` and `SUBSEQUENT_NUDGE`:

> "Only fix what was actually asked — do NOT add unrequested features, refactors, tests,
> or 'improvements' beyond the original scope."

Rationale: full mode's overcorrection (0.30 mean, 0.67 on `hard-preserve-behavior`) is
its main regression axis, and the eval's `NUDGE_PROMPT` arm shows this clause costs
nothing on completeness.

### 1.3 `quiet` delivery option (the "invisible lite" request) — PRIMARY REQUIREMENT

`hooks/gaslighter-nudge.js` + `hooks/gaslighter-config-cli.js` + `skills/config/SKILL.md`.

This is the user's core ask for this round: in lite mode the nudge must reach the
**model** but never be rendered to the **user**. `suppressOutput: true` is the exact
mechanism (hides hook stdout from the transcript UI; `additionalContext` still lands in
model context). Full mode's `decision:"block"` render is inherently user-visible by
design — do not try to hide it; make it legible with `systemMessage` instead.

- New config key `quiet` (bool). Precedence: `GASLIGHTER_QUIET` env (`1`/`true`/`0`/`false`)
  > config.json `quiet` > default **true for lite, false for full**.
- When quiet and mode=lite, emit
  `{"suppressOutput": true, "hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": nudge}}`.
- When mode=full, always add `"systemMessage": "gaslighter: verifying completeness (nudge N/cap)"`
  so the user sees *why* the turn continued; the block JSON otherwise unchanged.
- `gaslighter-config-cli.js validate()`: accept `quiet` as boolean; reject other types.
- Update `skills/config/SKILL.md` and `CLAUDE.md` (Modes section) accordingly.
- Behavior expectation: `suppressOutput` changes UI rendering only — `additionalContext`
  still reaches the model — so evals should show **no completeness delta** vs plain lite.
  Verify with one small eval run (Phase 4) rather than assuming.

### 1.4 State hygiene and micro-cleanups

- **SessionEnd cleanup hook**: add to `hooks/gaslighter-hooks.json` a `SessionEnd` entry
  (with `commandWindows` twin, per convention) running a new tiny script
  `hooks/gaslighter-cleanup.js` that deletes `state-{session_id}.json` for the ending
  session and any `state-*.json` older than 7 days (mtime). Today state files accumulate
  forever in `${CLAUDE_PLUGIN_DATA}`.
- **Cache config reads**: `getMode()` and `getMaxNudges()` each call `loadConfig()`
  (two file reads per invocation). Read once into a module-level variable per invocation.
- **Use `stop_hook_active`**: in the main flow, if `payload.stop_hook_active === true`
  but `state.nudge_count === 0`, the state file is missing/mismatched (wrong data dir);
  debugLog `state_mismatch` and treat as a subsequent nudge (i.e., run the transcript
  checks) instead of firing FIRST_NUDGE again. Prevents double-first-nudge loops.
- Drop the unused `turn_count` field, or leave it — do not build on it.
- Document in `CLAUDE.md`: full mode's unlimited cap is bounded by Claude Code's own
  8-consecutive-block override (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).

### 1.5 Tests (extend `tests/test-nudge-decision.js`)

- `analyzeLastTurn` returns `editedFiles` correctly for turns with Edit/Write/Bash
  tool_use vs Read-only vs no tools.
- First-nudge gating: no-edit turn → no output; edit turn → nudge; override env restores
  old behavior.
- quiet lite output contains `"suppressOutput":true`; full output contains
  `"systemMessage"`; off still emits nothing.
- Config CLI accepts/rejects `quiet`.
- Cleanup script removes the target state file and old files, leaves fresh ones.

---

## Phase 2 — `smart` mode (LLM-gated nudging; the drift-detection idea)

New fourth mode: `smart`. Instead of nudging blindly, ask a cheap model whether the turn
actually missed something, and only nudge (as a hard block, with the specific gap as the
reason) when it did. Goal: full-mode accuracy at near-baseline turn count.

**Design decision — why not a `type:"prompt"` hook**: prompt hooks are static entries in
`hooks/gaslighter-hooks.json`; they fire in every mode and cannot read `config.json`.
Shipping one would run a Haiku call on every Stop even in `off` mode. So smart mode lives
inside the existing command hook, which already gates on config.

Implementation in `hooks/gaslighter-nudge.js`:

- When `mode === 'smart'` (after the Phase-1 edit-gate and cap checks pass), shell out
  synchronously (`child_process.execFileSync`, stdin for the payload, ~20s timeout):
  `claude -p <check-prompt> --model claude-haiku-4-5 --output-format json --max-turns 1`
  (feature-detect the binary with `command -v` equivalent — `shutil.which` pattern; if
  `claude` is missing or the call fails/times out, debugLog `smart_check_failed` and
  fall back to lite-style delivery of the standard nudge — never crash, never block on
  a failed check).
- Check-prompt content: the original user request (from Phase 3 capture if present,
  otherwise the first real user message extracted from the transcript — extend
  `analyzeLastTurn`/add `firstUserMessage(transcriptPath)`), plus the last turn's text,
  plus: *"Did the response address every explicit requirement in the request? Answer as
  JSON only: {\"ok\": true} or {\"ok\": false, \"reason\": \"<the specific missing
  requirement(s)>\"}. Missing = explicitly asked and not done. Extra unrequested work is
  not a missing requirement."*
- Parse the CLI's JSON output (`result` field of `--output-format json`); extract the
  first `{...}` blob; on `ok: true` → exit 0 silently; on `ok: false` → emit
  `{"decision": "block", "reason": "Requirement check flagged gaps: <reason>. Fix only these — do not add anything unrequested."}`.
- Mode defaults: `MODE_DEFAULT_MAX.smart = 2`. Hook `timeout` in
  `hooks/gaslighter-hooks.json` must rise from 10 to 30 (covers 5s flush wait + 20s check).
- `gaslighter-config-cli.js` `VALID_MODES` gains `'smart'`; config skill + CLAUDE.md updated.
- Trade-off to document in README: smart adds ~2–5s latency and ~1 Haiku call
  (fractions of a cent) per gated Stop, in exchange for nudging only when something is
  actually missing. The evals (Phase 4) decide whether it replaces lite as the default.
- Tests: mock the CLI via an env override `GASLIGHTER_SMART_CMD` (test points it at a
  stub script echoing canned JSON) so `tests/test-nudge-decision.js` covers ok:true,
  ok:false, malformed output, and missing-binary paths without spending API.

---

## Phase 3 — defense in depth: capture the original request

The nudge says "re-read the original request", but after compaction the model may not
have it verbatim, and smart mode needs it as ground truth.

- Add a `UserPromptSubmit` entry to `hooks/gaslighter-hooks.json` (+ `commandWindows`)
  running `hooks/gaslighter-capture.js`: reads stdin JSON, and if the prompt is
  non-trivial (≥ ~80 chars — skip "yes", "continue", slash commands starting with `/`),
  writes `{"prompt": <first 2000 chars>, "ts": Date.now()}` into the session state file
  (merge with existing state, key `last_request`). Exit 0 always, output nothing.
- `SUBSEQUENT_NUDGE` (and smart mode's check-prompt) embed it when present:
  `"The original request was:\n---\n<last_request>\n---\nVerify every requirement in it is implemented."`
- Keep FIRST_NUDGE generic (the request is still in context on the first stop of a turn).
- Tests: capture script writes/merges state; short prompts and `/commands` skipped;
  nudge text embeds the capture when present, falls back to generic text when absent.

---

## Phase 4 — eval integration (mandatory before changing any default)

`evals/run.py`, `evals/config.json`, `skills/eval/SKILL.md`.

- **New arms** in `ARMS`: `gaslighter-smart` (env `GASLIGHTER_MODE=smart`), and
  `gaslighter-lite-quiet` (`GASLIGHTER_MODE=lite` + `GASLIGHTER_QUIET=1`) — note
  `run_cell()` derives mode via `arm.split("-", 1)[1]`, which breaks for these compound
  names; refactor to an explicit `ARM_ENV = {arm: {env...}}` map instead of string
  splitting.
- **check_plugin() selftests** for the new output shapes: smart mode with a stubbed
  `GASLIGHTER_SMART_CMD` (both ok:true → empty stdout and ok:false → decision:block),
  lite-quiet → `"suppressOutput"` present.
- **New task class — false-positive probe**: add one task to `evals/tasks_hard.py`
  (`easy-explain-no-edit`) whose prompt asks only for an explanation/analysis of seed
  code with no file changes. Score `correct=1` when no seed file was modified; the
  metrics that matter are turns/cost/nudge_count deltas vs baseline. This is the task
  that shows Phase 1.1's gating and smart mode's precision; today's suite can't.
- **Metrics**: already captured per cell: cost, duration_ms, turns, tokens, nudge_count.
  Add `duration_ms` to `aggregate()` rows (mean) — it's collected but not surfaced, and
  smart mode's latency trade-off is invisible without it.
- **Run matrix** (keep spend flat): primary comparison `baseline, gaslighter-lite,
  gaslighter-smart, gaslighter-full` × {haiku, sonnet} × all 6 tasks × 3 runs.
  `gaslighter-off`, `nudge-prompt`, `gaslighter-lite-quiet` go in a one-off sanity run
  (1×) — off/nudge-prompt are established controls; lite-quiet only needs to confirm
  "no completeness delta vs lite".
- **Decision criteria** (write results into `docs/eval-findings.md` via the existing
  `evals/render_findings.py` flow):
  - smart replaces lite as the default mode if: correctness ≥ lite, cost/run ≤ lite,
    overcorrection ≤ lite + 0.05, and no-edit-task turn count ≈ baseline.
  - Phase 1 text change ships if full's overcorrection drops without a correctness drop.
  - Otherwise keep lite default and document smart as opt-in.

---

## Explicitly rejected (and why — do not resurrect without new evidence)

- **Exit-code-based delivery** (the original prompt's suggestion): both modes already
  exit 0; exit 2 + stderr for Stop is a strictly weaker equivalent of `decision:"block"`
  JSON (loses `systemMessage`/`suppressOutput`). The intent — invisible lite nudges — is
  Phase 1.3's `suppressOutput`.
- **Static `type:"prompt"` hook in hooks.json**: cannot be mode-gated by config; would
  bill a Haiku call on every Stop in every mode including `off`.
- **`type:"agent"` verification hook**: docs mark it experimental ("behavior and
  configuration may change"); revisit when stable. Smart mode's CLI shell-out delivers
  the same capability under our control.
- **PostToolUse per-tool nudging** (defense-in-depth maximalism from the Reddit thread):
  fires per tool call — token cost scales with turn length for a completeness check that
  only makes sense at turn end. Stop + UserPromptSubmit capture is the right pair.

## Suggested order & verification

1. Phase 1 (all of it) → `node tests/test-nudge-decision.js` green, `python evals/run.py --selftest` green.
2. Phase 3 (capture) → tests green. (Before Phase 2, since smart mode consumes the capture.)
3. Phase 2 (smart) → tests green including stubbed-CLI cases; manual smoke:
   `GASLIGHTER_MODE=smart claude -p "trivial two-requirement task" --plugin-dir .` and
   check `/tmp/gaslighter-debug.jsonl` (with `GASLIGHTER_DEBUG=1`) for the decision path.
4. Phase 4 eval run → update `docs/eval-findings.md`, then change defaults only per the
   decision criteria above.
