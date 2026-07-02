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

Merged across `20260701-175238` (2 tasks × 5 arms × 2 models × 8 runs) and `20260702-131009` (5 tasks × 5 arms × 2 models × 3 runs) — 310 cells total. Full breakdown, per-task tables, and the full per-run appendix (tagged by source run): [`docs/eval-findings.md`](../docs/eval-findings.md).

| Arm | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|
| baseline | 0.887 | 0.893 | 2.42 | 0.48 | 8.8 | $0.1178 |
| gaslighter-off | 0.935 | 0.915 | 2.39 | 0.31 | 9.0 | $0.1181 |
| gaslighter-lite | 0.952 | 0.929 | 2.42 | 0.40 | 9.7 | $0.1672 |
| gaslighter-full | 0.984 | 0.945 | 2.60 | 0.31 | 13.2 | $0.1839 |
| nudge-prompt | 0.903 | 0.891 | 2.37 | 0.35 | 8.8 | $0.1103 |

`gaslighter-full` beats baseline on every quality metric (correctness, completion, judged completeness) while matching its overcorrection, at a ~50% turn/cost premium. The static `nudge-prompt` arm underperforms both active gaslighter modes on correctness.
