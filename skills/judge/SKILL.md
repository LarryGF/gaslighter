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

1. Reads eval workspace directories from the specified run
2. For each workspace:
   - Extracts the task prompt from `evals/tasks.py`
   - Reads source files (skips tests and artifacts)
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

Respond with ONLY this JSON:
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

Respond with ONLY this JSON:
```json
{"overcorrection": <0-3>, "why": "<one line>", "cite": "<construct or none>"}
```

## Implementation Instructions

When invoked with a run directory:

1. **Load tasks**: Read `evals/tasks.py` and extract the TASKS dictionary to get task prompts
2. **Find workspaces**: List directories in the run matching pattern `{task}__{arm}__{model}__{timestamp}`
3. **For each workspace**:
   - Extract task ID from directory name (first segment before `__`)
   - Get task prompt from TASKS dict
   - Collect source files:
     - Skip files starting with `.` or `_`
     - Skip test files (test_*.py, *_test.py, conftest.py)
     - Skip __pycache__ and .pyc files
     - Concatenate with headers showing relative paths
   - Judge completeness: pass task prompt + source files through the completeness rubric
   - Judge overcorrection: pass task prompt + source files through the overcorrection rubric
   - Parse JSON responses
4. **Aggregate results**: Write judge.json with structure:
   ```json
   {
     "judge": "claude-haiku-4-5-20251001",
     "scores": [
       {
         "task": "task-id",
         "arm": "nudge|control",
         "model": "model-name",
         "completeness": 0-3,
         "missing": "piece or none",
         "overcorrection": 0-3,
         "cite": "construct or none"
       }
     ]
   }
   ```
5. **Display stats**: Show mean completeness and overcorrection by arm

## Error handling

- If workspace directory pattern doesn't match, skip it
- If task ID not found in TASKS, skip that workspace
- If JSON parsing fails, record null for that score
- Report progress every 10 workspaces
