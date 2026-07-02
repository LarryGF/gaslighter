# Gaslighter Eval Findings

Merged across two runs:
- `evals/runs/20260701-175238` — 2 tasks × 5 arms × 2 models × 8 runs = 160 cells
- `evals/runs/20260702-131009` — 5 tasks × 5 arms × 2 models × 3 runs = 150 cells

Combined: 310 cells. The two runs overlap on `hard-buried-constraints` and `hard-cascade-update` (now n=22/arm each, both runs pooled); `hard-implicit-patterns`, `hard-preserve-behavior`, and `hard-trailing-reqs` come only from the second run (n=6/arm each).

## Setup

- **Tasks**:
  - `hard-buried-constraints` — a requirement is buried mid-paragraph in prose
  - `hard-cascade-update` — one change implies several dependent file updates
  - `hard-implicit-patterns` — a convention lives in seed code, not the prompt
  - `hard-preserve-behavior` — fix a bug without "improving" intentional design
  - `hard-trailing-reqs` — requirements appended after the main ask
- **Arms**:
  - `baseline` — no plugin, no extra prompt
  - `gaslighter-off` — plugin loaded, hook fires but no-ops (control for plugin overhead)
  - `gaslighter-lite` — soft, non-blocking nudge
  - `gaslighter-full` — hard block until the model re-verifies
  - `nudge-prompt` — static "double check your work" text appended to the system prompt, no hook involved
- **Models**: haiku, sonnet
- **Scoring**:
  - *Automated*: deterministic code checks per task (`correct` = binary pass/fail, `complete_rate` = fraction of required checks passing)
  - *LLM judge*: an independent agent read each workspace's actual source and rated **completeness** (0-3, does it implement what was asked) and **overcorrection** (0-3, does it add unrequested structure/complexity)

**Note on hook version:** the second run (`20260702-131009`) finished before the Stop-hook's anti-loop guard was fixed to stop nudging as soon as the model declares 100% confidence, instead of always counting to a fixed cap of 3 (see `CLAUDE.md`). Both runs in this merged table reflect the pre-fix hook behavior. A future run post-fix would be expected to show a similar completeness/correctness profile for `gaslighter-full`/`gaslighter-lite` at a lower turn/cost premium, since the fix specifically removes redundant nudges once the model has already re-verified.

**Note on sample size:** the two runs use different run-counts per cell (8 vs 3), so per-task n varies (22 for the two overlapping tasks, 6 for the three new-only tasks). Treat single-cell and per-task numbers as directional, especially for the n=6 tasks.

## Headline result (merged, n=62 per arm — all 5 tasks, both models, both runs)

| Arm | n | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|---|
| baseline | 62 | 0.887 | 0.893 | 2.42 | 0.48 | 8.8 | $0.1178 |
| gaslighter-off | 62 | 0.935 | 0.915 | 2.39 | 0.31 | 9.0 | $0.1181 |
| gaslighter-lite | 62 | 0.952 | 0.929 | 2.42 | 0.40 | 9.7 | $0.1672 |
| gaslighter-full | 62 | 0.984 | 0.945 | 2.60 | 0.31 | 13.2 | $0.1839 |
| nudge-prompt | 62 | 0.903 | 0.891 | 2.37 | 0.35 | 8.8 | $0.1103 |

## Key findings

1. **`gaslighter-full` leads on every automated and judge quality metric.** Highest correct (0.984), highest auto-complete (0.945), highest judge completeness (2.60), and its overcorrection (0.31) ties gaslighter-off for lowest among the two active hook modes — well below gaslighter-lite's 0.40. This holds up after merging in the larger, 5-task second run, not just on the original 2-task sample.

2. **The turn/cost premium is real and consistent.** `gaslighter-full` averages 13.2 turns / $0.1839 per run vs baseline's 8.8 turns / $0.1178 — roughly 50% more turns, 56% more cost. `gaslighter-lite` sits in between (9.7 turns / $0.1672). This is the same trade-off seen in both runs individually; merging didn't change the shape of it.

3. **`gaslighter-off` (a no-op control) beats baseline on correctness (0.935 vs 0.887) and cuts overcorrection nearly in half (0.31 vs 0.48).** Since the hook does nothing in this arm, this points to real variance in the environment/scoring rather than an effect of the plugin itself — worth treating baseline-vs-control gaps of this size as noise floor when reading the other comparisons.

4. **The task-dependent story holds: `hard-cascade-update` carries almost all of the between-arm spread.** Merged across both runs, baseline drops to 0.682 correct / 0.768 complete on this task, while `gaslighter-full` holds 0.955 / 0.899 — the largest gap of any task. Every other task sits at or near correct=1.000 for every arm regardless of nudging, so this one multi-file cascade task is where the effect concentrates.

5. **`nudge-prompt` (static system-prompt text, no hook) underperforms both active gaslighter modes on correctness (0.903 vs 0.952/0.984)** and shows worse overcorrection than `gaslighter-full` (0.35 vs 0.31) at a lower turn/cost premium (8.8 turns / $0.1103) — cheap, but not as effective as the interactive Stop-hook nudge.

## Per-task summary (merged; n=22/arm for tasks in both runs, n=6/arm for tasks only in the second run)

| Task | Arm | n | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|---|---|
| hard-buried-constraints | baseline | 22 | 1.000 | 0.929 | 2.27 | 0.64 | 8.8 | $0.1282 |
| hard-buried-constraints | gaslighter-off | 22 | 1.000 | 0.924 | 2.00 | 0.59 | 8.5 | $0.1169 |
| hard-buried-constraints | gaslighter-lite | 22 | 1.000 | 0.929 | 1.86 | 0.18 | 9.3 | $0.1847 |
| hard-buried-constraints | gaslighter-full | 22 | 1.000 | 0.945 | 2.14 | 0.23 | 13.0 | $0.2129 |
| hard-buried-constraints | nudge-prompt | 22 | 1.000 | 0.929 | 1.91 | 0.23 | 8.7 | $0.1112 |
| hard-cascade-update | baseline | 22 | 0.682 | 0.768 | 2.18 | 0.55 | 11.6 | $0.1265 |
| hard-cascade-update | gaslighter-off | 22 | 0.818 | 0.837 | 2.32 | 0.09 | 12.5 | $0.1394 |
| hard-cascade-update | gaslighter-lite | 22 | 0.864 | 0.870 | 2.55 | 0.41 | 13.5 | $0.1781 |
| hard-cascade-update | gaslighter-full | 22 | 0.955 | 0.899 | 2.77 | 0.32 | 16.5 | $0.1875 |
| hard-cascade-update | nudge-prompt | 22 | 0.727 | 0.763 | 2.32 | 0.55 | 11.7 | $0.1224 |
| hard-implicit-patterns | baseline | 6 | 1.000 | 1.000 | 2.83 | 0.33 | 6.7 | $0.0950 |
| hard-implicit-patterns | gaslighter-off | 6 | 1.000 | 1.000 | 2.83 | 0.50 | 6.5 | $0.0935 |
| hard-implicit-patterns | gaslighter-lite | 6 | 1.000 | 1.000 | 3.00 | 0.67 | 7.0 | $0.1336 |
| hard-implicit-patterns | gaslighter-full | 6 | 1.000 | 1.000 | 3.00 | 0.33 | 11.3 | $0.1404 |
| hard-implicit-patterns | nudge-prompt | 6 | 1.000 | 1.000 | 3.00 | 0.50 | 7.3 | $0.0999 |
| hard-preserve-behavior | baseline | 6 | 1.000 | 1.000 | 3.00 | 0.33 | 4.2 | $0.0841 |
| hard-preserve-behavior | gaslighter-off | 6 | 1.000 | 1.000 | 3.00 | 0.17 | 3.8 | $0.0767 |
| hard-preserve-behavior | gaslighter-lite | 6 | 1.000 | 1.000 | 2.83 | 0.67 | 4.3 | $0.1167 |
| hard-preserve-behavior | gaslighter-full | 6 | 1.000 | 1.000 | 3.00 | 0.33 | 7.5 | $0.1230 |
| hard-preserve-behavior | nudge-prompt | 6 | 1.000 | 1.000 | 3.00 | 0.17 | 4.0 | $0.0774 |
| hard-trailing-reqs | baseline | 6 | 1.000 | 1.000 | 2.83 | 0.00 | 4.8 | $0.1037 |
| hard-trailing-reqs | gaslighter-off | 6 | 1.000 | 1.000 | 3.00 | 0.00 | 5.3 | $0.1102 |
| hard-trailing-reqs | gaslighter-lite | 6 | 1.000 | 1.000 | 3.00 | 0.67 | 5.2 | $0.1474 |
| hard-trailing-reqs | gaslighter-full | 6 | 1.000 | 1.000 | 2.83 | 0.50 | 9.8 | $0.1688 |
| hard-trailing-reqs | nudge-prompt | 6 | 1.000 | 1.000 | 3.00 | 0.17 | 5.2 | $0.1056 |

`hard-cascade-update` remains the clear outlier — every other task sits at or near correct=1.000 for every arm, so it carries almost all of the between-arm signal in the merged dataset.

## Methodology notes

- Automated scores (`correct`, `complete_rate`) are deterministic, code-based checks — the same task always scores the same way for the same code.
- Judge scores (`completeness`, `overcorrection`) come from one independent LLM read per cell, no cross-judge voting or redundancy. Treat exact decimal means as directional signal, not precise measurement.
- The two runs use different run-counts per cell (8 for the first run, 3 for the second) — the appendix below tags each row with its source run stamp so this is traceable per row.
- This eval suite's judging pipeline had two bugs fixed after the second run was judged: the judge skill referenced a nonexistent `StructuredOutput` tool, and intermediate JSON files were written unindented (single massive line), causing the Read tool to truncate them and some judge-agents to fabricate or duplicate scores to hit the expected count. Both are fixed in `skills/judge/SKILL.md` and `agents/judge-agent.md`; the judge scores in this document were produced with the corrected pipeline (every task-agent returned exactly the expected count, no padding).

## Full per-run table (all 310 cells)

| Task | Arm | Model | Run Stamp | Run | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost | Missing (judge) | Overcorrection cite (judge) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hard-buried-constraints | baseline | haiku | 20260701-175238 | 0 | 1 | 1.00 | 2 | 0 | 9 | $0.0768 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | haiku | 20260701-175238 | 1 | 1 | 1.00 | 2 | 0 | 10 | $0.0916 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | haiku | 20260701-175238 | 2 | 1 | 1.00 | 2 | 1 | 9 | $0.0610 | Handler not exported in notifications/__init__.py for package import availability | urllib.error imports not required (catches all Exception anyway) |
| hard-buried-constraints | baseline | haiku | 20260701-175238 | 3 | 1 | 1.00 | 2 | 1 | 9 | $0.0874 | Handler not exported in notifications/__init__.py for package import availability | unused handle_webhook_error function when error handling done inline |
| hard-buried-constraints | baseline | haiku | 20260701-175238 | 4 | 1 | 1.00 | 1 | 2 | 10 | $0.0771 | Handler signature deviates from established pattern (optional payload param breaks consistency with email/sms handlers) | complex payload type checking and conditional template formatting not in other handlers |
| hard-buried-constraints | baseline | haiku | 20260701-175238 | 5 | 1 | 1.00 | 2 | 0 | 8 | $0.0558 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | haiku | 20260701-175238 | 6 | 1 | 0.88 | 2 | 0 | 11 | $0.0816 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | haiku | 20260701-175238 | 7 | 1 | 1.00 | 2 | 0 | 8 | $0.0560 | Handler not exported in notifications/__init__.py for package import availability | none |
| hard-buried-constraints | baseline | haiku | 20260702-131009 | 0 | 1 | 1.00 | 2 | 0 | 10 | $0.1036 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | baseline | haiku | 20260702-131009 | 1 | 1 | 0.88 | 2 | 0 | 10 | $0.1038 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | baseline | haiku | 20260702-131009 | 2 | 1 | 1.00 | 2 | 0 | 10 | $0.1042 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | baseline | sonnet | 20260701-175238 | 0 | 1 | 0.88 | 3 | 0 | 9 | $0.2316 | none | none |
| hard-buried-constraints | baseline | sonnet | 20260701-175238 | 1 | 1 | 0.88 | 3 | 1 | 8 | $0.2123 | none | json wrapping |
| hard-buried-constraints | baseline | sonnet | 20260701-175238 | 2 | 1 | 0.88 | 3 | 1 | 8 | $0.2119 | none | json wrapping |
| hard-buried-constraints | baseline | sonnet | 20260701-175238 | 3 | 1 | 0.88 | 3 | 2 | 9 | $0.1365 | none | http_status in response |
| hard-buried-constraints | baseline | sonnet | 20260701-175238 | 4 | 1 | 0.88 | 3 | 1 | 8 | $0.1458 | none | json wrapping |
| hard-buried-constraints | baseline | sonnet | 20260701-175238 | 5 | 1 | 0.88 | 3 | 2 | 8 | $0.1343 | none | http_status in response |
| hard-buried-constraints | baseline | sonnet | 20260701-175238 | 6 | 1 | 0.88 | 3 | 1 | 8 | $0.1344 | none | json wrapping |
| hard-buried-constraints | baseline | sonnet | 20260701-175238 | 7 | 1 | 0.88 | 3 | 0 | 8 | $0.1495 | none | none |
| hard-buried-constraints | baseline | sonnet | 20260702-131009 | 0 | 1 | 0.88 | 2 | 1 | 8 | $0.2122 | __init__.py not updated to export handle_webhook | http_status field in success response |
| hard-buried-constraints | baseline | sonnet | 20260702-131009 | 1 | 1 | 0.88 | 1 | 0 | 8 | $0.2138 | __init__.py export and raw body instead of JSON-encoded payload | none |
| hard-buried-constraints | baseline | sonnet | 20260702-131009 | 2 | 1 | 0.88 | 2 | 1 | 8 | $0.1398 | __init__.py not updated to export handle_webhook | status_code field and response reading unnecessary |
| hard-buried-constraints | gaslighter-off | haiku | 20260701-175238 | 0 | 1 | 0.88 | 2 | 0 | 10 | $0.0774 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260701-175238 | 1 | 1 | 1.00 | 2 | 0 | 9 | $0.0736 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260701-175238 | 2 | 1 | 1.00 | 2 | 0 | 9 | $0.0728 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260701-175238 | 3 | 1 | 1.00 | 2 | 0 | 9 | $0.0736 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260701-175238 | 4 | 1 | 1.00 | 2 | 1 | 9 | $0.0729 | __init__.py export to make handler available when package is imported | redundant dual exception handling (URLError then Exception) |
| hard-buried-constraints | gaslighter-off | haiku | 20260701-175238 | 5 | 1 | 1.00 | 2 | 1 | 8 | $0.0575 | __init__.py export to make handler available when package is imported | context manager for urlopen adds complexity beyond error handling requirement |
| hard-buried-constraints | gaslighter-off | haiku | 20260701-175238 | 6 | 1 | 1.00 | 2 | 1 | 10 | $0.0771 | __init__.py export to make handler available when package is imported | context manager for urlopen not necessary for simple POST operation |
| hard-buried-constraints | gaslighter-off | haiku | 20260701-175238 | 7 | 1 | 1.00 | 2 | 0 | 9 | $0.0721 | __init__.py export to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260702-131009 | 0 | 1 | 1.00 | 2 | 0 | 9 | $0.0998 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260702-131009 | 1 | 1 | 0.88 | 2 | 0 | 8 | $0.0572 | __init__.py not updated; sends raw body instead of JSON | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260702-131009 | 2 | 1 | 0.88 | 2 | 1 | 9 | $0.0728 | __init__.py not updated to export handle_webhook | url field in response and unnecessary response reading |
| hard-buried-constraints | gaslighter-off | sonnet | 20260701-175238 | 0 | 1 | 0.88 | 2 | 0 | 8 | $0.2234 | Package __init__.py does not export handler for import-time availability | none |
| hard-buried-constraints | gaslighter-off | sonnet | 20260701-175238 | 1 | 1 | 0.88 | 2 | 1 | 8 | $0.2236 | Package __init__.py does not export handler for import-time availability | JSON wrapping of payload body exceeds requirement for simple POST |
| hard-buried-constraints | gaslighter-off | sonnet | 20260701-175238 | 2 | 1 | 0.88 | 2 | 0 | 8 | $0.1461 | Package __init__.py does not export handler for import-time availability | none |
| hard-buried-constraints | gaslighter-off | sonnet | 20260701-175238 | 3 | 1 | 0.88 | 2 | 0 | 8 | $0.1348 | Package __init__.py does not export handler for import-time availability | none |
| hard-buried-constraints | gaslighter-off | sonnet | 20260701-175238 | 4 | 1 | 0.88 | 2 | 1 | 8 | $0.1344 | Package __init__.py does not export handler for import-time availability | JSON wrapping and http_status tracking add unnecessary structure |
| hard-buried-constraints | gaslighter-off | sonnet | 20260701-175238 | 5 | 1 | 0.88 | 2 | 2 | 8 | $0.1344 | Package __init__.py does not export handler for import-time availability | JSON wrapping, http_status capture, and overly broad Exception handling |
| hard-buried-constraints | gaslighter-off | sonnet | 20260701-175238 | 6 | 1 | 0.88 | 2 | 2 | 8 | $0.1357 | Package __init__.py does not export handler for import-time availability | JSON wrapping and broad Exception catching beyond urllib.error.URLError |
| hard-buried-constraints | gaslighter-off | sonnet | 20260701-175238 | 7 | 1 | 0.88 | 2 | 1 | 8 | $0.1465 | Package __init__.py does not export handler for import-time availability | JSON wrapping of payload body exceeds requirement |
| hard-buried-constraints | gaslighter-off | sonnet | 20260702-131009 | 0 | 1 | 0.88 | 2 | 1 | 8 | $0.1353 | __init__.py not updated to export handle_webhook | unused handle_webhook_error function |
| hard-buried-constraints | gaslighter-off | sonnet | 20260702-131009 | 1 | 1 | 0.88 | 2 | 1 | 8 | $0.1364 | __init__.py not updated to export handle_webhook | unused handle_webhook_error function |
| hard-buried-constraints | gaslighter-off | sonnet | 20260702-131009 | 2 | 1 | 0.88 | 2 | 0 | 8 | $0.2142 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260701-175238 | 0 | 1 | 0.88 | 2 | 0 | 10 | $0.1319 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260701-175238 | 1 | 1 | 1.00 | 2 | 0 | 8 | $0.1316 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260701-175238 | 2 | 1 | 1.00 | 2 | 0 | 10 | $0.1287 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260701-175238 | 3 | 1 | 0.88 | 2 | 0 | 9 | $0.1224 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260701-175238 | 4 | 1 | 1.00 | 2 | 0 | 9 | $0.1255 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260701-175238 | 5 | 1 | 0.88 | 1 | 0 | 14 | $0.1535 | JSON payload wrapping around formatted message | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260701-175238 | 6 | 1 | 1.00 | 2 | 0 | 9 | $0.1384 | __init__.py export to make handler available on package import | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260701-175238 | 7 | 1 | 0.88 | 1 | 1 | 12 | $0.1418 | JSON payload wrapping around formatted message | redundant broad Exception catch alongside URLError |
| hard-buried-constraints | gaslighter-lite | haiku | 20260702-131009 | 0 | 1 | 1.00 | 2 | 0 | 9 | $0.1173 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260702-131009 | 1 | 1 | 1.00 | 2 | 0 | 12 | $0.1549 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260702-131009 | 2 | 1 | 1.00 | 2 | 0 | 10 | $0.1156 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260701-175238 | 0 | 1 | 0.88 | 2 | 0 | 8 | $0.2382 | __init__.py export for package availability | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260701-175238 | 1 | 1 | 1.00 | 3 | 0 | 9 | $0.2595 | none | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260701-175238 | 2 | 1 | 0.88 | 2 | 0 | 9 | $0.2510 | __init__.py export for package availability | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260701-175238 | 3 | 1 | 0.88 | 2 | 1 | 8 | $0.2365 | __init__.py export for package availability | http_status field in response |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260701-175238 | 4 | 1 | 1.00 | 1 | 0 | 9 | $0.2590 | JSON wrapping of formatted body in payload | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260701-175238 | 5 | 1 | 0.88 | 3 | 0 | 8 | $0.2111 | none | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260701-175238 | 6 | 1 | 0.88 | 2 | 0 | 8 | $0.2620 | __init__.py export for package availability | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260701-175238 | 7 | 1 | 0.88 | 2 | 1 | 8 | $0.2315 | __init__.py export for package availability | http_status field in response |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260702-131009 | 0 | 1 | 0.88 | 1 | 0 | 8 | $0.2068 | __init__.py export and raw body instead of JSON payload | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260702-131009 | 1 | 1 | 0.88 | 2 | 1 | 9 | $0.2216 | __init__.py not updated to export handle_webhook | http_status field and response context manager unnecessary |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260702-131009 | 2 | 1 | 0.88 | 1 | 0 | 8 | $0.2251 | __init__.py export and raw body instead of JSON payload | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260701-175238 | 0 | 1 | 0.88 | 3 | 0 | 13 | $0.1573 | none | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260701-175238 | 1 | 1 | 1.00 | 2 | 0 | 13 | $0.1376 | parameter named template instead of payload | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260701-175238 | 2 | 1 | 1.00 | 2 | 1 | 12 | $0.1440 | error handling not delegated to handle_webhook_error function | handle_webhook_error defined but unused |
| hard-buried-constraints | gaslighter-full | haiku | 20260701-175238 | 3 | 1 | 1.00 | 3 | 0 | 14 | $0.1500 | none | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260701-175238 | 4 | 1 | 1.00 | 3 | 0 | 12 | $0.1381 | none | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260701-175238 | 5 | 1 | 1.00 | 2 | 0 | 13 | $0.1631 | Content-Type header missing from request | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260701-175238 | 6 | 1 | 0.88 | 2 | 0 | 14 | $0.1989 | message not wrapped in JSON object | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260701-175238 | 7 | 1 | 1.00 | 2 | 1 | 14 | $0.1844 | message not wrapped in JSON object | context manager for response reading |
| hard-buried-constraints | gaslighter-full | haiku | 20260702-131009 | 0 | 1 | 1.00 | 2 | 0 | 16 | $0.1568 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260702-131009 | 1 | 1 | 1.00 | 2 | 0 | 12 | $0.1339 | __init__.py not updated; sends raw body instead of JSON | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260702-131009 | 2 | 1 | 0.88 | 2 | 0 | 12 | $0.1538 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260701-175238 | 0 | 1 | 0.88 | 2 | 0 | 11 | $0.2512 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260701-175238 | 1 | 1 | 0.88 | 2 | 0 | 14 | $0.2944 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260701-175238 | 2 | 1 | 1.00 | 2 | 1 | 14 | $0.2501 | __init__.py export of handle_webhook to make handler available when package is imported | conditional bytes handling in data encoding |
| hard-buried-constraints | gaslighter-full | sonnet | 20260701-175238 | 3 | 1 | 0.88 | 2 | 0 | 14 | $0.2547 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260701-175238 | 4 | 1 | 0.88 | 2 | 0 | 11 | $0.2318 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260701-175238 | 5 | 1 | 0.88 | 2 | 0 | 13 | $0.2909 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260701-175238 | 6 | 1 | 1.00 | 2 | 0 | 12 | $0.2721 | __init__.py export of handle_webhook to make handler available when package is imported | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260701-175238 | 7 | 1 | 0.88 | 2 | 1 | 11 | $0.2421 | __init__.py export of handle_webhook to make handler available when package is imported | urllib.error import and specific URLError exception handling unnecessary for generic error handling pattern |
| hard-buried-constraints | gaslighter-full | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 2 | 0 | 15 | $0.3304 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 2 | 1 | 14 | $0.3011 | __init__.py not updated to export handle_webhook | unused handle_webhook_error function defined but inlined in except block |
| hard-buried-constraints | gaslighter-full | sonnet | 20260702-131009 | 2 | 1 | 0.88 | 2 | 0 | 11 | $0.2478 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260701-175238 | 0 | 1 | 0.88 | 2 | 0 | 9 | $0.0725 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260701-175238 | 1 | 1 | 1.00 | 2 | 0 | 8 | $0.0680 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260701-175238 | 2 | 1 | 1.00 | 2 | 0 | 11 | $0.0818 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260701-175238 | 3 | 1 | 1.00 | 2 | 1 | 8 | $0.0559 | __init__.py export to make webhook handler available alongside other handlers | timeout=10 parameter not specified in requirements |
| hard-buried-constraints | nudge-prompt | haiku | 20260701-175238 | 4 | 1 | 1.00 | 2 | 1 | 9 | $0.0730 | __init__.py export to make webhook handler available alongside other handlers | json.JSONDecodeError in except clause is unnecessary and semantically incorrect |
| hard-buried-constraints | nudge-prompt | haiku | 20260701-175238 | 5 | 1 | 1.00 | 2 | 0 | 9 | $0.0729 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260701-175238 | 6 | 1 | 0.88 | 1 | 0 | 9 | $0.0728 | payload must be structured JSON with message field; currently sends raw formatted string | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260701-175238 | 7 | 1 | 1.00 | 2 | 0 | 10 | $0.0634 | __init__.py export to make webhook handler available alongside other handlers | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260702-131009 | 0 | 1 | 1.00 | 2 | 0 | 9 | $0.0731 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260702-131009 | 1 | 1 | 1.00 | 2 | 0 | 9 | $0.0730 | __init__.py not updated to export handle_webhook | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260702-131009 | 2 | 1 | 1.00 | 2 | 1 | 8 | $0.0690 | __init__.py not updated to export handle_webhook | unnecessary json.JSONDecodeError in exception tuple |
| hard-buried-constraints | nudge-prompt | sonnet | 20260701-175238 | 0 | 1 | 0.88 | 2 | 0 | 8 | $0.2122 | __init__.py to export handler for package-level import | none |
| hard-buried-constraints | nudge-prompt | sonnet | 20260701-175238 | 1 | 1 | 0.88 | 2 | 0 | 9 | $0.1517 | __init__.py to export handler for package-level import | none |
| hard-buried-constraints | nudge-prompt | sonnet | 20260701-175238 | 2 | 1 | 0.88 | 2 | 0 | 8 | $0.1345 | __init__.py to export handler for package-level import | json.dumps wrapping of body string |
| hard-buried-constraints | nudge-prompt | sonnet | 20260701-175238 | 3 | 1 | 0.88 | 2 | 0 | 9 | $0.1554 | __init__.py to export handler for package-level import | none |
| hard-buried-constraints | nudge-prompt | sonnet | 20260701-175238 | 4 | 1 | 0.88 | 2 | 0 | 8 | $0.1373 | __init__.py to export handler for package-level import | unused handle_webhook_error function |
| hard-buried-constraints | nudge-prompt | sonnet | 20260701-175238 | 5 | 1 | 0.88 | 2 | 0 | 8 | $0.1461 | __init__.py to export handler for package-level import | try/except wrapping Request creation |
| hard-buried-constraints | nudge-prompt | sonnet | 20260701-175238 | 6 | 1 | 0.88 | 2 | 0 | 8 | $0.1463 | __init__.py to export handler for package-level import | json.dumps wrapping with explicit body key |
| hard-buried-constraints | nudge-prompt | sonnet | 20260701-175238 | 7 | 1 | 0.88 | 2 | 0 | 9 | $0.1517 | __init__.py to export handler for package-level import | none |
| hard-buried-constraints | nudge-prompt | sonnet | 20260702-131009 | 0 | 1 | 0.88 | 1 | 0 | 8 | $0.1362 | __init__.py export and raw body instead of JSON payload | none |
| hard-buried-constraints | nudge-prompt | sonnet | 20260702-131009 | 1 | 1 | 0.88 | 2 | 1 | 8 | $0.1475 | __init__.py not updated to export handle_webhook | response reading with context manager unnecessary |
| hard-buried-constraints | nudge-prompt | sonnet | 20260702-131009 | 2 | 1 | 0.88 | 2 | 1 | 9 | $0.1529 | __init__.py not updated to export handle_webhook | unnecessary .close() call on urlopen response |
| hard-cascade-update | baseline | haiku | 20260701-175238 | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.1154 | none | none |
| hard-cascade-update | baseline | haiku | 20260701-175238 | 1 | 0 | 0.62 | 1 | 1 | 10 | $0.0711 | handler does not pass role parameter to User constructor | VALID_ROLES duplicated in both Model and validator |
| hard-cascade-update | baseline | haiku | 20260701-175238 | 2 | 1 | 0.88 | 2 | 1 | 13 | $0.0795 | validator does not check valid role values | VALID_ROLES defined in Model but never used |
| hard-cascade-update | baseline | haiku | 20260701-175238 | 3 | 1 | 0.88 | 2 | 0 | 14 | $0.0878 | validator does not check valid role values | none |
| hard-cascade-update | baseline | haiku | 20260701-175238 | 4 | 1 | 0.88 | 2 | 0 | 13 | $0.0826 | validator does not check valid role values | none |
| hard-cascade-update | baseline | haiku | 20260701-175238 | 5 | 0 | 0.50 | 1 | 2 | 9 | $0.0565 | handler does not pass role parameter to User constructor | CHECK constraint in migration duplicates Model validation logic |
| hard-cascade-update | baseline | haiku | 20260701-175238 | 6 | 1 | 0.75 | 1 | 0 | 12 | $0.0822 | handler does not pass role parameter to User constructor | none |
| hard-cascade-update | baseline | haiku | 20260701-175238 | 7 | 0 | 0.62 | 1 | 0 | 11 | $0.0759 | handler does not pass role parameter to User constructor | none |
| hard-cascade-update | baseline | haiku | 20260702-131009 | 0 | 0 | 0.62 | 2 | 0 | 10 | $0.0714 | handler role propagation | none |
| hard-cascade-update | baseline | haiku | 20260702-131009 | 1 | 0 | 0.62 | 2 | 0 | 10 | $0.0713 | handler role propagation | none |
| hard-cascade-update | baseline | haiku | 20260702-131009 | 2 | 0 | 0.50 | 1 | 0 | 8 | $0.0643 | valid role constraint in migration and handler role propagation | none |
| hard-cascade-update | baseline | sonnet | 20260701-175238 | 0 | 1 | 0.75 | 2 | 0 | 13 | $0.2877 | VALID_ROLES not defined in User class | none |
| hard-cascade-update | baseline | sonnet | 20260701-175238 | 1 | 1 | 0.88 | 3 | 1 | 9 | $0.1928 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 20260701-175238 | 2 | 1 | 0.88 | 3 | 1 | 13 | $0.1514 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 20260701-175238 | 3 | 1 | 1.00 | 3 | 1 | 14 | $0.2211 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 20260701-175238 | 4 | 1 | 0.88 | 3 | 1 | 13 | $0.1514 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 20260701-175238 | 5 | 1 | 0.88 | 3 | 1 | 13 | $0.1410 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 20260701-175238 | 6 | 1 | 1.00 | 3 | 1 | 14 | $0.1598 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 20260701-175238 | 7 | 1 | 0.88 | 3 | 1 | 14 | $0.1989 | none | VALID_ROLES duplicated in validator |
| hard-cascade-update | baseline | sonnet | 20260702-131009 | 0 | 0 | 0.25 | 1 | 0 | 4 | $0.1066 | database schema migration with role column | none |
| hard-cascade-update | baseline | sonnet | 20260702-131009 | 1 | 1 | 0.75 | 3 | 1 | 12 | $0.1624 | none | separate migration file for role column addition |
| hard-cascade-update | baseline | sonnet | 20260702-131009 | 2 | 1 | 0.88 | 3 | 0 | 13 | $0.1523 | none | none |
| hard-cascade-update | gaslighter-off | haiku | 20260701-175238 | 0 | 1 | 0.88 | 3 | 0 | 14 | $0.0938 | none | none |
| hard-cascade-update | gaslighter-off | haiku | 20260701-175238 | 1 | 1 | 0.75 | 2 | 0 | 12 | $0.0834 | Model-level role validation | none |
| hard-cascade-update | gaslighter-off | haiku | 20260701-175238 | 2 | 1 | 0.88 | 1 | 0 | 13 | $0.0841 | Handler doesn't pass role parameter to User constructor | none |
| hard-cascade-update | gaslighter-off | haiku | 20260701-175238 | 3 | 0 | 0.38 | 1 | 0 | 6 | $0.0579 | Serializer doesn't include role field | none |
| hard-cascade-update | gaslighter-off | haiku | 20260701-175238 | 4 | 1 | 1.00 | 2 | 1 | 14 | $0.0904 | Model doesn't validate VALID_ROLES despite defining it | VALID_ROLES defined in User but never checked |
| hard-cascade-update | gaslighter-off | haiku | 20260701-175238 | 5 | 1 | 1.00 | 3 | 0 | 14 | $0.0903 | none | none |
| hard-cascade-update | gaslighter-off | haiku | 20260701-175238 | 6 | 0 | 0.25 | 0 | 0 | 6 | $0.0557 | Migration missing role column entirely | none |
| hard-cascade-update | gaslighter-off | haiku | 20260701-175238 | 7 | 0 | 0.62 | 2 | 0 | 10 | $0.0598 | Handler doesn't pass role parameter from request data | none |
| hard-cascade-update | gaslighter-off | haiku | 20260702-131009 | 0 | 1 | 0.75 | 2 | 1 | 12 | $0.0807 | handler role propagation | role validation in User __init__ in addition to validator |
| hard-cascade-update | gaslighter-off | haiku | 20260702-131009 | 1 | 0 | 0.62 | 1 | 0 | 10 | $0.0718 | handler role propagation and validator role checking | none |
| hard-cascade-update | gaslighter-off | haiku | 20260702-131009 | 2 | 1 | 0.88 | 3 | 0 | 13 | $0.0922 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260701-175238 | 0 | 1 | 0.88 | 2 | 0 | 15 | $0.2359 | Role validation enforcement in User class __init__ | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260701-175238 | 1 | 1 | 1.00 | 3 | 0 | 14 | $0.1724 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260701-175238 | 2 | 1 | 1.00 | 3 | 0 | 14 | $0.1613 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260701-175238 | 3 | 1 | 1.00 | 3 | 0 | 14 | $0.2217 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260701-175238 | 4 | 1 | 0.88 | 2 | 0 | 13 | $0.1526 | Role validation enforcement in User class __init__ | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260701-175238 | 5 | 1 | 0.88 | 3 | 0 | 14 | $0.1803 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260701-175238 | 6 | 1 | 0.88 | 3 | 0 | 13 | $0.2079 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260701-175238 | 7 | 1 | 0.88 | 3 | 0 | 11 | $0.2395 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.1824 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 14 | $0.2234 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 14 | $0.2283 | none | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260701-175238 | 0 | 1 | 0.88 | 3 | 0 | 14 | $0.1242 | role validation in validator | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260701-175238 | 1 | 1 | 1.00 | 2 | 0 | 15 | $0.1290 | role validation in User model | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260701-175238 | 2 | 1 | 0.88 | 2 | 0 | 13 | $0.1074 | role validation in model and validator | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260701-175238 | 3 | 1 | 1.00 | 2 | 0 | 14 | $0.1290 | role validation in User model | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260701-175238 | 4 | 1 | 1.00 | 2 | 0 | 14 | $0.1158 | database CHECK constraint on role | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260701-175238 | 5 | 0 | 0.25 | 0 | 1 | 5 | $0.0692 | handler does not pass role to User, migration does not add role column, serializer does not include role | User class has role field but disconnected from handler, migration, and serializer |
| hard-cascade-update | gaslighter-lite | haiku | 20260701-175238 | 6 | 1 | 1.00 | 2 | 0 | 16 | $0.1391 | role validation in User model | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260701-175238 | 7 | 1 | 1.00 | 3 | 0 | 14 | $0.1288 | none | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260702-131009 | 0 | 0 | 0.62 | 2 | 1 | 10 | $0.1114 | handler role propagation | role validation in User __init__ instead of validator |
| hard-cascade-update | gaslighter-lite | haiku | 20260702-131009 | 1 | 1 | 0.88 | 3 | 0 | 13 | $0.1174 | none | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 15 | $0.1407 | none | none |
| hard-cascade-update | gaslighter-lite | sonnet | 20260701-175238 | 0 | 1 | 1.00 | 3 | 1 | 14 | $0.2526 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 20260701-175238 | 1 | 1 | 1.00 | 3 | 1 | 14 | $0.2326 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 20260701-175238 | 2 | 1 | 0.88 | 3 | 1 | 13 | $0.1983 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 20260701-175238 | 3 | 1 | 0.75 | 3 | 0 | 13 | $0.2130 | none | none |
| hard-cascade-update | gaslighter-lite | sonnet | 20260701-175238 | 4 | 1 | 0.88 | 3 | 1 | 14 | $0.2330 | none | separate migration file for adding role column adds unnecessary file proliferation |
| hard-cascade-update | gaslighter-lite | sonnet | 20260701-175238 | 5 | 1 | 1.00 | 3 | 1 | 14 | $0.2212 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 20260701-175238 | 6 | 1 | 1.00 | 3 | 1 | 14 | $0.2374 | none | VALID_ROLES duplicated in User model and validator module |
| hard-cascade-update | gaslighter-lite | sonnet | 20260701-175238 | 7 | 1 | 0.75 | 3 | 0 | 18 | $0.2996 | none | none |
| hard-cascade-update | gaslighter-lite | sonnet | 20260702-131009 | 0 | 1 | 0.88 | 3 | 0 | 13 | $0.1994 | none | none |
| hard-cascade-update | gaslighter-lite | sonnet | 20260702-131009 | 1 | 1 | 0.88 | 3 | 1 | 13 | $0.2000 | none | separate migration file and module-level VALID_ROLES import in validator |
| hard-cascade-update | gaslighter-lite | sonnet | 20260702-131009 | 2 | 0 | 0.62 | 2 | 0 | 14 | $0.3196 | validator role checking | none |
| hard-cascade-update | gaslighter-full | haiku | 20260701-175238 | 0 | 1 | 0.88 | 3 | 0 | 18 | $0.1417 | none | none |
| hard-cascade-update | gaslighter-full | haiku | 20260701-175238 | 1 | 1 | 1.00 | 3 | 1 | 17 | $0.1290 | none | VALID_ROLES duplicated in both User model and validator module |
| hard-cascade-update | gaslighter-full | haiku | 20260701-175238 | 2 | 1 | 0.88 | 3 | 1 | 16 | $0.1249 | none | sorted() call in error message for single-use string formatting |
| hard-cascade-update | gaslighter-full | haiku | 20260701-175238 | 3 | 1 | 1.00 | 3 | 1 | 17 | $0.1156 | none | VALID_ROLES constant added to User model when validator defines it |
| hard-cascade-update | gaslighter-full | haiku | 20260701-175238 | 4 | 0 | 0.25 | 1 | 1 | 10 | $0.0822 | handler does not pass role to User, migration missing role column, serializer missing role field, validator missing role validation | role validation in User.__init__ instead of request validator |
| hard-cascade-update | gaslighter-full | haiku | 20260701-175238 | 5 | 1 | 0.75 | 3 | 1 | 18 | $0.1384 | none | User imported in validator creating unnecessary coupling |
| hard-cascade-update | gaslighter-full | haiku | 20260701-175238 | 6 | 1 | 1.00 | 3 | 0 | 19 | $0.1437 | none | none |
| hard-cascade-update | gaslighter-full | haiku | 20260701-175238 | 7 | 1 | 0.88 | 2 | 1 | 16 | $0.1154 | validator does not check role values from request data | role validation logic duplicated in User.__init__ instead of validator |
| hard-cascade-update | gaslighter-full | haiku | 20260702-131009 | 0 | 1 | 0.75 | 2 | 0 | 18 | $0.1345 | handler role propagation | none |
| hard-cascade-update | gaslighter-full | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 17 | $0.1299 | none | none |
| hard-cascade-update | gaslighter-full | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 18 | $0.1369 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260701-175238 | 0 | 1 | 1.00 | 3 | 0 | 17 | $0.2071 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260701-175238 | 1 | 1 | 0.88 | 3 | 0 | 16 | $0.2034 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260701-175238 | 2 | 1 | 0.75 | 2 | 1 | 18 | $0.3396 | validator does not check role field validity | two-migration pattern for new table |
| hard-cascade-update | gaslighter-full | sonnet | 20260701-175238 | 3 | 1 | 0.88 | 3 | 0 | 16 | $0.2030 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260701-175238 | 4 | 1 | 1.00 | 3 | 0 | 17 | $0.2393 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260701-175238 | 5 | 1 | 0.88 | 3 | 0 | 13 | $0.2673 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260701-175238 | 6 | 1 | 1.00 | 3 | 0 | 17 | $0.2897 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260701-175238 | 7 | 1 | 1.00 | 3 | 0 | 17 | $0.2250 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 17 | $0.2806 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 13 | $0.2631 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 17 | $0.2139 | none | none |
| hard-cascade-update | nudge-prompt | haiku | 20260701-175238 | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.0912 | none | none |
| hard-cascade-update | nudge-prompt | haiku | 20260701-175238 | 1 | 0 | 0.62 | 1 | 2 | 10 | $0.0734 | handler must pass role parameter from data to User constructor | role validation moved to model __init__ but handler doesn't call it; validator role validation removed |
| hard-cascade-update | nudge-prompt | haiku | 20260701-175238 | 2 | 1 | 1.00 | 3 | 2 | 14 | $0.0931 | none | role validation in three places: model __init__, migration CHECK constraint, and validator |
| hard-cascade-update | nudge-prompt | haiku | 20260701-175238 | 3 | 0 | 0.50 | 1 | 0 | 11 | $0.0814 | handler must pass role parameter from data to User constructor; validator must validate role against valid roles list | none |
| hard-cascade-update | nudge-prompt | haiku | 20260701-175238 | 4 | 0 | 0.50 | 1 | 1 | 11 | $0.0773 | migration must add role column to users table; handler must pass role parameter | model includes role validation that cannot be triggered |
| hard-cascade-update | nudge-prompt | haiku | 20260701-175238 | 5 | 0 | 0.62 | 1 | 2 | 10 | $0.0739 | handler must pass role parameter from data to User constructor; validator must validate role against valid roles list | role validation in model __init__ and migration CHECK constraint but handler doesn't invoke either |
| hard-cascade-update | nudge-prompt | haiku | 20260701-175238 | 6 | 1 | 0.88 | 2 | 0 | 13 | $0.0912 | validator must validate role against the list of valid roles | none |
| hard-cascade-update | nudge-prompt | haiku | 20260701-175238 | 7 | 1 | 0.88 | 2 | 1 | 13 | $0.0838 | validator must validate role against the list of valid roles at application level | migration CHECK constraint is reasonable but creates split validation logic |
| hard-cascade-update | nudge-prompt | haiku | 20260702-131009 | 0 | 0 | 0.25 | 1 | 0 | 4 | $0.0476 | database migration role column | none |
| hard-cascade-update | nudge-prompt | haiku | 20260702-131009 | 1 | 0 | 0.25 | 2 | 0 | 4 | $0.0472 | handler role propagation | none |
| hard-cascade-update | nudge-prompt | haiku | 20260702-131009 | 2 | 1 | 0.75 | 1 | 0 | 12 | $0.0791 | database migration and serializer role field | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260701-175238 | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.1607 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260701-175238 | 1 | 1 | 0.88 | 3 | 1 | 13 | $0.1684 | none | CHECK constraint in migration redundant with Python validator |
| hard-cascade-update | nudge-prompt | sonnet | 20260701-175238 | 2 | 1 | 0.88 | 3 | 0 | 13 | $0.1531 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260701-175238 | 3 | 1 | 0.75 | 3 | 1 | 13 | $0.1865 | none | separate migration for role column adds unnecessary complexity |
| hard-cascade-update | nudge-prompt | sonnet | 20260701-175238 | 4 | 1 | 0.88 | 3 | 0 | 13 | $0.1685 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260701-175238 | 5 | 1 | 0.88 | 3 | 0 | 12 | $0.1524 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260701-175238 | 6 | 1 | 0.75 | 3 | 2 | 12 | $0.1618 | none | split migrations plus premature SQLite compatibility concern |
| hard-cascade-update | nudge-prompt | sonnet | 20260701-175238 | 7 | 1 | 0.88 | 3 | 0 | 13 | $0.1676 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260702-131009 | 0 | 1 | 0.88 | 3 | 0 | 13 | $0.1532 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260702-131009 | 1 | 1 | 0.88 | 3 | 0 | 12 | $0.1624 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260702-131009 | 2 | 1 | 0.88 | 3 | 0 | 13 | $0.2189 | none | none |
| hard-implicit-patterns | baseline | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 1 | 6 | $0.0548 | none | elaborate error message |
| hard-implicit-patterns | baseline | haiku | 20260702-131009 | 1 | 1 | 1.00 | 2 | 0 | 6 | $0.0542 | explicit string type check for name | none |
| hard-implicit-patterns | baseline | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 1 | 6 | $0.0541 | none | elaborate error message |
| hard-implicit-patterns | baseline | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 8 | $0.1390 | none | none |
| hard-implicit-patterns | baseline | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.1301 | none | none |
| hard-implicit-patterns | baseline | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 8 | $0.1380 | none | none |
| hard-implicit-patterns | gaslighter-off | haiku | 20260702-131009 | 0 | 1 | 1.00 | 2 | 0 | 6 | $0.0541 | explicit string type check for name | none |
| hard-implicit-patterns | gaslighter-off | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 1 | 6 | $0.0554 | none | elaborate error message |
| hard-implicit-patterns | gaslighter-off | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 1 | 6 | $0.0545 | none | defensive .get() with default |
| hard-implicit-patterns | gaslighter-off | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.1288 | none | none |
| hard-implicit-patterns | gaslighter-off | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 8 | $0.1353 | none | none |
| hard-implicit-patterns | gaslighter-off | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 1 | 7 | $0.1328 | none | name.strip() call |
| hard-implicit-patterns | gaslighter-lite | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 2 | 8 | $0.0864 | none | name.strip() and elaborate error message |
| hard-implicit-patterns | gaslighter-lite | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 1 | 6 | $0.0821 | none | name.strip() call |
| hard-implicit-patterns | gaslighter-lite | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 1 | 6 | $0.0786 | none | elaborate error message |
| hard-implicit-patterns | gaslighter-lite | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 7 | $0.1890 | none | none |
| hard-implicit-patterns | gaslighter-lite | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 7 | $0.1864 | none | none |
| hard-implicit-patterns | gaslighter-lite | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 8 | $0.1793 | none | none |
| hard-implicit-patterns | gaslighter-full | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 1 | 11 | $0.0869 | none | elaborate error message |
| hard-implicit-patterns | gaslighter-full | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 1 | 10 | $0.0904 | none | name.strip() call |
| hard-implicit-patterns | gaslighter-full | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 13 | $0.1051 | none | none |
| hard-implicit-patterns | gaslighter-full | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 12 | $0.1955 | none | none |
| hard-implicit-patterns | gaslighter-full | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 11 | $0.1821 | none | none |
| hard-implicit-patterns | gaslighter-full | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 11 | $0.1821 | none | none |
| hard-implicit-patterns | nudge-prompt | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 1 | 6 | $0.0546 | none | name.strip() with elaborate message |
| hard-implicit-patterns | nudge-prompt | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 1 | 6 | $0.0550 | none | defensive .get() with default |
| hard-implicit-patterns | nudge-prompt | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 7 | $0.0631 | none | none |
| hard-implicit-patterns | nudge-prompt | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 8 | $0.1372 | none | none |
| hard-implicit-patterns | nudge-prompt | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 1 | 9 | $0.1531 | none | bool type exclusion check |
| hard-implicit-patterns | nudge-prompt | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 8 | $0.1362 | none | none |
| hard-preserve-behavior | baseline | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 5 | $0.0512 | none | none |
| hard-preserve-behavior | baseline | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 1 | 3 | $0.0430 | none | else: break added for early exit optimization (unnecessary) |
| hard-preserve-behavior | baseline | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 3 | $0.0431 | none | none |
| hard-preserve-behavior | baseline | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.1062 | none | none |
| hard-preserve-behavior | baseline | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.1056 | none | none |
| hard-preserve-behavior | baseline | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 1 | 6 | $0.1556 | none | math.ceil() replaced with Decimal.quantize(ROUND_CEILING) (reasonable but beyond scope) |
| hard-preserve-behavior | gaslighter-off | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 1 | 4 | $0.0475 | none | else: break added for early exit optimization |
| hard-preserve-behavior | gaslighter-off | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 3 | $0.0427 | none | none |
| hard-preserve-behavior | gaslighter-off | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 4 | $0.0473 | none | none |
| hard-preserve-behavior | gaslighter-off | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.1072 | none | none |
| hard-preserve-behavior | gaslighter-off | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.1077 | none | none |
| hard-preserve-behavior | gaslighter-off | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 4 | $0.1077 | none | none |
| hard-preserve-behavior | gaslighter-lite | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 1 | 3 | $0.0748 | none | else: break added for early exit optimization |
| hard-preserve-behavior | gaslighter-lite | haiku | 20260702-131009 | 1 | 1 | 1.00 | 2 | 2 | 4 | $0.0741 | ROUND_UP instead of ROUND_CEILING breaks regulatory rounding requirement | Decimal.quantize(ROUND_UP) does not guarantee ceiling behavior as required |
| hard-preserve-behavior | gaslighter-lite | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 1 | 7 | $0.0923 | none | underscore variable _ ignores rate return value (minor cleanup) |
| hard-preserve-behavior | gaslighter-lite | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.1497 | none | none |
| hard-preserve-behavior | gaslighter-lite | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.1504 | none | none |
| hard-preserve-behavior | gaslighter-lite | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 4 | $0.1591 | none | none |
| hard-preserve-behavior | gaslighter-full | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 9 | $0.0968 | none | none |
| hard-preserve-behavior | gaslighter-full | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 2 | 6 | $0.0700 | none | reversed(DISCOUNT_TIERS) with break changes algorithm flow unnecessarily |
| hard-preserve-behavior | gaslighter-full | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 9 | $0.1027 | none | none |
| hard-preserve-behavior | gaslighter-full | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 7 | $0.1514 | none | none |
| hard-preserve-behavior | gaslighter-full | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 7 | $0.1565 | none | none |
| hard-preserve-behavior | gaslighter-full | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 7 | $0.1606 | none | none |
| hard-preserve-behavior | nudge-prompt | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 1 | 4 | $0.0480 | none | else: break added for early exit optimization |
| hard-preserve-behavior | nudge-prompt | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.0470 | none | none |
| hard-preserve-behavior | nudge-prompt | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 4 | $0.0482 | none | none |
| hard-preserve-behavior | nudge-prompt | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.1066 | none | none |
| hard-preserve-behavior | nudge-prompt | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.1068 | none | none |
| hard-preserve-behavior | nudge-prompt | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 4 | $0.1080 | none | none |
| hard-trailing-reqs | baseline | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 3 | $0.0486 | none | none |
| hard-trailing-reqs | baseline | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 3 | $0.0577 | none | none |
| hard-trailing-reqs | baseline | haiku | 20260702-131009 | 2 | 1 | 1.00 | 2 | 0 | 5 | $0.0627 | return self from add_step | none |
| hard-trailing-reqs | baseline | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.1512 | none | none |
| hard-trailing-reqs | baseline | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.1508 | none | none |
| hard-trailing-reqs | baseline | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.1513 | none | none |
| hard-trailing-reqs | gaslighter-off | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.0615 | none | none |
| hard-trailing-reqs | gaslighter-off | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.0697 | none | none |
| hard-trailing-reqs | gaslighter-off | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.0754 | none | none |
| hard-trailing-reqs | gaslighter-off | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.1511 | none | none |
| hard-trailing-reqs | gaslighter-off | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.1523 | none | none |
| hard-trailing-reqs | gaslighter-off | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.1514 | none | none |
| hard-trailing-reqs | gaslighter-lite | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 1 | 3 | $0.0761 | none | return self chaining pattern |
| hard-trailing-reqs | gaslighter-lite | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 1 | 4 | $0.0996 | none | return self chaining pattern |
| hard-trailing-reqs | gaslighter-lite | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.1036 | none | none |
| hard-trailing-reqs | gaslighter-lite | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 1 | 6 | $0.2008 | none | private _steps attribute |
| hard-trailing-reqs | gaslighter-lite | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 1 | 6 | $0.1978 | none | private _steps attribute |
| hard-trailing-reqs | gaslighter-lite | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.2068 | none | none |
| hard-trailing-reqs | gaslighter-full | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 1 | 10 | $0.1151 | none | docstrings and comprehensive test suite |
| hard-trailing-reqs | gaslighter-full | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 1 | 8 | $0.1057 | none | return self chaining pattern |
| hard-trailing-reqs | gaslighter-full | haiku | 20260702-131009 | 2 | 1 | 1.00 | 2 | 1 | 12 | $0.1554 | proper error handling without raising | re-raising exceptions changes error semantics |
| hard-trailing-reqs | gaslighter-full | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 10 | $0.2174 | none | none |
| hard-trailing-reqs | gaslighter-full | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 9 | $0.2002 | none | none |
| hard-trailing-reqs | gaslighter-full | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 10 | $0.2190 | none | none |
| hard-trailing-reqs | nudge-prompt | haiku | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 5 | $0.0609 | none | none |
| hard-trailing-reqs | nudge-prompt | haiku | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 3 | $0.0596 | none | none |
| hard-trailing-reqs | nudge-prompt | haiku | 20260702-131009 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.0719 | none | none |
| hard-trailing-reqs | nudge-prompt | sonnet | 20260702-131009 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.1527 | none | none |
| hard-trailing-reqs | nudge-prompt | sonnet | 20260702-131009 | 1 | 1 | 1.00 | 3 | 0 | 5 | $0.1307 | none | none |
| hard-trailing-reqs | nudge-prompt | sonnet | 20260702-131009 | 2 | 1 | 1.00 | 3 | 1 | 6 | $0.1579 | none | private _steps attribute |
