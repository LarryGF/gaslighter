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
| **gaslighter** | Plugin loaded via `--plugin-dir` |
| **nudge-prompt** | Static system prompt with nudge text |

## Judge

For subjective evaluation (completeness and overcorrection ratings), use the judge skill:

```
/gaslighter:judge runs/<timestamp>
```

Collects workspace data via `judge.py --collect`, then rates each workspace on completeness (0-3) and overcorrection (0-3).
