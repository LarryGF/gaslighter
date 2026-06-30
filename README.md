# Gaslighter

A Claude Code plugin that nudges the model to verify requirement completeness before finishing code changes.

## What It Does

When Claude uses Write or Edit tools, a Stop hook blocks completion and injects a "re-read the original request" nudge. The model must genuinely re-examine requirements before continuing — not just say "yes I checked."

Anti-loop guard: max 1 nudge per turn, max 3 per session. First nudge forces re-examination; subsequent nudges include an escape hatch.

## Install

```bash
claude plugin add /path/to/gaslighter
```

## How It Works

1. **SessionStart** — writes flag file, emits framing prompt
2. **Stop** — if the model used Write/Edit, blocks with a completeness nudge (exit code 2)

### Disabling

Set env var before starting a session:

```bash
export GASLIGHTER_DEFAULT_MODE=off
```

Or say `stop gaslighter` / `normal mode` in conversation.

## Eval Suite

```bash
cd evals

# Validate scorers (no API spend)
python3 run.py --selftest

# Quick run
python3 run.py --task hard-buried-constraints --models haiku --runs 1

# Full run
python3 run.py --all --runs 4
```

See `evals/README.md` for task details and judging.
