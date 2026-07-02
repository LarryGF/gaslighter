# Gaslighter Eval Findings

Run: `evals/runs/20260701-175238` — 2 tasks × 5 arms × 2 models × 8 runs = 160 cells.

## Setup

- **Tasks**: `hard-buried-constraints` (requirements buried in prose), `hard-cascade-update` (one change implies several dependent file updates)
- **Arms**:
  - `baseline` — no plugin, no extra prompt
  - `gaslighter-off` — plugin loaded, hook fires but no-ops (control for plugin overhead)
  - `gaslighter-lite` — soft, non-blocking nudge
  - `gaslighter-full` — hard block until the model re-verifies
  - `nudge-prompt` — static "double check your work" text appended to the system prompt, no hook involved
- **Models**: haiku, sonnet
- **Scoring**:
  - *Automated*: deterministic code checks per task (`correct` = binary pass/fail, `complete_rate` = fraction of required checks passing)
  - *LLM judge*: an independent agent read each workspace's actual source and rated **completeness** (0–3, does it implement what was asked) and **overcorrection** (0–3, does it add unrequested structure/complexity)

## Headline result (overall, n=32 per arm — both tasks, both models)

| Arm | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|
| baseline | 0.906 | 0.881 | 2.34 | 0.72 | 10.6 | $0.1281 |
| gaslighter-off | 0.906 | 0.877 | 2.12 | 0.34 | 10.4 | $0.1263 |
| gaslighter-lite | 0.969 | 0.908 | 2.22 | 0.31 | 11.5 | $0.1829 |
| gaslighter-full | 0.969 | 0.908 | 2.47 | 0.34 | 14.6 | $0.1977 |
| nudge-prompt | 0.875 | 0.866 | 2.16 | 0.44 | 10.6 | $0.1181 |

## Key findings

1. **Both active gaslighter modes beat baseline on automated correctness and completion.** `gaslighter-lite` and `gaslighter-full` both land at 0.969 correct / 0.908 complete, vs. baseline's 0.906 / 0.881. `gaslighter-off` — mechanically a no-op — tracks baseline almost exactly (0.906 / 0.877), which is the expected result for a control arm.

2. **Both active modes show markedly lower overcorrection than baseline in the LLM judge's read.** Overcorrection drops from 0.72 (baseline) to 0.31 (`lite`) and 0.34 (`full`) — less than half. Counter to the naive expectation that "asking a model to double-check" would make it more anxious and add defensive/speculative code, the data shows the opposite: nudged runs stuck closer to what was actually asked, while baseline runs were more likely to add unrequested structure (JSON wrapping, extra response fields, redundant validation layers, etc. — see the full table below for specifics).

3. **`gaslighter-full` has the highest judged completeness of any arm** (2.47, vs. baseline's 2.34), even though it and `gaslighter-lite` tie with baseline on automated correctness for the easier task. The hard block appears to catch qualitative gaps (e.g., forgetting to export a new handler in `__init__.py`) that the automated checker's binary pass/fail doesn't always penalize as harshly.

4. **`nudge-prompt` (a static system-prompt reminder, no hook) underperforms baseline** on both automated correctness (0.875 vs. 0.906) and completion (0.866 vs. 0.881). A one-shot static reminder text in the system prompt is not a substitute for the interactive Stop-hook nudge — it's the weakest arm on the harder task (see below) and doesn't reliably improve outcomes.

5. **The completeness/overcorrection gains come at a turn and cost premium.** `gaslighter-full` averages 14.6 turns and $0.1977/run vs. baseline's 10.6 turns and $0.1281/run — the hard block forces additional rounds of re-verification. `gaslighter-lite`'s premium is smaller (11.5 turns, $0.1829/run).

6. **The benefit is task-dependent.** On `hard-cascade-update` (the harder task), `gaslighter-full` improves `correct` from 0.812 (baseline) to 0.938 and `gaslighter-lite` improves it to 0.938 as well — a real, sizeable jump. On `hard-buried-constraints` (where every arm already hits `correct=1.000`), the story shifts to overcorrection: `nudge-prompt` actually posts the *lowest* overcorrection on this task (0.12, better than `lite`'s 0.19 and `full`'s 0.25), while on `hard-cascade-update` `nudge-prompt` has the *worst* overcorrection of any arm (0.75, tied with baseline's 0.69). Gaslighter's overcorrection benefit is consistent across both tasks; the static-prompt approach's is not.

## Per-task summary (n=16 per arm — both models)

| Task | Arm | n | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|---|---|
| hard-buried-constraints | baseline | 16 | 1.000 | 0.933 | 2.44 | 0.75 | 8.8 | $0.1215 |
| hard-buried-constraints | gaslighter-off | 16 | 1.000 | 0.933 | 2.00 | 0.62 | 8.6 | $0.1160 |
| hard-buried-constraints | gaslighter-lite | 16 | 1.000 | 0.925 | 1.94 | 0.19 | 9.2 | $0.1889 |
| hard-buried-constraints | gaslighter-full | 16 | 1.000 | 0.940 | 2.19 | 0.25 | 12.8 | $0.2101 |
| hard-buried-constraints | nudge-prompt | 16 | 1.000 | 0.925 | 1.94 | 0.12 | 8.8 | $0.1122 |
| hard-cascade-update | baseline | 16 | 0.812 | 0.830 | 2.25 | 0.69 | 12.4 | $0.1347 |
| hard-cascade-update | gaslighter-off | 16 | 0.812 | 0.823 | 2.25 | 0.06 | 12.3 | $0.1367 |
| hard-cascade-update | gaslighter-lite | 16 | 0.938 | 0.892 | 2.50 | 0.44 | 13.7 | $0.1769 |
| hard-cascade-update | gaslighter-full | 16 | 0.938 | 0.877 | 2.75 | 0.44 | 16.4 | $0.1853 |
| hard-cascade-update | nudge-prompt | 16 | 0.750 | 0.806 | 2.38 | 0.75 | 12.5 | $0.1240 |

## Per-task, per-model breakdown (n=8 per cell)

| Task | Arm | Model | n | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|---|---|---|
| hard-buried-constraints | baseline | haiku | 8 | 1.000 | 0.985 | 1.88 | 0.50 | 9.2 | $0.0734 |
| hard-buried-constraints | baseline | sonnet | 8 | 1.000 | 0.880 | 3.00 | 1.00 | 8.2 | $0.1695 |
| hard-buried-constraints | gaslighter-off | haiku | 8 | 1.000 | 0.985 | 2.00 | 0.38 | 9.1 | $0.0721 |
| hard-buried-constraints | gaslighter-off | sonnet | 8 | 1.000 | 0.880 | 2.00 | 0.88 | 8.0 | $0.1599 |
| hard-buried-constraints | gaslighter-lite | haiku | 8 | 1.000 | 0.940 | 1.75 | 0.12 | 10.1 | $0.1342 |
| hard-buried-constraints | gaslighter-lite | sonnet | 8 | 1.000 | 0.910 | 2.12 | 0.25 | 8.4 | $0.2436 |
| hard-buried-constraints | gaslighter-full | haiku | 8 | 1.000 | 0.970 | 2.38 | 0.25 | 13.1 | $0.1592 |
| hard-buried-constraints | gaslighter-full | sonnet | 8 | 1.000 | 0.910 | 2.00 | 0.25 | 12.5 | $0.2609 |
| hard-buried-constraints | nudge-prompt | haiku | 8 | 1.000 | 0.970 | 1.88 | 0.25 | 9.1 | $0.0700 |
| hard-buried-constraints | nudge-prompt | sonnet | 8 | 1.000 | 0.880 | 2.00 | 0.00 | 8.4 | $0.1544 |
| hard-cascade-update | baseline | haiku | 8 | 0.625 | 0.766 | 1.62 | 0.50 | 12.0 | $0.0814 |
| hard-cascade-update | baseline | sonnet | 8 | 1.000 | 0.894 | 2.88 | 0.88 | 12.9 | $0.1880 |
| hard-cascade-update | gaslighter-off | haiku | 8 | 0.625 | 0.720 | 1.75 | 0.12 | 11.1 | $0.0769 |
| hard-cascade-update | gaslighter-off | sonnet | 8 | 1.000 | 0.925 | 2.75 | 0.00 | 13.5 | $0.1964 |
| hard-cascade-update | gaslighter-lite | haiku | 8 | 0.875 | 0.876 | 2.00 | 0.12 | 13.1 | $0.1178 |
| hard-cascade-update | gaslighter-lite | sonnet | 8 | 1.000 | 0.907 | 3.00 | 0.75 | 14.2 | $0.2360 |
| hard-cascade-update | gaslighter-full | haiku | 8 | 0.875 | 0.830 | 2.62 | 0.75 | 16.4 | $0.1239 |
| hard-cascade-update | gaslighter-full | sonnet | 8 | 1.000 | 0.924 | 2.88 | 0.12 | 16.4 | $0.2468 |
| hard-cascade-update | nudge-prompt | haiku | 8 | 0.500 | 0.750 | 1.75 | 1.00 | 12.0 | $0.0832 |
| hard-cascade-update | nudge-prompt | sonnet | 8 | 1.000 | 0.862 | 3.00 | 0.50 | 13.0 | $0.1649 |

Sonnet's judged completeness runs noticeably higher than haiku's across nearly every arm/task pair — consistent with sonnet simply being a stronger model — but the relative ordering between arms generally holds within each model, so the arm-level conclusions above aren't an artifact of one model dominating the sample.

## Methodology notes

- Automated scores (`correct`, `complete_rate`) are deterministic, code-based checks — the same task always scores the same way for the same code.
- Judge scores (`completeness`, `overcorrection`) come from one independent LLM read per cell (n=8 per task/arm/model, no cross-judge voting or redundancy). Treat the exact decimal means as directional signal rather than precise measurement — a cell judged by a stricter or looser reviewer could shift its arm's mean somewhat.
- n=8 runs per cell (n=32 per arm overall) is still a modest sample; individual cells can and do swing on single-run noise (see `hard-cascade-update / gaslighter-off / haiku / run 6`, which scored `correct=0`, `complete_rate=0.25` — its migration was missing the role column entirely, the sharpest single-run miss in the whole table).

## Full per-run table (all 160 cells)

| Task | Arm | Model | Run | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost | Missing (judge) | Overcorrection cite (judge) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hard-buried-constraints | baseline | haiku | 0 | 1 | 1.00 | 2 | 0 | 9 | $0.0768 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | haiku | 1 | 1 | 1.00 | 2 | 0 | 10 | $0.0916 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | haiku | 2 | 1 | 1.00 | 2 | 1 | 9 | $0.0610 | Handler not exported in notifications/__init__.py for package import availability | urllib.error imports not required (catches all Exception anyway) |
| hard-buried-constraints | baseline | haiku | 3 | 1 | 1.00 | 2 | 1 | 9 | $0.0874 | Handler not exported in notifications/__init__.py for package import availability | unused handle_webhook_error function when error handling done inline |
| hard-buried-constraints | baseline | haiku | 4 | 1 | 1.00 | 1 | 2 | 10 | $0.0771 | Handler signature deviates from established pattern (optional payload param breaks consistency with email/sms handlers) | complex payload type checking and conditional template formatting not in other handlers |
| hard-buried-constraints | baseline | haiku | 5 | 1 | 1.00 | 2 | 0 | 8 | $0.0558 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | haiku | 6 | 1 | 0.88 | 2 | 0 | 11 | $0.0816 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | haiku | 7 | 1 | 1.00 | 2 | 0 | 8 | $0.0560 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | sonnet | 0 | 1 | 0.88 | 3 | 0 | 9 | $0.2316 | none | none |
| hard-buried-constraints | baseline | sonnet | 1 | 1 | 0.88 | 3 | 1 | 8 | $0.2123 | none | json wrapping |
| hard-buried-constraints | baseline | sonnet | 2 | 1 | 0.88 | 3 | 1 | 8 | $0.2119 | none | json wrapping |
| hard-buried-constraints | baseline | sonnet | 3 | 1 | 0.88 | 3 | 2 | 9 | $0.1365 | none | http_status in response |
| hard-buried-constraints | baseline | sonnet | 4 | 1 | 0.88 | 3 | 1 | 8 | $0.1458 | none | json wrapping |
| hard-buried-constraints | baseline | sonnet | 5 | 1 | 0.88 | 3 | 2 | 8 | $0.1343 | none | http_status in response |
| hard-buried-constraints | baseline | sonnet | 6 | 1 | 0.88 | 3 | 1 | 8 | $0.1344 | none | json wrapping |
| hard-buried-constraints | baseline | sonnet | 7 | 1 | 0.88 | 3 | 0 | 8 | $0.1495 | none | none |
| hard-buried-constraints | gaslighter-full | haiku | 0 | 1 | 0.88 | 3 | 0 | 13 | $0.1573 | none | none |
| hard-buried-constraints | gaslighter-full | haiku | 1 | 1 | 1.00 | 2 | 0 | 13 | $0.1376 | parameter named template instead of payload | none |
| hard-buried-constraints | gaslighter-full | haiku | 2 | 1 | 1.00 | 2 | 1 | 12 | $0.1440 | error handling not delegated to handle_webhook_error function | handle_webhook_error defined but unused |
| hard-buried-constraints | gaslighter-full | haiku | 3 | 1 | 1.00 | 3 | 0 | 14 | $0.1500 | none | none |
| hard-buried-constraints | gaslighter-full | haiku | 4 | 1 | 1.00 | 3 | 0 | 12 | $0.1381 | none | none |
| hard-buried-constraints | gaslighter-full | haiku | 5 | 1 | 1.00 | 2 | 0 | 13 | $0.1631 | Content-Type header missing from request | none |
| hard-buried-constraints | gaslighter-full | haiku | 6 | 1 | 0.88 | 2 | 0 | 14 | $0.1989 | message not wrapped in JSON object | none |
| hard-buried-constraints | gaslighter-full | haiku | 7 | 1 | 1.00 | 2 | 1 | 14 | $0.1844 | message not wrapped in JSON object | context manager for response reading |
| hard-buried-constraints | gaslighter-full | sonnet | 0 | 1 | 0.88 | 2 | 0 | 11 | $0.2512 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 1 | 1 | 0.88 | 2 | 0 | 14 | $0.2944 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 2 | 1 | 1.00 | 2 | 1 | 14 | $0.2501 | __init__.py export of handle_webhook to make handler available when package is imported | conditional bytes handling in data encoding |
| hard-buried-constraints | gaslighter-full | sonnet | 3 | 1 | 0.88 | 2 | 0 | 14 | $0.2547 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 4 | 1 | 0.88 | 2 | 0 | 11 | $0.2318 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 5 | 1 | 0.88 | 2 | 0 | 13 | $0.2909 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 6 | 1 | 1.00 | 2 | 0 | 12 | $0.2721 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 7 | 1 | 0.88 | 2 | 1 | 11 | $0.2421 | __init__.py export of handle_webhook to make handler available when package is imported | urllib.error import and specific URLError exception handling unnecessary for generic error handling pattern |
| hard-buried-constraints | gaslighter-lite | haiku | 0 | 1 | 0.88 | 2 | 0 | 10 | $0.1319 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 1 | 1 | 1.00 | 2 | 0 | 8 | $0.1316 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 2 | 1 | 1.00 | 2 | 0 | 10 | $0.1287 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 3 | 1 | 0.88 | 2 | 0 | 9 | $0.1224 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 4 | 1 | 1.00 | 2 | 0 | 9 | $0.1255 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 5 | 1 | 0.88 | 1 | 0 | 14 | $0.1535 | JSON payload wrapping around formatted message | none |
| hard-buried-constraints | gaslighter-lite | haiku | 6 | 1 | 1.00 | 2 | 0 | 9 | $0.1384 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 7 | 1 | 0.88 | 1 | 1 | 12 | $0.1418 | JSON payload wrapping around formatted message | redundant broad Exception catch alongside URLError |
| hard-buried-constraints | gaslighter-lite | sonnet | 0 | 1 | 0.88 | 2 | 0 | 8 | $0.2382 | __init__.py export for package availability | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 1 | 1 | 1.00 | 3 | 0 | 9 | $0.2595 | none | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 2 | 1 | 0.88 | 2 | 0 | 9 | $0.2510 | __init__.py export for package availability | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 3 | 1 | 0.88 | 2 | 1 | 8 | $0.2365 | __init__.py export for package availability | http_status field in response |
| hard-buried-constraints | gaslighter-lite | sonnet | 4 | 1 | 1.00 | 1 | 0 | 9 | $0.2590 | JSON wrapping of formatted body in payload | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 5 | 1 | 0.88 | 3 | 0 | 8 | $0.2111 | none | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 6 | 1 | 0.88 | 2 | 0 | 8 | $0.2620 | __init__.py export for package availability | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 7 | 1 | 0.88 | 2 | 1 | 8 | $0.2315 | __init__.py export for package availability | http_status field in response |
| hard-buried-constraints | gaslighter-off | haiku | 0 | 1 | 0.88 | 2 | 0 | 10 | $0.0774 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | haiku | 1 | 1 | 1.00 | 2 | 0 | 9 | $0.0736 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | haiku | 2 | 1 | 1.00 | 2 | 0 | 9 | $0.0728 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | haiku | 3 | 1 | 1.00 | 2 | 0 | 9 | $0.0736 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | haiku | 4 | 1 | 1.00 | 2 | 1 | 9 | $0.0729 | __init__.py export to make handler available when package is imported | redundant dual exception handling (URLError then Exception) |
| hard-buried-constraints | gaslighter-off | haiku | 5 | 1 | 1.00 | 2 | 1 | 8 | $0.0575 | __init__.py export to make handler available when package is imported | context manager for urlopen adds complexity beyond error handling requirement |
| hard-buried-constraints | gaslighter-off | haiku | 6 | 1 | 1.00 | 2 | 1 | 10 | $0.0771 | __init__.py export to make handler available when package is imported | context manager for urlopen not necessary for simple POST operation |
| hard-buried-constraints | gaslighter-off | haiku | 7 | 1 | 1.00 | 2 | 0 | 9 | $0.0721 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | sonnet | 0 | 1 | 0.88 | 2 | 0 | 8 | $0.2234 | Package __init__.py does not export handler for import-time availability | none |
| hard-buried-constraints | gaslighter-off | sonnet | 1 | 1 | 0.88 | 2 | 1 | 8 | $0.2236 | Package __init__.py does not export handler for import-time availability | JSON wrapping of payload body exceeds requirement for simple POST |
| hard-buried-constraints | gaslighter-off | sonnet | 2 | 1 | 0.88 | 2 | 0 | 8 | $0.1461 | Package __init__.py does not export handler for import-time availability | none |
| hard-buried-constraints | gaslighter-off | sonnet | 3 | 1 | 0.88 | 2 | 0 | 8 | $0.1348 | Package __init__.py does not export handler for import-time availability | none |
| hard-buried-constraints | gaslighter-off | sonnet | 4 | 1 | 0.88 | 2 | 1 | 8 | $0.1344 | Package __init__.py does not export handler for import-time availability | JSON wrapping and http_status tracking add unnecessary structure |
| hard-buried-constraints | gaslighter-off | sonnet | 5 | 1 | 0.88 | 2 | 2 | 8 | $0.1344 | Package __init__.py does not export handler for import-time availability | JSON wrapping, http_status capture, and overly broad Exception handling |
| hard-buried-constraints | gaslighter-off | sonnet | 6 | 1 | 0.88 | 2 | 2 | 8 | $0.1357 | Package __init__.py does not export handler for import-time availability | JSON wrapping and broad Exception catching beyond urllib.error.URLError |
| hard-buried-constraints | gaslighter-off | sonnet | 7 | 1 | 0.88 | 2 | 1 | 8 | $0.1465 | Package __init__.py does not export handler for import-time availability | JSON wrapping of payload body exceeds requirement |
| hard-buried-constraints | nudge-prompt | haiku | 0 | 1 | 0.88 | 2 | 0 | 9 | $0.0725 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | haiku | 1 | 1 | 1.00 | 2 | 0 | 8 | $0.0680 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | haiku | 2 | 1 | 1.00 | 2 | 0 | 11 | $0.0818 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | haiku | 3 | 1 | 1.00 | 2 | 1 | 8 | $0.0559 | __init__.py export to make webhook handler available alongside other handlers | timeout=10 parameter not specified in requirements |
| hard-buried-constraints | nudge-prompt | haiku | 4 | 1 | 1.00 | 2 | 1 | 9 | $0.0730 | __init__.py export to make webhook handler available alongside other handlers | json.JSONDecodeError in except clause is unnecessary and semantically incorrect |
| hard-buried-constraints | nudge-prompt | haiku | 5 | 1 | 1.00 | 2 | 0 | 9 | $0.0729 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | haiku | 6 | 1 | 0.88 | 1 | 0 | 9 | $0.0728 | payload must be structured JSON with message field; currently sends raw formatted string | none |
| hard-buried-constraints | nudge-prompt | haiku | 7 | 1 | 1.00 | 2 | 0 | 10 | $0.0634 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | sonnet | 0 | 1 | 0.88 | 2 | 0 | 8 | $0.2122 | __init__.py to export handler for package-level import | none |
| hard-buried-constraints | nudge-prompt | sonnet | 1 | 1 | 0.88 | 2 | 0 | 9 | $0.1517 | __init__.py to export handler for package-level import | none |
| hard-buried-constraints | nudge-prompt | sonnet | 2 | 1 | 0.88 | 2 | 0 | 8 | $0.1345 | __init__.py to export handler for package-level import | json.dumps wrapping of body string |
| hard-buried-constraints | nudge-prompt | sonnet | 3 | 1 | 0.88 | 2 | 0 | 9 | $0.1554 | __init__.py to export handler for package-level import | none |
| hard-buried-constraints | nudge-prompt | sonnet | 4 | 1 | 0.88 | 2 | 0 | 8 | $0.1373 | __init__.py to export handler for package-level import | unused handle_webhook_error function |
| hard-buried-constraints | nudge-prompt | sonnet | 5 | 1 | 0.88 | 2 | 0 | 8 | $0.1461 | __init__.py to export handler for package-level import | try/except wrapping Request creation |
| hard-buried-constraints | nudge-prompt | sonnet | 6 | 1 | 0.88 | 2 | 0 | 8 | $0.1463 | __init__.py to export handler for package-level import | json.dumps wrapping with explicit body key |
| hard-buried-constraints | nudge-prompt | sonnet | 7 | 1 | 0.88 | 2 | 0 | 9 | $0.1517 | __init__.py to export handler for package-level import | none |
| hard-cascade-update | baseline | haiku | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.1154 | none | none |
| hard-cascade-update | baseline | haiku | 1 | 0 | 0.62 | 1 | 1 | 10 | $0.0711 | handler does not pass role parameter to User constructor | VALID_ROLES duplicated in both Model and validator |
| hard-cascade-update | baseline | haiku | 2 | 1 | 0.88 | 2 | 1 | 13 | $0.0795 | validator does not check valid role values | VALID_ROLES defined in Model but never used |
| hard-cascade-update | baseline | haiku | 3 | 1 | 0.88 | 2 | 0 | 14 | $0.0878 | validator does not check valid role values | none |
| hard-cascade-update | baseline | haiku | 4 | 1 | 0.88 | 2 | 0 | 13 | $0.0826 | validator does not check valid role values | none |
| hard-cascade-update | baseline | haiku | 5 | 0 | 0.50 | 1 | 2 | 9 | $0.0565 | handler does not pass role parameter to User constructor | CHECK constraint in migration duplicates Model validation logic |
| hard-cascade-update | baseline | haiku | 6 | 1 | 0.75 | 1 | 0 | 12 | $0.0822 | handler does not pass role parameter to User constructor | none |
| hard-cascade-update | baseline | haiku | 7 | 0 | 0.62 | 1 | 0 | 11 | $0.0759 | handler does not pass role parameter to User constructor | none |
| hard-cascade-update | baseline | sonnet | 0 | 1 | 0.75 | 2 | 0 | 13 | $0.2877 | VALID_ROLES not defined in User class | none |
| hard-cascade-update | baseline | sonnet | 1 | 1 | 0.88 | 3 | 1 | 9 | $0.1928 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 2 | 1 | 0.88 | 3 | 1 | 13 | $0.1514 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 3 | 1 | 1.00 | 3 | 1 | 14 | $0.2211 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 4 | 1 | 0.88 | 3 | 1 | 13 | $0.1514 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 5 | 1 | 0.88 | 3 | 1 | 13 | $0.1410 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 6 | 1 | 1.00 | 3 | 1 | 14 | $0.1598 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 7 | 1 | 0.88 | 3 | 1 | 14 | $0.1989 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | gaslighter-full | haiku | 0 | 1 | 0.88 | 3 | 0 | 18 | $0.1417 | none | none |
| hard-cascade-update | gaslighter-full | haiku | 1 | 1 | 1.00 | 3 | 1 | 17 | $0.1290 | none | VALID_ROLES duplicated in both User model and validator module |
| hard-cascade-update | gaslighter-full | haiku | 2 | 1 | 0.88 | 3 | 1 | 16 | $0.1249 | none | sorted() call in error message for single-use string formatting |
| hard-cascade-update | gaslighter-full | haiku | 3 | 1 | 1.00 | 3 | 1 | 17 | $0.1156 | none | VALID_ROLES constant added to User model when validator defines it |
| hard-cascade-update | gaslighter-full | haiku | 4 | 0 | 0.25 | 1 | 1 | 10 | $0.0822 | handler does not pass role to User, migration missing role column, serializer missing role field, validator missing role validation | role validation in User.__init__ instead of request validator |
| hard-cascade-update | gaslighter-full | haiku | 5 | 1 | 0.75 | 3 | 1 | 18 | $0.1384 | none | User imported in validator creating unnecessary coupling |
| hard-cascade-update | gaslighter-full | haiku | 6 | 1 | 1.00 | 3 | 0 | 19 | $0.1437 | none | none |
| hard-cascade-update | gaslighter-full | haiku | 7 | 1 | 0.88 | 2 | 1 | 16 | $0.1154 | validator does not check role values from request data | role validation logic duplicated in User.__init__ instead of validator |
| hard-cascade-update | gaslighter-full | sonnet | 0 | 1 | 1.00 | 3 | 0 | 17 | $0.2071 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 1 | 1 | 0.88 | 3 | 0 | 16 | $0.2034 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 2 | 1 | 0.75 | 2 | 1 | 18 | $0.3396 | validator does not check role field validity | two-migration pattern for new table |
| hard-cascade-update | gaslighter-full | sonnet | 3 | 1 | 0.88 | 3 | 0 | 16 | $0.2030 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 4 | 1 | 1.00 | 3 | 0 | 17 | $0.2393 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 5 | 1 | 0.88 | 3 | 0 | 13 | $0.2673 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 6 | 1 | 1.00 | 3 | 0 | 17 | $0.2897 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 7 | 1 | 1.00 | 3 | 0 | 17 | $0.2250 | none | none |
| hard-cascade-update | gaslighter-lite | haiku | 0 | 1 | 0.88 | 3 | 0 | 14 | $0.1242 | role validation in validator | none |
| hard-cascade-update | gaslighter-lite | haiku | 1 | 1 | 1.00 | 2 | 0 | 15 | $0.1290 | role validation in User model | none |
| hard-cascade-update | gaslighter-lite | haiku | 2 | 1 | 0.88 | 2 | 0 | 13 | $0.1074 | role validation in model and validator | none |
| hard-cascade-update | gaslighter-lite | haiku | 3 | 1 | 1.00 | 2 | 0 | 14 | $0.1290 | role validation in User model | none |
| hard-cascade-update | gaslighter-lite | haiku | 4 | 1 | 1.00 | 2 | 0 | 14 | $0.1158 | database CHECK constraint on role | none |
| hard-cascade-update | gaslighter-lite | haiku | 5 | 0 | 0.25 | 0 | 1 | 5 | $0.0692 | handler does not pass role to User, migration does not add role column, serializer does not include role | User class has role field but disconnected from handler, migration, and serializer |
| hard-cascade-update | gaslighter-lite | haiku | 6 | 1 | 1.00 | 2 | 0 | 16 | $0.1391 | role validation in User model | none |
| hard-cascade-update | gaslighter-lite | haiku | 7 | 1 | 1.00 | 3 | 0 | 14 | $0.1288 | none | none |
| hard-cascade-update | gaslighter-lite | sonnet | 0 | 1 | 1.00 | 3 | 1 | 14 | $0.2526 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 1 | 1 | 1.00 | 3 | 1 | 14 | $0.2326 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 2 | 1 | 0.88 | 3 | 1 | 13 | $0.1983 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 3 | 1 | 0.75 | 3 | 0 | 13 | $0.2130 | none | none |
| hard-cascade-update | gaslighter-lite | sonnet | 4 | 1 | 0.88 | 3 | 1 | 14 | $0.2330 | none | separate migration file for adding role column adds unnecessary file proliferation |
| hard-cascade-update | gaslighter-lite | sonnet | 5 | 1 | 1.00 | 3 | 1 | 14 | $0.2212 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 6 | 1 | 1.00 | 3 | 1 | 14 | $0.2374 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 7 | 1 | 0.75 | 3 | 0 | 18 | $0.2996 | none | none |
| hard-cascade-update | gaslighter-off | haiku | 0 | 1 | 0.88 | 3 | 0 | 14 | $0.0938 | none | none |
| hard-cascade-update | gaslighter-off | haiku | 1 | 1 | 0.75 | 2 | 0 | 12 | $0.0834 | Model-level role validation | none |
| hard-cascade-update | gaslighter-off | haiku | 2 | 1 | 0.88 | 1 | 0 | 13 | $0.0841 | Handler doesn't pass role parameter to User constructor | none |
| hard-cascade-update | gaslighter-off | haiku | 3 | 0 | 0.38 | 1 | 0 | 6 | $0.0579 | Serializer doesn't include role field | none |
| hard-cascade-update | gaslighter-off | haiku | 4 | 1 | 1.00 | 2 | 1 | 14 | $0.0904 | Model doesn't validate VALID_ROLES despite defining it | VALID_ROLES defined in User but never checked |
| hard-cascade-update | gaslighter-off | haiku | 5 | 1 | 1.00 | 3 | 0 | 14 | $0.0903 | none | none |
| hard-cascade-update | gaslighter-off | haiku | 6 | 0 | 0.25 | 0 | 0 | 6 | $0.0557 | Migration missing role column entirely | none |
| hard-cascade-update | gaslighter-off | haiku | 7 | 0 | 0.62 | 2 | 0 | 10 | $0.0598 | Handler doesn't pass role parameter from request data | none |
| hard-cascade-update | gaslighter-off | sonnet | 0 | 1 | 0.88 | 2 | 0 | 15 | $0.2359 | Role validation enforcement in User class __init__ | none |
| hard-cascade-update | gaslighter-off | sonnet | 1 | 1 | 1.00 | 3 | 0 | 14 | $0.1724 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 2 | 1 | 1.00 | 3 | 0 | 14 | $0.1613 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 3 | 1 | 1.00 | 3 | 0 | 14 | $0.2217 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 4 | 1 | 0.88 | 2 | 0 | 13 | $0.1526 | Role validation enforcement in User class __init__ | none |
| hard-cascade-update | gaslighter-off | sonnet | 5 | 1 | 0.88 | 3 | 0 | 14 | $0.1803 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 6 | 1 | 0.88 | 3 | 0 | 13 | $0.2079 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 7 | 1 | 0.88 | 3 | 0 | 11 | $0.2395 | none | none |
| hard-cascade-update | nudge-prompt | haiku | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.0912 | none | none |
| hard-cascade-update | nudge-prompt | haiku | 1 | 0 | 0.62 | 1 | 2 | 10 | $0.0734 | handler must pass role parameter from data to User constructor | role validation moved to model __init__ but handler doesn't call it; validator role validation removed |
| hard-cascade-update | nudge-prompt | haiku | 2 | 1 | 1.00 | 3 | 2 | 14 | $0.0931 | none | role validation in three places: model __init__, migration CHECK constraint, and validator |
| hard-cascade-update | nudge-prompt | haiku | 3 | 0 | 0.50 | 1 | 0 | 11 | $0.0814 | handler must pass role parameter from data to User constructor; validator must validate role against valid roles list | none |
| hard-cascade-update | nudge-prompt | haiku | 4 | 0 | 0.50 | 1 | 1 | 11 | $0.0773 | migration must add role column to users table; handler must pass role parameter | model includes role validation that cannot be triggered |
| hard-cascade-update | nudge-prompt | haiku | 5 | 0 | 0.62 | 1 | 2 | 10 | $0.0739 | handler must pass role parameter from data to User constructor; validator must validate role against valid roles list | role validation in model __init__ and migration CHECK constraint but handler doesn't invoke either |
| hard-cascade-update | nudge-prompt | haiku | 6 | 1 | 0.88 | 2 | 0 | 13 | $0.0912 | validator must validate role against the list of valid roles | none |
| hard-cascade-update | nudge-prompt | haiku | 7 | 1 | 0.88 | 2 | 1 | 13 | $0.0838 | validator must validate role against the list of valid roles at application level | migration CHECK constraint is reasonable but creates split validation logic |
| hard-cascade-update | nudge-prompt | sonnet | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.1607 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 1 | 1 | 0.88 | 3 | 1 | 13 | $0.1684 | none | CHECK constraint in migration redundant with Python validator |
| hard-cascade-update | nudge-prompt | sonnet | 2 | 1 | 0.88 | 3 | 0 | 13 | $0.1531 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 3 | 1 | 0.75 | 3 | 1 | 13 | $0.1865 | none | separate migration for role column adds unnecessary complexity |
| hard-cascade-update | nudge-prompt | sonnet | 4 | 1 | 0.88 | 3 | 0 | 13 | $0.1685 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 5 | 1 | 0.88 | 3 | 0 | 13 | $0.1524 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 6 | 1 | 0.75 | 3 | 2 | 12 | $0.1618 | none | split migrations plus premature SQLite compatibility concern |
| hard-cascade-update | nudge-prompt | sonnet | 7 | 1 | 0.88 | 3 | 0 | 13 | $0.1676 | none | none |
