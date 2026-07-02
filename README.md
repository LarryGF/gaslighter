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

Merged across two eval runs (310 cells total: 5 tasks × 5 arms × 2 models, 8 runs/cell on the original 2 tasks + 3 runs/cell across all 5 tasks):

| Arm | Correct | Auto Complete | Judge Completeness | Judge Overcorrection |
|---|---|---|---|---|
| baseline | 0.887 | 0.893 | 2.42 | 0.48 |
| gaslighter-off | 0.935 | 0.915 | 2.39 | 0.31 |
| gaslighter-lite | 0.952 | 0.929 | 2.42 | 0.40 |
| gaslighter-full | 0.984 | 0.945 | 2.60 | 0.31 |
| nudge-prompt | 0.903 | 0.891 | 2.37 | 0.35 |

`gaslighter-full` leads on every quality metric — correctness, completion, and judged completeness — with overcorrection at or below baseline, at the cost of roughly 50% more turns. Full findings and all 310 individual run scores: [`docs/eval-findings.md`](docs/eval-findings.md).
