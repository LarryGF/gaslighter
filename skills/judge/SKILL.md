---
name: judge
description: "LLM judge for gaslighter evals — fans out one sub-agent per task to rate completeness and overcorrection"
model: sonnet
allowed-tools: ["Agent(gaslighter:judge-agent)", "Bash", "Read", "Write"]
---

# Judge Skill

Orchestrates parallel judging of gaslighter eval workspaces. Launches one `gaslighter:judge-agent` per task for scoring.

## Usage

`/gaslighter:judge runs/<stamp>`

Where `<stamp>` is a run directory name (e.g., `runs/20260623-1330`).

## Implementation Instructions

When invoked with a run directory:

### Step 1: Collect & prep (main session)

1. Run `python3 evals/judge.py --collect evals/runs/<stamp>` — save stdout to a variable (JSON array of workspace objects with `task`, `arm`, `model`, `prompt`, `source` fields)
2. Read `evals/runs/<stamp>/results.json` for automated scores
3. Build a lookup from results.json keyed by workspace name (`task__arm__model__run`) to get `complete_rate` per workspace
4. Group the collected workspaces by `task` field — you should get ~5 groups

### Step 2: Fan out (parallel sub-agents)

Launch one `Agent()` call per task group — all in a single message so they run in parallel.

Each agent call:
- `subagent_type: "gaslighter:judge-agent"`
- `model: "haiku"`
- `schema` option (below) for structured output

Agent prompt — just the data, rubrics come from the agent's system prompt:
```
Judge the following workspaces for task "{task_id}":

{JSON array of workspaces with their automated complete_rate}
```

Schema for structured output:
```json
{
  "type": "object",
  "properties": {
    "scores": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "task": {"type": "string"},
          "arm": {"type": "string"},
          "model": {"type": "string"},
          "completeness": {"type": "integer", "minimum": 0, "maximum": 3},
          "missing": {"type": "string"},
          "overcorrection": {"type": "integer", "minimum": 0, "maximum": 3},
          "cite": {"type": "string"}
        },
        "required": ["task", "arm", "model", "completeness", "missing", "overcorrection", "cite"]
      }
    }
  },
  "required": ["scores"]
}
```

### Step 3: Merge & write (main session)

1. Collect all returned score arrays from the agents
2. Filter out any null results (from failed agents)
3. Merge into a single `scores` array
4. Write `evals/runs/<stamp>/judge.json`:
   ```json
   {
     "scores": [...]
   }
   ```
5. Run `python3 evals/judge.py --summarize evals/runs/<stamp>` to print aggregate stats
6. Display a markdown results table:

```
| Task | Arm | n | Completeness (mean) | Overcorrection (mean) |
|------|-----|---|--------------------|-----------------------|
| ...  | ... | . | ...                | ...                   |
```

## Error handling

- **Missing results.json**: Report error — cannot judge without automated baseline
- **Missing run directory**: Validate path exists, suggest `ls evals/runs/` to find correct timestamp
- **No workspaces collected**: Report error, suggest checking run directory contents
- **Agent returns null**: Log warning, continue with remaining agents' results
- **Partial run**: Some workspaces may be missing — log count of skipped
