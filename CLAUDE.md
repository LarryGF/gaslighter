# Gaslighter Plugin

Claude Code plugin that uses a Stop hook to nudge Claude into verifying requirement completeness.

## How It Works

When Claude uses Write or Edit tools, the Stop hook fires a short psychologically-effective nudge asking it to re-read the original request. Anti-loop guard: max 3 nudges per session. First nudge forces re-examination; subsequent nudges give an escape hatch.

## Modes

Set via `GASLIGHTER_MODE` env var. Both deliver via stdout + exit 0 (per the [Stop Hook Reference](https://code.claude.com/docs/en/hooks.md#stop-hook-reference), the JSON decision protocol only works this way):
- `lite` (default) — `hookSpecificOutput.additionalContext`, non-blocking soft nudge
- `full` — `decision: "block"`, hard block
- `off` — disabled

## Structure

- `.claude-plugin/plugin.json` — plugin manifest
- `hooks/` — hook scripts (Node.js, CommonJS)
  - `gaslighter-hooks.json` — hook registration (Stop only)
  - `gaslighter-nudge.js` — Stop hook: mode check, anti-loop guard, emit nudge
  - `gaslighter-statusline.sh` / `.ps1` — statusline badge
  - `package.json` — CommonJS marker
- `agents/judge-agent.md` — judge sub-agent definition (rubrics, calibration)
- `skills/gaslighter/SKILL.md` — orchestrator skill (routes to eval/judge)
- `skills/judge/SKILL.md` — eval judging orchestrator (fans out to judge-agent)
- `evals/` — benchmark suite
- `tests/` — unit tests

## Running tests

```bash
node tests/test-nudge-decision.js
```

## Key conventions

- Hook paths use `${CLAUDE_PLUGIN_ROOT}`, never `CLAUDE_SKILL_DIR`
- Session state stored in `${CLAUDE_PLUGIN_DATA}/state-{session_id}.json`
- Mode controlled by `GASLIGHTER_MODE` env var (full/lite/off)
- All hooks have `commandWindows` equivalents
