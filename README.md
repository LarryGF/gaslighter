# Gaslighter

A Claude Code plugin that nudges the model to verify requirement completeness before finishing code changes.

## What It Does

When Claude uses Write or Edit tools, a Stop hook fires a "re-read the original request" nudge. The model must genuinely re-examine requirements before continuing — not just say "yes I checked."

Anti-loop guard: max 1 nudge per turn, max 3 per session. First nudge forces re-examination; subsequent nudges include an escape hatch.

## Install

```bash
claude plugin add /path/to/gaslighter
```

## How It Works

**Stop** — if the model used Write/Edit, fires a completeness nudge. Mode controls delivery:

- `lite` (default) — non-blocking soft nudge via `additionalContext`
- `full` — hard block via `decision: "block"`
- `off` — disabled

### Disabling

Set env var before starting a session:

```bash
export GASLIGHTER_MODE=off
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

## Results

Merged across three eval runs (460 cells total: 5 tasks × 5 arms × 2 models, 8 runs/cell on the original 2 tasks + 3 runs/cell each on two later full-suite runs):

| Arm | Correct | Auto Complete | Judge Completeness | Judge Overcorrection |
|---|---|---|---|---|
| baseline | 0.902 | 0.902 | 2.50 | 0.34 |
| gaslighter-off | 0.946 | 0.925 | 2.51 | 0.24 |
| gaslighter-lite | 0.967 | 0.942 | 2.54 | 0.35 |
| gaslighter-full | 0.978 | 0.952 | 2.64 | 0.33 |
| nudge-prompt | 0.924 | 0.913 | 2.48 | 0.26 |

`gaslighter-full` leads on every quality metric — correctness, completion, and judged completeness — at the cost of roughly 47% more turns than baseline. The third run's hook code was edited mid-run to fix an anti-loop race condition, so its turn/cost figures are a mix of pre- and post-fix behavior — see the hook-version note in the findings doc. Full findings and all 460 individual run scores: [`docs/eval-findings.md`](docs/eval-findings.md).
