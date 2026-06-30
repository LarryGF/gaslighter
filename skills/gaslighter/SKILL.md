---
name: gaslighter
description: "Requirement completeness checker — nudges you to re-read the original request before finishing. Routes to eval and judge sub-skills."
when_to_use: "Use when user says 'gaslighter', 'eval', 'evals', 'run evals', 'benchmark', 'judge', 'score', 'rate', or invokes /gaslighter directly."
model: haiku
allowed-tools:
  - Skill(gaslighter:eval)
  - Skill(gaslighter:judge)
  - AskUserQuestion()
  - Bash(python3 ${CLAUDE_PLUGIN_ROOT}/scripts/load.py *)
---

!`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/load.py" $ARGUMENTS`

Execute the instructions above.

---

# Gaslighter — Requirement Completeness Guard

A Stop hook that asks you to verify you haven't missed anything before completing code changes. When nudged, genuinely re-read the original request — don't assume you're done.

## Switching Modes

- `GASLIGHTER_DEFAULT_MODE=on` (default) — active
- `GASLIGHTER_DEFAULT_MODE=off` — disabled
- `stop gaslighter` or `normal mode` in conversation — disable for session

## How It Works

When you use Write or Edit tools, the hook fires and asks you to re-check the original request. It fires at most once per turn and at most 3 times per session. First nudge forces re-examination; subsequent nudges give you an escape hatch if you're genuinely done.
