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

1. Run `python3 evals/judge.py --collect evals/runs/<stamp>` — save stdout to a variable (JSON array of workspace objects with `task`, `arm`, `model`, `prompt`, `source`, `workspace` fields)
2. Read `evals/runs/<stamp>/results.json` for automated scores. Each result entry has a `run` field (int) — build a lookup keyed by `f"{task}__{arm}__{model}__{run}"` to get `complete_rate` per workspace. Match this against each collected workspace's `workspace` field (its basename is `task__arm__model__run`).
3. Group the collected workspaces by `task` field — you should get ~5 groups
4. For each task group, write the workspaces (each annotated with its `complete_rate`) to a **pretty-printed** JSON file, e.g. `json.dump(items, f, indent=2)` to `/tmp/judge_input_{task}.json`. Do NOT write single-line/minified JSON — the judge-agent's Read tool truncates very long lines, and a 30-workspace task can be 50-100KB on one line. Pretty-printing with `indent=2` keeps every line short regardless of file size.

### Step 2: Fan out (parallel sub-agents)

Launch one `Agent()` call per task group — all in a single message so they run in parallel.

Each agent call:
- `subagent_type: "gaslighter:judge-agent"`
- `model: "haiku"`

Agent prompt — point at the file, do not inline the JSON (it's too large for a prompt):
```
Judge the following workspaces for task "{task_id}":

RAW_JSON_INPUT_PATH: /tmp/judge_input_{task_id}.json

This file is pretty-printed JSON — a single Read call with no offset/limit gives you the ENTIRE file in one shot. It is a JSON array of exactly {n} workspace objects, each with `task`, `arm`, `model`, `prompt`, `source`, `workspace`, and `complete_rate` fields.

Score EVERY one of the {n} workspaces per your rubric — do not skip, sample, duplicate, or fabricate any. Use the provided `complete_rate` as your calibration anchor and move on without second-guessing.

There is no "StructuredOutput" tool available — do not attempt to call one. Output ONLY a raw JSON object as your final answer text, with no prose before or after it and no markdown code fences, exactly matching this shape:

{
  "scores": [
    {
      "task": "{task_id}",
      "arm": "<arm from the workspace object>",
      "model": "<model from the workspace object>",
      "completeness": <integer 0-3>,
      "missing": "<string>",
      "overcorrection": <integer 0-3>,
      "cite": "<string>"
    },
    ... one entry per workspace, {n} entries total ...
  ]
}
```

Note: this skill is invoked via the interactive `Agent` tool, not a Workflow script — there is no `schema` parameter and no automatic `StructuredOutput` tool injection. The agent must be told explicitly to emit plain JSON as its final text; the prompt above does this.

### Step 3: Merge & write (main session)

1. From each agent's final text, extract the JSON object (agents may still wrap it in a code fence or add a sentence before/after despite instructions — find the outermost `{...}` and parse it; if parsing fails, retry that one agent rather than guessing at its output)
2. Verify each task's scores array has the expected count (matches the number of workspaces sent) — if short, some workspaces were skipped or fabricated; relaunch that agent with an explicit reminder of the expected count rather than accepting a partial/padded result
3. Filter out any null results (from failed agents)
4. Merge into a single `scores` array
5. Write `evals/runs/<stamp>/judge.json`:
   ```json
   {
     "scores": [...]
   }
   ```
6. Run `python3 evals/judge.py --summarize evals/runs/<stamp>` to print aggregate stats
7. Display a markdown results table:

```
| Task | Arm | n | Completeness (mean) | Overcorrection (mean) |
|------|-----|---|--------------------|-----------------------|
| ...  | ... | . | ...                | ...                   |
```

### Step 4: Enrich the docs (main session)

After every judged run, update these three files so they always reflect the latest findings — do this automatically, don't wait to be asked:

- `README.md` (top-level `## Results` section)
- `evals/README.md` (`## Results` section)
- `docs/eval-findings.md` (the full findings doc)

**Merge, don't replace.** `docs/eval-findings.md` accumulates across runs — each new judged run gets folded into the existing findings, not swapped in on top of them. To do this:

1. Read the current `docs/eval-findings.md` and recover its underlying per-row data. If it already has a "Full per-run table" appendix, that table IS the source of truth for prior runs — parse it back into rows (it already has a `Run Stamp` column for exactly this purpose). If this is the first-ever judged run, there's nothing to merge; skip to step 3.
2. Combine those prior rows with this run's rows (`task`, `arm`, `model`, a per-cell run index, `correct`, `complete_rate`, `completeness`, `overcorrection`, `turns`, `cost`, `missing`, `cite`), tagging each new row with this run's stamp so the appendix stays traceable to its source run per-row.
3. Recompute every aggregate from the combined row set — overall by-arm headline table, and per-task by-arm table — with the resulting `n` per arm/task reflecting the true pooled cell count (arms/tasks only present in one run keep that run's `n`; arms/tasks in both runs sum their `n`). Never hand-average two runs' published means — recompute from the pooled raw rows, since runs can have different cell counts per arm and a naive mean-of-means silently misweights them.
4. Rewrite `docs/eval-findings.md`: setup section (list every run stamp folded in, and what cell counts/tasks each contributed), the merged headline table, key findings (re-derive from the merged numbers — don't just keep old prose that a merge may have invalidated), the merged per-task table, methodology notes, then the appended full per-run table (every prior run's rows plus this run's, each tagged with its `Run Stamp`).
5. Update the `## Results` table in `README.md` and `evals/README.md` to match the new merged headline table, and update their cell-count/run-stamp descriptions accordingly.
6. If this run used a plugin/hook version that differs from a previously-merged run in a way that would materially change turn/cost behavior (e.g. an anti-loop or nudge-logic fix landed between runs), call this out explicitly in a "Note on hook version" callout — don't silently blend numbers from different hook behaviors without flagging it.

## Error handling

- **Missing results.json**: Report error — cannot judge without automated baseline
- **Missing run directory**: Validate path exists, suggest `ls evals/runs/` to find correct timestamp
- **No workspaces collected**: Report error, suggest checking run directory contents
- **Agent returns null**: Log warning, continue with remaining agents' results
- **Agent returns fewer scores than workspaces sent, or a suspicious pattern of duplicate entries**: Treat as a failed judgment, not a partial success — relaunch that task's agent rather than merging the incomplete/fabricated result
- **Partial run**: Some workspaces may be missing — log count of skipped
