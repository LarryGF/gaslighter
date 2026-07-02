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

Merged across `20260701-175238` (2 tasks × 5 arms × 2 models × 8 runs), `20260702-131009` (5 tasks × 5 arms × 2 models × 3 runs), and `20260702-160751` (5 tasks × 5 arms × 2 models × 3 runs) — 460 cells total. Full breakdown, per-task tables, and the full per-run appendix (tagged by source run): [`docs/eval-findings.md`](../docs/eval-findings.md).

| Arm | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|
| baseline | 0.902 | 0.902 | 2.50 | 0.34 | 8.4 | $0.1141 |
| gaslighter-off | 0.946 | 0.925 | 2.51 | 0.24 | 8.4 | $0.1155 |
| gaslighter-lite | 0.967 | 0.942 | 2.54 | 0.35 | 9.1 | $0.1621 |
| gaslighter-full | 0.978 | 0.952 | 2.64 | 0.33 | 12.3 | $0.1740 |
| nudge-prompt | 0.924 | 0.913 | 2.48 | 0.26 | 8.4 | $0.1075 |

`gaslighter-full` beats baseline on every quality metric (correctness, completion, judged completeness), at a ~47% turn/cost premium — down from the earlier two-run merge's ~50%, though the `20260702-160751` run's hook code was edited mid-run (an anti-loop race-condition fix), so its turn/cost figures mix pre- and post-fix behavior rather than cleanly isolating the fix's effect. The static `nudge-prompt` arm still underperforms both active gaslighter modes on correctness.
