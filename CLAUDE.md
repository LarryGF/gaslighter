# Gaslighter Plugin

Claude Code plugin that uses a Stop hook to nudge Claude into verifying requirement completeness.

## How It Works

Each time Claude tries to finish a response, the Stop hook fires a short psychologically-effective nudge asking it to re-read the original request, plus a line telling it not to add unrequested scope (guards against overcorrection). Anti-loop guard: capped nudges per session (see Modes below). The **first** nudge is gated on file-modifying activity (`Edit`/`Write`/`NotebookEdit`/`Bash` in the turn's tool calls) — pure Q&A turns get no nudge at all; set `nudgeOnReadOnly: true` in config.json or `GASLIGHTER_NUDGE_ON_READONLY=1` to restore unconditional nudging. After the first nudge, the hook stops early (before the cap) when the model's last turn shows it has nothing left to do: either it declares "100% certain/confident/sure" (regex fast-path), or the turn contained zero tool calls — meaning it re-checked and changed nothing, so further nudging is noise no matter how the confirmation is phrased. The harness flushes the turn's final text entry to `transcript_path` ~200ms *after* the Stop hook starts, so the hook polls via `waitForTurn()` (150ms interval, 5s deadline, `GASLIGHTER_FLUSH_WAIT_MS` override) until the turn is fully flushed before judging it; on timeout it fails quiet — it never nudges blind. `waitForTurn` also guards against a subtler race: "flushed" alone isn't enough, because the *previous* turn already looks flushed too (it also ended in a real text entry) — a poll that lands before the harness appends the new turn will happily accept the old one as if it were fresh. `analyzeLastTurn` tags each turn with its transcript `uuid`, and the hook passes the previously-processed uuid as a staleness guard so a poll can't accept the same turn twice; this was live-observed to make a real "I'm 100% certain" turn get skipped entirely (the hook judged the prior, non-confident turn instead) — lite mode's non-blocking delivery never inserts a synthetic user-turn boundary between nudges, so without the uuid check the two turns were otherwise indistinguishable. That same missing boundary also poisoned the `usedTools`/`editedFiles` heuristics: `analyzeLastTurn` only stopped merging turns at a *real* user message, so once one nudge cycle had a tool call, every later plain-text confirmation still read as "used tools" (nothing to stop on) because there was never a real user message between them to cut the merge — live-observed nudging 3 times in a row despite two consecutive tool-free confirmations. Fixed by passing the previously-judged turn's `uuid` into `analyzeLastTurn` itself (not just `waitForTurn`'s freshness check) so it also breaks the backward scan there, scoping `usedTools`/`editedFiles`/`text` to only the entries since the last nudge. If `stop_hook_active` is true on a turn where our own state shows `nudge_count === 0` (state file missing/mismatched, e.g. wrong data dir), the hook treats it as a continuation rather than firing the first nudge again.

`full` mode's unlimited cap is bounded in practice by Claude Code's own harness-level override: it force-overrides a Stop hook after **8 consecutive blocks without progress** (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it).

### Background-work filter

The Stop hook input includes `background_tasks`/`session_crons` (Claude Code v2.1.145+, per the SDK's `StopHookInput` type) whenever the session is pausing to wait on a backgrounded Bash command, a spawned subagent, or a scheduled cron, rather than actually finishing. `gaslighter-nudge.js` exits immediately (no state mutation, no nudge) when either array is non-empty — nudging mid-background-work would land while the model has nothing left to act on until that work resumes the session, and would silently consume a cap slot for no reason. Older CLI versions simply omit these fields, which is treated as "nothing pending."

### `quiet` — known limitation (does not fully hide the nudge)

The `additionalContext` field itself isn't rendered as a chat bubble — but the CLI surfaces
it via a *separate* transcript record (`hook_additional_context` / the `stop_hook_summary`
line shown as `● Ran N stop hooks ⎿ Stop hook feedback: ...`), and `suppressOutput` only
hides the raw `hook_success.stdout` dump, not that summary line. So in practice, lite
mode's nudge is **still visible** in the terminal transcript even with `quiet: true` —
confirmed by inspecting a live session's transcript JSONL, not just the docs. There is
currently no documented Stop-hook field that both reaches the model and is hidden from
that summary line.

## Modes

Mode, nudge cap, and delivery options are persisted to `${CLAUDE_PLUGIN_DATA}/config.json`
(`{ "mode": "lite", "maxNudges": 3, "quiet": true, "nudgeOnReadOnly": false }`, all keys but
`mode` optional). Set via the `gaslighter:config` skill. Precedence for each setting
independently: env var > persisted `config.json` > mode default.

Delivery modes deliver via stdout + exit 0 (per the [Stop Hook Reference](https://code.claude.com/docs/en/hooks.md#stop-hook-reference), the JSON decision protocol only works this way):
- `lite` (default) — `hookSpecificOutput.additionalContext`, non-blocking soft nudge, default cap 3
- `full` — `decision: "block"`, hard block, default cap unlimited
- `smart` — asks a cheap model (`claude -p ... --model claude-haiku-4-5`) whether the turn actually missed a requirement instead of nudging unconditionally; only blocks (`decision: "block"`) when it says so, with the specific gap as the reason. Default cap 2. On any check failure (missing `claude` binary, non-zero exit, timeout, malformed output) it never crashes and never blocks on the failed check — it falls back to a plain lite-style nudge instead. Costs ~2-5s latency and one Haiku call per gated Stop; trades that for nudging only when something is actually missing rather than every time. `GASLIGHTER_SMART_CMD` overrides the binary invoked (used by tests to stub the CLI).
- `off` — disabled, cap always 0

`GASLIGHTER_MODE` overrides the persisted mode; `GASLIGHTER_MAX_NUDGES` overrides the persisted/default cap (`infinite`/`unlimited`/`-1` for no cap).

### `quiet` — invisible nudges

`quiet` (bool, `GASLIGHTER_QUIET` env override) controls whether the nudge is hidden from
the transcript UI via `suppressOutput: true` — the nudge text still reaches the model via
`additionalContext`, it's just not rendered to the user. Default: `true` for `lite`,
`false` for `full`. `full` mode is a hard block by design and is always user-visible; it
instead gets a one-line `systemMessage` ("gaslighter: verifying completeness (nudge N/cap)")
so the user sees why the turn continued, without polluting model context.

### `nudgeOnReadOnly` — first-nudge edit gate

`nudgeOnReadOnly` (bool, `GASLIGHTER_NUDGE_ON_READONLY` env override, default `false`)
restores nudging on the first Stop even when the turn made no file-modifying tool calls.

### Request capture (defense in depth)

A `UserPromptSubmit` hook (`hooks/gaslighter-capture.js`) writes the user's prompt into
session state (`last_request: {prompt, ts}`) whenever it's non-trivial (≥80 chars, and not
a `/slash-command`) — this survives compaction. The captured prompt is stored but no longer
quoted back in nudge text (removed: nudges now use only the generic `SUBSEQUENT_NUDGE`).

The harness also fires `UserPromptSubmit` when a background task/agent notification is
replayed into the transcript to resume the session — that text isn't user-authored, but it
easily clears the 80-char/non-slash-command bar. `isTrivialPrompt` treats a prompt as
trivial when it starts with `<task-notification`, `<system-reminder`, or `[SYSTEM NOTIFICATION`
— the markers these synthetic replays open with.

## Architecture (harness-agnostic core + adapters)

The decision logic is harness-agnostic and shared; only I/O is harness-specific.
This lets gaslighter run under Claude Code, OpenCode, and omp from one engine.

- `hooks/lib/engine.js` — pure logic: nudge text, mode/cap/quiet/read-only
  resolution, confidence detection, smart-check prompt build/parse. No fs, no I/O.
- `hooks/lib/core.js` — `decide(ctx)`, the shared async orchestrator. Takes the
  loaded state plus injected callbacks (`getTurn`, `runSmartCheck`, `getQuiet`,
  `log`) and returns an abstract plan (`exit` or `deliver{ blocking, text, quiet,
  systemMessage?, isFirst, smart }`). Encodes the whole flow (cap, first/subsequent,
  read-only gate, confidence/tool escape hatches, smart) exactly once.
- `hooks/lib/store.js` — `createStore(dataDir)`: state/config persistence bound to
  an explicit dir (no env reads inside).
- `hooks/lib/env.js` — agnostic resolution. Data dir: `GASLIGHTER_DATA_DIR` >
  `CLAUDE_PLUGIN_DATA` > neutral XDG/OS default. Session: explicit >
  `GASLIGHTER_SESSION_ID` > `CLAUDE_SESSION_ID` > `unknown`.
- `hooks/lib/opencode.js` — OpenCode message→turn extraction (pure, testable).
- `hooks/lib/omp.js` — omp message→turn extraction + smart-check JSON-stream
  parsing (pure, testable).

Adapters (translate the plan to/from the host's hook protocol):

- `hooks/gaslighter-nudge.js` — **Claude Code Stop adapter**: reads stdin, parses
  Claude's JSONL transcript (`analyzeLastTurn`/`waitForTurn`), runs the smart
  check via the `claude` CLI, and formats `decision:"block"` /
  `hookSpecificOutput.additionalContext` / `suppressOutput`. Still re-exports its
  full historical API (used by the other hooks and tests).
- `opencode/gaslighter.js` — **OpenCode plugin adapter**: `session.idle` event,
  `client.session.messages()` for the turn, `client.session.prompt()` (+ toast)
  for delivery, and a throwaway session for the smart check. See `opencode/README.md`.
- `omp/gaslighter-extension.ts` — **omp extension adapter**: `session_stop` event
  (native Claude/Codex-compatible result shape — `decision:"block"`/`reason` or
  `continue`/`additionalContext`, no follow-up-prompt workaround needed),
  `event.messages` for the turn, a throwaway `omp -p ... --mode json` subprocess
  for the smart check. Declared via this repo's root `package.json`'s
  `omp.extensions` field — see the README's omp section for install.

## Structure

- `hooks/lib/` — shared agnostic core (engine/core/store/env/opencode/omp)
- `hooks/` — Claude Code adapter hooks (nudge/capture/cleanup/config-cli)
- `opencode/` — OpenCode plugin adapter (+ its README/install notes)
- `omp/` — omp extension adapter
- `agents/judge-agent.md` — judge sub-agent definition (rubrics, calibration)
- `evals/` — benchmark suite
- `assets/` — README benchmark chart SVGs, auto-generated by `evals/render_findings.py` (also via `--chart`)
- `tests/` — unit tests (`test-nudge-decision.js` Claude path, `test-agnostic.js` shared core + OpenCode + omp)

## Running tests

```bash
node tests/test-nudge-decision.js
```

## Key conventions

- Claude hook registration paths use `${CLAUDE_PLUGIN_ROOT}`, never `CLAUDE_SKILL_DIR`
- Data dir is resolved agnostically (`hooks/lib/env.js`): `GASLIGHTER_DATA_DIR` > `CLAUDE_PLUGIN_DATA` > neutral XDG/OS default — no hardcoded `~/.claude` path in JS anymore
- Session state stored in `{dataDir}/state-{session_id}.json`; config in `{dataDir}/config.json`
- Config overridable via `GASLIGHTER_*` env vars; smart model/binary via `GASLIGHTER_SMART_MODEL` / `GASLIGHTER_SMART_CMD` (config keys `smartModel`/`smartCmd`)
- New decision logic goes in `hooks/lib/` (shared), not in an adapter — adapters only do I/O translation
- All Claude hooks have `commandWindows` equivalents
