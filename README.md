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

Latest eval run (160 cells: 2 tasks × 5 arms × 2 models × 8 runs):

| Arm | Correct | Auto Complete | Judge Completeness | Judge Overcorrection |
|---|---|---|---|---|
| baseline | 0.906 | 0.881 | 2.34 | 0.72 |
| gaslighter-off | 0.906 | 0.877 | 2.12 | 0.34 |
| gaslighter-lite | 0.969 | 0.908 | 2.22 | 0.31 |
| gaslighter-full | 0.969 | 0.908 | 2.47 | 0.34 |
| nudge-prompt | 0.875 | 0.866 | 2.16 | 0.44 |

Both `gaslighter-lite` and `gaslighter-full` beat baseline on correctness/completion and cut overcorrection by more than half, at the cost of extra turns. Full findings and all 160 individual run scores: [`docs/eval-findings.md`](docs/eval-findings.md).
