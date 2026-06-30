# Gaslighter Plugin

Claude Code plugin that uses a Stop hook to nudge Claude into verifying requirement completeness.

## How It Works

When Claude uses Write or Edit tools, the Stop hook fires a short psychologically-effective nudge asking it to re-read the original request. Anti-loop guard: max 1 nudge per turn, max 3 per session. First nudge forces re-examination; subsequent nudges give an escape hatch.

## Structure

- `.claude-plugin/plugin.json` — plugin manifest
- `hooks/` — hook scripts (Node.js, CommonJS)
  - `gaslighter-hooks.json` — hook registration (SessionStart + Stop)
  - `gaslighter-nudge.js` — Stop hook: check active, anti-loop guard, emit nudge
  - `gaslighter-activate.js` — SessionStart: write flag file, emit framing prompt
  - `gaslighter-statusline.sh` / `.ps1` — statusline badge
  - `package.json` — CommonJS marker
- `skills/gaslighter/SKILL.md` — behavioral instructions
- `skills/judge/SKILL.md` — eval judging skill
- `evals/` — benchmark suite
- `tests/` — unit tests

## Running tests

```bash
node tests/test-nudge-decision.js
```

## Running evals

```bash
cd evals

# Validate scorers (no API spend)
python3 run.py --selftest

# Quick run
python3 run.py --task hard-buried-constraints --models haiku --runs 1

# Full run with config defaults
python3 run.py --all --runs 4

# Exclude specific tasks
python3 run.py --all --exclude-task hard-preserve-behavior

# Custom config
python3 run.py --config config-thorough.json --all
```

## Key conventions

- Hook paths use `${CLAUDE_PLUGIN_ROOT}`, never `CLAUDE_SKILL_DIR`
- Session state stored in `${CLAUDE_PLUGIN_DATA}/state-{session_id}.json`
- Flag file at `$CLAUDE_CONFIG_DIR/.gaslighter-active`
- All hooks have `commandWindows` equivalents
