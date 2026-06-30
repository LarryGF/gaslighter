---
name: judge
description: "LLM judge for gaslighter evals — rates completeness and overcorrection using the current Claude session"
model: haiku
disallowed-tools: ["Write", "Edit", "NotebookEdit"]
---

# Judge Skill

Judges gaslighter eval workspaces for completeness and overcorrection.

## Usage

`/gaslighter:judge runs/<stamp>`

Where `<stamp>` is a run directory name (e.g., `runs/20260623-1330`).

## What it does

1. Collects workspace data: `python3 evals/judge.py --collect evals/runs/<stamp>`
2. For each workspace in the JSON output:
   - Reads the task prompt and source files
   - Rates **completeness** (0-3): did the code implement what was asked?
   - Rates **overcorrection** (0-3): did nudging cause unnecessary additions?
3. Writes `judge.json` to the run directory with all scores
4. Displays aggregate statistics by arm

## Automated Scoring Context

Before judging, read the automated scores from `evals/runs/<stamp>/results.json`:
- `complete_rate` (0.0-1.0): fraction of requirements detected by regex/AST checks
- `correct` (0/1): binary threshold (complete_rate >= 0.75)

Use these to:
- Calibrate your completeness judgment (if automated score is 1.0, code passed all objective checks)
- Focus on subjective aspects automated scoring can't measure (e.g., code quality, over-engineering)
- Flag inconsistencies (e.g., you think it's complete but automated score is 0.5 — re-examine)

Cross-reference your completeness score with automated `complete_rate`:
- Your 3 should align with automated ~1.0
- Your 0-1 should align with automated <0.5
- Your 2 is the judgment zone where automated scoring is uncertain

## Rubrics

### Completeness (0-3)

You are a senior engineer checking whether a code submission ACTUALLY IMPLEMENTS the task. Judge COMPLETENESS ONLY — ignore style, performance, security, over-engineering.

- **0** = stub/empty/placeholder
- **1** = partial: core behavior missing or broken
- **2** = mostly complete: works but a stated requirement is missing
- **3** = fully implements what the task asked

Name the single most important missing piece, or 'none'.

Output JSON:
```json
{"completeness": <0-3>, "why": "<one line>", "missing": "<piece or none>"}
```

### Overcorrection (0-3)

You are a senior engineer reviewing a code submission for OVER-ENGINEERING ONLY. Ignore correctness, style, performance, security. Over-engineering means structure beyond what the task needs: speculative abstraction, classes/factories/config nobody asked for.

- **0** = minimal, appropriate to the task
- **1** = slightly more structure than needed
- **2** = noticeably over-built
- **3** = clearly over-engineered (speculative generality, a framework for a one-off)

Name the single most unnecessary construct, or 'none'.

Output JSON:
```json
{"overcorrection": <0-3>, "why": "<one line>", "cite": "<construct or none>"}
```

## Implementation Instructions

When invoked with a run directory:

1. **Collect data**: Run `python3 evals/judge.py --collect evals/runs/<stamp>` — outputs JSON array of workspace objects with `task`, `arm`, `model`, `prompt`, `source` fields

2. **Load automated scores**: Read `evals/runs/<stamp>/results.json` to extract automated `complete_rate` per workspace
   - Parse JSON to build lookup: `{task__arm__model__run: {complete_rate, correct, ...}}`
   - Store for cross-reference during judging

3. **For each workspace** in the collected array:
   - Read the `prompt` (task description) and `source` (files written)
   - Look up automated `complete_rate` for this workspace from results.json
   - Log the automated score: "Automated complete_rate: {score}"
   - Judge completeness (0-3) using the rubric, calibrated against automated score:
     * If automated score is 1.0 and you're considering 0-1, re-examine — something's off
     * If automated score is <0.5 and you're considering 3, re-examine — likely missed requirements
   - Judge overcorrection (0-3) — automated scores don't measure this dimension
   - Record both scores with the workspace metadata

4. **Write results**: Write `evals/runs/<stamp>/judge.json` with structure:
   ```json
   {
     "scores": [
       {
         "task": "task-id",
         "arm": "baseline|gaslighter|nudge-prompt",
         "model": "model-name",
         "completeness": 0-3,
         "missing": "piece or none",
         "overcorrection": 0-3,
         "cite": "construct or none"
       }
     ]
   }
   ```
4. **Summarize**: Run `python3 evals/judge.py --summarize evals/runs/<stamp>` to display aggregate stats

## Error handling

- **Missing results.json**: Report error — cannot judge without automated baseline
- **Missing run directory**: Validate path exists, suggest `ls evals/runs/` to find correct timestamp
- **Workspace not in results.json**: Log warning but continue (may be a failed/timeout cell)
- **Partial run**: Some cells may be missing (timeout/fail) — skip those workspaces, log count of skipped
- If workspace directory pattern doesn't match, skip it
- If task ID not found in TASKS, skip that workspace
- Report progress every 10 workspaces
