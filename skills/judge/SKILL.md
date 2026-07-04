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

### Step 1: Prep (main session)

Run `python3 evals/judge.py --prep evals/runs/<stamp>`. This collects workspaces, annotates each with its automated `complete_rate` (looked up from `results.json` by `task__arm__model__run`), groups them by task, and writes a pretty-printed `evals/runs/<stamp>/judge_input/<task>.json` per task. It prints a manifest to stdout: `{task: {path, count, workspaces}}` — use this to know what to fan out in Step 2 and how many/which workspaces each task's agent is expected to return in Step 3.

### Step 2: Fan out (parallel sub-agents)

Launch one `Agent()` call per task group — all in a single message so they run in parallel.

Each agent call:
- `subagent_type: "gaslighter:judge-agent"`
- `model: "haiku"`

Agent prompt — point at the file, do not inline the JSON (it's too large for a prompt):
```
Judge the following workspaces for task "{task_id}":

RAW_JSON_INPUT_PATH: evals/runs/<stamp>/judge_input/{task_id}.json

This file is pretty-printed JSON — a single Read call with no offset/limit gives you the ENTIRE file in one shot. It is a JSON array of exactly {n} workspace objects, each with `task`, `arm`, `model`, `prompt`, `source`, `workspace`, and `complete_rate` fields.

Score EVERY one of the {n} workspaces per your rubric — do not skip, sample, duplicate, or fabricate any. Use the provided `complete_rate` as your calibration anchor and move on without second-guessing.

There is no "StructuredOutput" tool available — do not attempt to call one. Output ONLY a raw JSON object as your final answer text, with no prose before or after it and no markdown code fences, exactly matching this shape:

{
  "scores": [
    {
      "task": "{task_id}",
      "arm": "<arm from the workspace object>",
      "model": "<model from the workspace object>",
      "workspace": "<workspace value copied verbatim from the input object>",
      "completeness": <integer 0-3>,
      "missing": "<string>",
      "overcorrection": <integer 0-3>,
      "cite": "<string>"
    },
    ... one entry per workspace, {n} entries total ...
  ]
}
```

`workspace` must be copied verbatim from the input object — do not paraphrase or shorten it. It's how the merge step matches a score back to the workspace it belongs to.

Note: this skill is invoked via the interactive `Agent` tool, not a Workflow script — there is no `schema` parameter and no automatic `StructuredOutput` tool injection. The agent must be told explicitly to emit plain JSON as its final text; the prompt above does this.

### Step 3: Merge (main session)

1. From each agent's final text, extract the JSON object (agents may still wrap it in a code fence or add a sentence before/after despite instructions — find the outermost `{...}` and parse it; if parsing fails, retry that one agent rather than guessing at its output)
2. Write each task's parsed JSON to `evals/runs/<stamp>/judge_input/<task>.scores.json`
3. Run `python3 evals/judge.py --merge evals/runs/<stamp>`. It matches scores to expected workspaces by name (not position), merges into `judge.json` (per-task overwrite by name, so re-running is safe), and calls the existing summarizer.
4. If it exits nonzero, it printed specific missing/duplicate workspace names per task on stderr. Relaunch only the implicated task's agent (Step 2, scoped to that one task), write its scores file again, and re-run `--merge` — already-merged tasks are untouched.
5. Once `--merge` exits 0, display a markdown results table:

```
| Task | Arm | n | Completeness (mean) | Overcorrection (mean) |
|------|-----|---|--------------------|-----------------------|
| ...  | ... | . | ...                | ...                   |
```

### Step 4: Render findings (main session)

Run `python3 evals/render_findings.py evals/runs/<stamp>`. This updates the auto-generated regions of `docs/eval-findings.md`, `README.md`, and `evals/README.md` in place — the headline table, per-task table, intro paragraph, sample-size note, missing-metrics note, and README/evals-README leader/premium sentence are all recomputed from `results.json` + `judge.json` and spliced into sentinel-marked regions; new appendix rows are appended to `docs/eval-findings.md`, existing appendix rows are never rewritten. It also regenerates the README benchmark chart (`assets/benchmark.svg` + `assets/benchmark-dark.svg`) from the merged data.

Read its printed before/after delta table, then hand-update **only** the `## Key findings` section of `docs/eval-findings.md` using those deltas — that section is interpretive and intentionally left out of automatic rendering. Also touch the "Note on hook version" paragraph only if this run's hook version differs from the last merged run in a materially relevant way (same judgment call as before).

If `render_findings.py` exits 2, this run's stamp is already in the appendix — nothing to do, not an error. If it exits 1, it printed the specific problem (missing sentinel marker, missing input file, or a join that produced zero usable rows) — fix that before retrying.

## Error handling

- **Missing results.json**: Report error — cannot judge without automated baseline
- **Missing run directory**: Validate path exists, suggest `ls evals/runs/` to find correct timestamp
- **No workspaces collected**: Report error, suggest checking run directory contents
- **Agent returns null**: Log warning, continue with remaining agents' results
- **`judge.py --merge` exits nonzero**: it reports missing or duplicate workspaces by name, per task, on stderr — relaunch only the implicated task's agent (not all of them) and re-run `--merge`.
- **Partial run**: Some workspaces may be missing — log count of skipped
