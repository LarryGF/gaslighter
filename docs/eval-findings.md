# Gaslighter Eval Findings

Merged across three runs:
- `evals/runs/20260701-175238` — 2 tasks × 5 arms × 2 models × 8 runs = 160 cells
- `evals/runs/20260702-131009` — 5 tasks × 5 arms × 2 models × 3 runs = 150 cells
- `evals/runs/20260702-160751` — 5 tasks × 5 arms × 2 models × 3 runs = 150 cells

Combined: 460 cells. `hard-buried-constraints` and `hard-cascade-update` are covered by all three runs (n=28/arm each, pooled); `hard-implicit-patterns`, `hard-preserve-behavior`, and `hard-trailing-reqs` come from the second and third runs only (n=12/arm each).

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

**Note on hook version:** `evals/runs/20260702-131009` finished before the Stop-hook's anti-loop guard was fixed to stop nudging as soon as the model declares 100% confidence, instead of always counting to a fixed cap of 3. `evals/runs/20260702-160751` was launched before that fix, but the fix (adding `readStable()` to `hooks/gaslighter-nudge.js` to close a transcript-read race that was defeating the confidence escape hatch) landed on disk while this third run's 150 cells were still executing in the background — each cell spawns the hook script fresh, so early cells in this run may have used the pre-fix hook while later cells used the post-fix version. This run's `gaslighter-full`/`gaslighter-lite` turn and cost figures should be read as a mix of both hook versions, not a clean post-fix sample. Directionally, the pooled `gaslighter-full` turns/cost (12.35 / $0.1740) did drop versus the pre-fix-only pooled figure (13.2 / $0.1839), consistent with the fix reducing redundant nudges, but a dedicated clean post-fix run is needed to isolate the effect.

**Note on sample size:** run counts per cell vary across runs (8 for the first, 3 each for the second and third), so per-task n varies (28 for the two tasks in all three runs, 12 for the three tasks only in the second and third). Treat single-cell and per-task numbers as directional, especially for the n=12 tasks.

## Headline result (merged, n=92 per arm — all 5 tasks, both models, all three runs)

| Arm | n | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|---|
| baseline | 92 | 0.902 | 0.902 | 2.50 | 0.34 | 8.4 | $0.1141 |
| gaslighter-off | 92 | 0.946 | 0.925 | 2.51 | 0.24 | 8.4 | $0.1155 |
| gaslighter-lite | 92 | 0.967 | 0.942 | 2.54 | 0.35 | 9.1 | $0.1621 |
| gaslighter-full | 92 | 0.978 | 0.952 | 2.64 | 0.33 | 12.3 | $0.1740 |
| nudge-prompt | 92 | 0.924 | 0.913 | 2.48 | 0.26 | 8.4 | $0.1075 |

## Key findings

1. **`gaslighter-full` still leads on every automated and judge quality metric after the third run.** Highest correct (0.978), highest auto-complete (0.952), highest judge completeness (2.64). Its overcorrection (0.33) is now roughly in line with `gaslighter-lite` (0.35) rather than clearly the lowest of the two active hook modes, a shift from the two-run merge — see the hook-version note above and the judge-variance caveat in Methodology.
2. **The turn/cost premium for `gaslighter-full` softened in the pooled numbers (12.3 turns / $0.1740 vs baseline's 8.4 turns / $0.1141), down from the two-run merge's 13.2 turns / $0.1839.** This is directionally consistent with the anti-loop race-condition fix landing mid-run (see hook-version note), but because that run mixed pre- and post-fix cells, this number should not be read as a clean measurement of the fix's effect.
3. **`gaslighter-off` (a no-op control) continues to beat baseline on correctness (0.946 vs 0.902) while running at the same turn count.** With overcorrection now closer between the two (0.24 vs 0.34) than in the two-run merge (0.31 vs 0.48), the earlier overcorrection gap looks more like judge-to-judge variance than a stable effect of the plugin's mere presence — treat baseline-vs-control gaps as a noise floor when reading the other comparisons.
4. **The task-dependent story holds: `hard-cascade-update` still carries almost all of the between-arm spread.** Baseline sits at 0.714 correct / 0.787 complete on this task, while `gaslighter-full` holds 0.929 / 0.894 — still the largest gap of any task. Every other task sits at or near correct=1.000 for every arm regardless of nudging.
5. **`nudge-prompt` (static system-prompt text, no hook) still underperforms both active gaslighter modes on correctness (0.924 vs 0.967/0.978)** at the lowest turn/cost premium (8.4 turns / $0.1075) of the five arms — cheap, but not as effective as the interactive Stop-hook nudge.

## Per-task summary (merged; n=28/arm for tasks in all three runs, n=12/arm for tasks only in the second and third runs)

| Task | Arm | n | Correct | Auto Complete | Judge Completeness | Judge Overcorrection | Turns | Cost/run |
|---|---|---|---|---|---|---|---|---|
| hard-buried-constraints | baseline | 28 | 1.000 | 0.927 | 2.29 | 0.50 | 8.8 | $0.1288 |
| hard-buried-constraints | gaslighter-off | 28 | 1.000 | 0.927 | 2.11 | 0.46 | 8.6 | $0.1216 |
| hard-buried-constraints | gaslighter-lite | 28 | 1.000 | 0.923 | 1.93 | 0.21 | 9.4 | $0.1874 |
| hard-buried-constraints | gaslighter-full | 28 | 1.000 | 0.949 | 2.18 | 0.32 | 12.8 | $0.2067 |
| hard-buried-constraints | nudge-prompt | 28 | 1.000 | 0.927 | 1.93 | 0.18 | 8.6 | $0.1106 |
| hard-cascade-update | baseline | 28 | 0.714 | 0.787 | 2.25 | 0.43 | 11.9 | $0.1250 |
| hard-cascade-update | gaslighter-off | 28 | 0.821 | 0.828 | 2.32 | 0.07 | 12.3 | $0.1379 |
| hard-cascade-update | gaslighter-lite | 28 | 0.893 | 0.885 | 2.64 | 0.32 | 13.6 | $0.1785 |
| hard-cascade-update | gaslighter-full | 28 | 0.929 | 0.894 | 2.68 | 0.25 | 16.1 | $0.1811 |
| hard-cascade-update | nudge-prompt | 28 | 0.750 | 0.788 | 2.39 | 0.43 | 12.0 | $0.1216 |
| hard-implicit-patterns | baseline | 12 | 1.000 | 1.000 | 2.92 | 0.17 | 6.8 | $0.0958 |
| hard-implicit-patterns | gaslighter-off | 12 | 1.000 | 1.000 | 2.92 | 0.25 | 6.6 | $0.0939 |
| hard-implicit-patterns | gaslighter-lite | 12 | 1.000 | 1.000 | 3.00 | 0.33 | 6.8 | $0.1310 |
| hard-implicit-patterns | gaslighter-full | 12 | 1.000 | 1.000 | 3.00 | 0.17 | 10.6 | $0.1447 |
| hard-implicit-patterns | nudge-prompt | 12 | 1.000 | 1.000 | 3.00 | 0.25 | 7.1 | $0.0988 |
| hard-preserve-behavior | baseline | 12 | 1.000 | 1.000 | 3.00 | 0.25 | 4.2 | $0.0806 |
| hard-preserve-behavior | gaslighter-off | 12 | 1.000 | 1.000 | 3.00 | 0.25 | 3.8 | $0.0765 |
| hard-preserve-behavior | gaslighter-lite | 12 | 1.000 | 1.000 | 2.92 | 0.58 | 4.4 | $0.1157 |
| hard-preserve-behavior | gaslighter-full | 12 | 1.000 | 1.000 | 3.00 | 0.67 | 7.3 | $0.1244 |
| hard-preserve-behavior | nudge-prompt | 12 | 1.000 | 1.000 | 3.00 | 0.08 | 3.9 | $0.0767 |
| hard-trailing-reqs | baseline | 12 | 0.917 | 0.917 | 2.67 | 0.00 | 5.2 | $0.1063 |
| hard-trailing-reqs | gaslighter-off | 12 | 1.000 | 1.000 | 3.00 | 0.08 | 5.3 | $0.1093 |
| hard-trailing-reqs | gaslighter-lite | 12 | 1.000 | 1.000 | 2.92 | 0.50 | 5.0 | $0.1421 |
| hard-trailing-reqs | gaslighter-full | 12 | 1.000 | 1.000 | 2.92 | 0.33 | 9.3 | $0.1597 |
| hard-trailing-reqs | nudge-prompt | 12 | 1.000 | 1.000 | 2.92 | 0.25 | 5.2 | $0.1071 |

`hard-cascade-update` remains the clear outlier — every other task sits at or near correct=1.000 for every arm, so it carries almost all of the between-arm signal in the merged dataset.

## Methodology notes

- Automated scores (`correct`, `complete_rate`) are deterministic, code-based checks — the same task always scores the same way for the same code.
- Judge scores (`completeness`, `overcorrection`) come from one independent LLM read per cell, no cross-judge voting or redundancy. Treat exact decimal means as directional signal, not precise measurement — the third run's pooled overcorrection numbers shifted enough versus the two-run merge (e.g. baseline 0.48 → 0.34) that some of the earlier "gaslighter-full ties for lowest overcorrection" finding looks more like judge variance than a stable effect once more data is pooled.
- Run counts per cell vary across runs (8 for the first run, 3 each for the second and third) — the appendix below tags each row with its source run stamp so this is traceable per row.
- This eval suite's judging pipeline had two bugs fixed after the second run was judged: the judge skill referenced a nonexistent `StructuredOutput` tool, and intermediate JSON files were written unindented (single massive line), causing the Read tool to truncate them and some judge-agents to fabricate or duplicate scores to hit the expected count. Both are fixed in `skills/judge/SKILL.md` and `agents/judge-agent.md`.
- During the third run's judging, one task's judge-agent (`hard-cascade-update`) initially returned only 29 of 30 expected scores. Per the skill's error handling, it was relaunched with an explicit count-check instruction rather than accepting the partial result; the retry returned the full 30.

## Full per-run table (all 460 cells)

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
| hard-buried-constraints | baseline | haiku | 20260702-160751 | 0 | 1 | 0.88 | 2 | 0 | 9 | $0.0992 | POST method not explicitly set | none |
| hard-buried-constraints | baseline | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 9 | $0.0997 | none | none |
| hard-buried-constraints | baseline | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 9 | $0.0702 | none | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 10 | $0.0776 | none | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 9 | $0.0740 | none | none |
| hard-buried-constraints | gaslighter-off | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 10 | $0.0790 | none | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260702-160751 | 0 | 1 | 0.88 | 2 | 0 | 10 | $0.1351 | POST method not explicitly set | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 11 | $0.1414 | none | none |
| hard-buried-constraints | gaslighter-lite | haiku | 20260702-160751 | 2 | 1 | 0.88 | 2 | 0 | 12 | $0.1629 | POST method not explicitly set | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.1649 | none | none |
| hard-buried-constraints | gaslighter-full | haiku | 20260702-160751 | 1 | 1 | 1.00 | 2 | 2 | 14 | $0.1554 | signature should match other handlers | dict/string payload polymorphism |
| hard-buried-constraints | gaslighter-full | haiku | 20260702-160751 | 2 | 1 | 1.00 | 2 | 2 | 12 | $0.1203 | signature should match other handlers | optional payload parameter |
| hard-buried-constraints | nudge-prompt | haiku | 20260702-160751 | 0 | 1 | 0.88 | 1 | 0 | 9 | $0.0731 | JSON wrapping of message body | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 9 | $0.0733 | none | none |
| hard-buried-constraints | nudge-prompt | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 9 | $0.0733 | none | none |
| hard-buried-constraints | baseline | sonnet | 20260702-160751 | 0 | 1 | 0.88 | 2 | 0 | 8 | $0.2244 | POST method not explicitly set | none |
| hard-buried-constraints | baseline | sonnet | 20260702-160751 | 1 | 1 | 0.88 | 2 | 0 | 8 | $0.1462 | POST method not explicitly set | none |
| hard-buried-constraints | baseline | sonnet | 20260702-160751 | 2 | 1 | 0.88 | 2 | 0 | 8 | $0.1463 | POST method not explicitly set | none |
| hard-buried-constraints | gaslighter-off | sonnet | 20260702-160751 | 0 | 1 | 0.88 | 2 | 0 | 8 | $0.2419 | POST method not explicitly set | none |
| hard-buried-constraints | gaslighter-off | sonnet | 20260702-160751 | 1 | 1 | 0.88 | 2 | 0 | 8 | $0.2128 | POST method not explicitly set | none |
| hard-buried-constraints | gaslighter-off | sonnet | 20260702-160751 | 2 | 1 | 0.88 | 2 | 0 | 8 | $0.1475 | POST method not explicitly set | none |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260702-160751 | 0 | 1 | 0.88 | 2 | 1 | 9 | $0.2972 | POST method not explicitly set | ValueError in exception handling |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260702-160751 | 1 | 1 | 0.88 | 2 | 1 | 8 | $0.2197 | POST method not explicitly set | http_status in response |
| hard-buried-constraints | gaslighter-lite | sonnet | 20260702-160751 | 2 | 1 | 0.88 | 2 | 0 | 8 | $0.2274 | POST method not explicitly set | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260702-160751 | 0 | 1 | 0.88 | 2 | 0 | 10 | $0.2070 | POST method not explicitly set | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260702-160751 | 1 | 1 | 0.88 | 2 | 0 | 10 | $0.2016 | POST method not explicitly set | none |
| hard-buried-constraints | gaslighter-full | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 12 | $0.2542 | none | none |
| hard-buried-constraints | nudge-prompt | sonnet | 20260702-160751 | 0 | 1 | 0.88 | 2 | 0 | 8 | $0.1470 | POST method not explicitly set | none |
| hard-buried-constraints | nudge-prompt | sonnet | 20260702-160751 | 1 | 1 | 0.88 | 1 | 0 | 8 | $0.1467 | JSON wrapping of message | none |
| hard-buried-constraints | nudge-prompt | sonnet | 20260702-160751 | 2 | 1 | 0.88 | 2 | 0 | 8 | $0.1365 | POST method not explicitly set | none |
| hard-implicit-patterns | baseline | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.0581 | none | none |
| hard-implicit-patterns | baseline | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.0544 | none | none |
| hard-implicit-patterns | baseline | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.0546 | none | none |
| hard-implicit-patterns | gaslighter-off | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.0549 | none | none |
| hard-implicit-patterns | gaslighter-off | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.0546 | none | none |
| hard-implicit-patterns | gaslighter-off | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.0548 | none | none |
| hard-implicit-patterns | gaslighter-lite | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 7 | $0.0878 | none | none |
| hard-implicit-patterns | gaslighter-lite | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.0781 | none | none |
| hard-implicit-patterns | gaslighter-lite | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.0784 | none | none |
| hard-implicit-patterns | gaslighter-full | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 10 | $0.0876 | none | none |
| hard-implicit-patterns | gaslighter-full | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 8 | $0.0736 | none | none |
| hard-implicit-patterns | gaslighter-full | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 11 | $0.1012 | none | none |
| hard-implicit-patterns | nudge-prompt | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.0549 | none | none |
| hard-implicit-patterns | nudge-prompt | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.0545 | none | none |
| hard-implicit-patterns | nudge-prompt | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.0585 | none | none |
| hard-implicit-patterns | baseline | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 8 | $0.1351 | none | none |
| hard-implicit-patterns | baseline | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 8 | $0.1381 | none | none |
| hard-implicit-patterns | baseline | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 8 | $0.1394 | none | none |
| hard-implicit-patterns | gaslighter-off | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.1289 | none | none |
| hard-implicit-patterns | gaslighter-off | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 8 | $0.1359 | none | none |
| hard-implicit-patterns | gaslighter-off | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 8 | $0.1370 | none | none |
| hard-implicit-patterns | gaslighter-lite | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 7 | $0.1874 | none | none |
| hard-implicit-patterns | gaslighter-lite | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.1633 | none | none |
| hard-implicit-patterns | gaslighter-lite | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 7 | $0.1755 | none | none |
| hard-implicit-patterns | gaslighter-full | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 10 | $0.2923 | none | none |
| hard-implicit-patterns | gaslighter-full | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 10 | $0.1702 | none | none |
| hard-implicit-patterns | gaslighter-full | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 10 | $0.1691 | none | none |
| hard-implicit-patterns | nudge-prompt | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 7 | $0.1455 | none | none |
| hard-implicit-patterns | nudge-prompt | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 8 | $0.1364 | none | none |
| hard-implicit-patterns | nudge-prompt | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 8 | $0.1363 | none | none |
| hard-cascade-update | baseline | haiku | 20260702-160751 | 0 | 1 | 0.88 | 3 | 0 | 13 | $0.0802 | none | none |
| hard-cascade-update | baseline | haiku | 20260702-160751 | 1 | 0 | 0.62 | 1 | 0 | 10 | $0.0731 | role parameter missing from User() constructor call in handler | none |
| hard-cascade-update | baseline | haiku | 20260702-160751 | 2 | 1 | 0.88 | 2 | 0 | 13 | $0.0845 | role validation logic in model constructor | none |
| hard-cascade-update | gaslighter-off | haiku | 20260702-160751 | 0 | 0 | 0.25 | 0 | 0 | 4 | $0.0470 | role field missing from serializer output | none |
| hard-cascade-update | gaslighter-off | haiku | 20260702-160751 | 1 | 1 | 0.88 | 3 | 0 | 13 | $0.0833 | none | none |
| hard-cascade-update | gaslighter-off | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 14 | $0.0868 | none | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 15 | $0.1423 | none | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260702-160751 | 1 | 1 | 0.88 | 3 | 0 | 13 | $0.1108 | none | none |
| hard-cascade-update | gaslighter-lite | haiku | 20260702-160751 | 2 | 1 | 0.88 | 3 | 0 | 14 | $0.1138 | none | separate migration file for role addition |
| hard-cascade-update | gaslighter-full | haiku | 20260702-160751 | 0 | 0 | 0.62 | 1 | 0 | 13 | $0.1045 | role parameter missing from User() constructor call in handler | none |
| hard-cascade-update | gaslighter-full | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 16 | $0.1258 | none | CHECK constraint in migration is optional but good practice |
| hard-cascade-update | gaslighter-full | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 16 | $0.1083 | none | none |
| hard-cascade-update | nudge-prompt | haiku | 20260702-160751 | 0 | 1 | 0.88 | 3 | 0 | 14 | $0.0864 | none | cross-model import in validator |
| hard-cascade-update | nudge-prompt | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 15 | $0.0711 | none | CHECK constraint in migration |
| hard-cascade-update | nudge-prompt | haiku | 20260702-160751 | 2 | 0 | 0.62 | 1 | 0 | 10 | $0.0780 | role parameter missing from User() constructor call in handler | none |
| hard-cascade-update | baseline | sonnet | 20260702-160751 | 0 | 1 | 0.88 | 3 | 0 | 14 | $0.1546 | none | none |
| hard-cascade-update | baseline | sonnet | 20260702-160751 | 1 | 1 | 0.88 | 3 | 0 | 13 | $0.1527 | none | none |
| hard-cascade-update | baseline | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 14 | $0.1722 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260702-160751 | 0 | 1 | 0.88 | 3 | 0 | 13 | $0.1416 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 14 | $0.2275 | none | none |
| hard-cascade-update | gaslighter-off | sonnet | 20260702-160751 | 2 | 1 | 0.75 | 2 | 0 | 12 | $0.2098 | handler missing role parameter in User() constructor call | none |
| hard-cascade-update | gaslighter-lite | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.2148 | none | none |
| hard-cascade-update | gaslighter-lite | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 14 | $0.2386 | none | none |
| hard-cascade-update | gaslighter-lite | sonnet | 20260702-160751 | 2 | 1 | 0.88 | 3 | 0 | 14 | $0.2586 | none | separate migration with CHECK constraint |
| hard-cascade-update | gaslighter-full | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 16 | $0.2242 | none | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260702-160751 | 1 | 1 | 0.88 | 2 | 0 | 15 | $0.1914 | model constructor lacks role validation | none |
| hard-cascade-update | gaslighter-full | sonnet | 20260702-160751 | 2 | 1 | 0.75 | 2 | 0 | 14 | $0.1919 | validator lacks role validation | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 14 | $0.1618 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260702-160751 | 1 | 1 | 0.88 | 3 | 0 | 12 | $0.1612 | none | none |
| hard-cascade-update | nudge-prompt | sonnet | 20260702-160751 | 2 | 1 | 0.88 | 3 | 0 | 13 | $0.1531 | none | none |
| hard-preserve-behavior | baseline | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 5 | $0.0523 | none | none |
| hard-preserve-behavior | baseline | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.0465 | none | none |
| hard-preserve-behavior | baseline | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 1 | 4 | $0.0473 | none | else: break statement |
| hard-preserve-behavior | gaslighter-off | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.0475 | none | none |
| hard-preserve-behavior | gaslighter-off | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 3 | $0.0423 | none | none |
| hard-preserve-behavior | gaslighter-off | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 2 | 3 | $0.0462 | none | removed all regulatory comments and docstring detail |
| hard-preserve-behavior | gaslighter-lite | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 3 | $0.0661 | none | none |
| hard-preserve-behavior | gaslighter-lite | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 1 | 6 | $0.0922 | none | variable unpacking change (_ instead of rate) |
| hard-preserve-behavior | gaslighter-lite | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 1 | 5 | $0.0780 | none | reversed() with break optimization |
| hard-preserve-behavior | gaslighter-full | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 1 | 7 | $0.0712 | none | reversed() with break optimization |
| hard-preserve-behavior | gaslighter-full | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 1 | 7 | $0.0841 | none | reversed() with break optimization and comment changes |
| hard-preserve-behavior | gaslighter-full | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 1 | 6 | $0.0795 | none | reversed() with break optimization |
| hard-preserve-behavior | nudge-prompt | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.0474 | none | none |
| hard-preserve-behavior | nudge-prompt | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.0476 | none | none |
| hard-preserve-behavior | nudge-prompt | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 4 | $0.0487 | none | none |
| hard-preserve-behavior | baseline | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.1056 | none | none |
| hard-preserve-behavior | baseline | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.1057 | none | none |
| hard-preserve-behavior | baseline | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 4 | $0.1056 | none | none |
| hard-preserve-behavior | gaslighter-off | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.1066 | none | none |
| hard-preserve-behavior | gaslighter-off | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.1075 | none | none |
| hard-preserve-behavior | gaslighter-off | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 4 | $0.1080 | none | none |
| hard-preserve-behavior | gaslighter-lite | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.1461 | none | none |
| hard-preserve-behavior | gaslighter-lite | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.1416 | none | none |
| hard-preserve-behavior | gaslighter-lite | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 1 | 5 | $0.1645 | none | variable unpacking change (_ instead of rate) |
| hard-preserve-behavior | gaslighter-full | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 2 | 10 | $0.2168 | none | added test code block |
| hard-preserve-behavior | gaslighter-full | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 1 | 7 | $0.1651 | none | variable unpacking change (_ instead of rate) |
| hard-preserve-behavior | gaslighter-full | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.1387 | none | none |
| hard-preserve-behavior | nudge-prompt | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 4 | $0.1083 | none | none |
| hard-preserve-behavior | nudge-prompt | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.1078 | none | none |
| hard-preserve-behavior | nudge-prompt | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 3 | $0.0960 | none | none |
| hard-trailing-reqs | baseline | haiku | 20260702-160751 | 0 | 0 | 0.00 | 0 | 0 | 2 | $0.0475 | entire implementation | none |
| hard-trailing-reqs | baseline | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 4 | $0.0567 | none | none |
| hard-trailing-reqs | baseline | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 9 | $0.0970 | none | none |
| hard-trailing-reqs | gaslighter-off | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 3 | $0.0513 | none | none |
| hard-trailing-reqs | gaslighter-off | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.0785 | none | none |
| hard-trailing-reqs | gaslighter-off | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 5 | $0.0647 | none | none |
| hard-trailing-reqs | gaslighter-lite | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 1 | 4 | $0.0927 | none | Unicode arrow in describe() is stylistic flourish |
| hard-trailing-reqs | gaslighter-lite | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 1 | 4 | $0.0817 | none | dict-based steps instead of list, loses order preservation |
| hard-trailing-reqs | gaslighter-lite | haiku | 20260702-160751 | 2 | 1 | 1.00 | 2 | 0 | 3 | $0.0861 | error handling re-raises exceptions instead of catching and storing them | none |
| hard-trailing-reqs | gaslighter-full | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 8 | $0.0919 | none | none |
| hard-trailing-reqs | gaslighter-full | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 12 | $0.1309 | none | none |
| hard-trailing-reqs | gaslighter-full | haiku | 20260702-160751 | 2 | 1 | 1.00 | 3 | 1 | 8 | $0.0909 | none | dict-based steps instead of list breaks order preservation |
| hard-trailing-reqs | nudge-prompt | haiku | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 5 | $0.0629 | none | none |
| hard-trailing-reqs | nudge-prompt | haiku | 20260702-160751 | 1 | 1 | 1.00 | 3 | 1 | 3 | $0.0555 | none | docstrings for all methods adds verbosity beyond requirements |
| hard-trailing-reqs | nudge-prompt | haiku | 20260702-160751 | 2 | 1 | 1.00 | 2 | 0 | 6 | $0.0733 | error handling re-raises exceptions instead of catching and storing | none |
| hard-trailing-reqs | baseline | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.1510 | none | none |
| hard-trailing-reqs | baseline | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.1507 | none | none |
| hard-trailing-reqs | baseline | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.1505 | none | none |
| hard-trailing-reqs | gaslighter-off | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.1515 | none | none |
| hard-trailing-reqs | gaslighter-off | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.1517 | none | none |
| hard-trailing-reqs | gaslighter-off | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 1 | 6 | $0.1519 | none | private _steps attribute instead of public steps |
| hard-trailing-reqs | gaslighter-lite | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.1884 | none | none |
| hard-trailing-reqs | gaslighter-lite | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 6 | $0.1835 | none | none |
| hard-trailing-reqs | gaslighter-lite | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.1885 | none | none |
| hard-trailing-reqs | gaslighter-full | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 9 | $0.2098 | none | none |
| hard-trailing-reqs | gaslighter-full | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 0 | 8 | $0.1890 | none | none |
| hard-trailing-reqs | gaslighter-full | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 8 | $0.1910 | none | none |
| hard-trailing-reqs | nudge-prompt | sonnet | 20260702-160751 | 0 | 1 | 1.00 | 3 | 0 | 6 | $0.1547 | none | none |
| hard-trailing-reqs | nudge-prompt | sonnet | 20260702-160751 | 1 | 1 | 1.00 | 3 | 1 | 6 | $0.1520 | none | private _steps attribute instead of public steps |
| hard-trailing-reqs | nudge-prompt | sonnet | 20260702-160751 | 2 | 1 | 1.00 | 3 | 0 | 6 | $0.1531 | none | none |
