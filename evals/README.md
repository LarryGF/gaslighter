# Gaslighter Eval Suite

Measures **requirement completion rate** — what fraction of explicitly stated requirements were actually implemented.

## Quick start

```bash
python3 run.py --selftest           # validate scorers, no API
python3 run.py --all --runs 4       # 5 tasks x 3 arms (60 cells)
python3 run.py --all --models haiku,sonnet --runs 4  # multi-model
```

## Tasks

Each task targets a specific failure mode where models drop requirements.

| Task | Failure mode | What it tests |
|------|-------------|---------------|
| `hard-buried-constraints` | Requirements buried in prose | Did the model read the entire prompt? |
| `hard-implicit-patterns` | Conventions in seed code, not in prompt | Did the model look at existing code? |
| `hard-cascade-update` | One change implies 6 dependent file updates | Did the model trace dependencies? |
| `hard-preserve-behavior` | Fix bug without "improving" intentional design | Did the model resist unnecessary cleanup? |
| `hard-trailing-reqs` | Requirements appended after main ask | Did the model read to the end? |

## Arms

| Arm | What it does |
|-----|-------------|
| **baseline** | No plugin, no extra prompts |
| **gaslighter-off** | Plugin loaded but `GASLIGHTER_MODE=off` (measures plugin overhead) |
| **gaslighter-lite** | Plugin with `GASLIGHTER_MODE=lite` (exit 1, soft nudge) |
| **gaslighter-full** | Plugin with `GASLIGHTER_MODE=full` (exit 2, hard block) |
| **nudge-prompt** | Static system prompt with nudge text |

## Judge

For subjective evaluation (completeness and overcorrection ratings), use the judge skill:

```
/gaslighter:judge runs/<timestamp>
```

Collects workspace data via `judge.py --collect`, then rates each workspace on completeness (0-3) and overcorrection (0-3).

## Results

Latest run (`20260701-175238`, 2 tasks × 5 arms × 2 models × 8 runs = 160 cells). Full breakdown, per-task tables, and all 160 individual run scores: [`docs/eval-findings.md`](../docs/eval-findings.md).

| Arm | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|
| baseline | 0.906 | 0.881 | 2.34 | 0.72 | 10.6 | $0.1281 |
| gaslighter-off | 0.906 | 0.877 | 2.12 | 0.34 | 10.4 | $0.1263 |
| gaslighter-lite | 0.969 | 0.908 | 2.22 | 0.31 | 11.5 | $0.1829 |
| gaslighter-full | 0.969 | 0.908 | 2.47 | 0.34 | 14.6 | $0.1977 |
| nudge-prompt | 0.875 | 0.866 | 2.16 | 0.44 | 10.6 | $0.1181 |

Both active gaslighter modes beat baseline on automated correctness/completion and show markedly lower overcorrection, at the cost of extra turns (`full` especially). The static `nudge-prompt` arm underperforms baseline on automated correctness.
