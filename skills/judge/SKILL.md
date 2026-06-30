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
2. **For each workspace** in the array:
   - Read the `prompt` (task given to the author) and `source` (files they wrote)
   - Judge completeness using the rubric above
   - Judge overcorrection using the rubric above
   - Record both scores
3. **Write results**: Write `evals/runs/<stamp>/judge.json` with structure:
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

- If workspace directory pattern doesn't match, skip it
- If task ID not found in TASKS, skip that workspace
- Report progress every 10 workspaces
