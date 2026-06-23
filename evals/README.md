# Gaslighter Eval Suite

Measures **requirement completion rate** — what fraction of explicitly stated requirements were actually implemented.

## Quick start

```bash
python run.py --selftest       # validate scorers, no API
python run.py --pilot --runs 4 # 5 tasks × 3 arms (60 cells)
python run.py --all --runs 4   # 10 tasks × 3 arms (120 cells)
```

## Tasks

Each task has 4-6 distinct requirements, some easy to forget. Scoring checks each independently.

| Task | Requirements | What's easy to forget |
|------|-------------|----------------------|
| multi-req-api | search, pagination, 400 on empty, search log | search logging |
| multi-req-refactor | validate fn, discount fn, custom error, dict return | apply_discount, dict return |
| multi-req-migration | email field, full_name method, update to_dict, from_dict | to_dict update, from_dict |
| multi-req-cli | CSV read, column filter, format flag, stderr summary | stderr summary, format flag |
| multi-req-validator | zip, state, city checks, return ALL errors | validate_city, return-all |
| multi-req-parser | file read, env interpolation, required keys, defaults | env interpolation, defaults |
| multi-req-cache | cache by URL, TTL, LRU eviction, stats | LRU eviction, stats |
| multi-req-logger | JSON format, levels, filtering, timestamps, output | timestamps, configurable output |
| multi-req-ratelimiter | per-key, token bucket, retry_after, stats | retry_after, stats |
| multi-req-export | export fn, CSV, JSON, missing keys, sort_by | sort_by |

## Judge

```bash
python judge.py --selftest      # validate judge ranking
python judge.py --run runs/<stamp>  # completeness + overcorrection scoring
```

Two LLM-judge passes (claude-sonnet-4-6, temperature 0):
1. **Completeness** — 0-3, does the code actually do what was asked?
2. **Overcorrection** — 0-3, did nudging cause unnecessary additions?
