---
name: eval
description: "Run gaslighter eval suite — measures requirement completion across baseline/gaslighter/nudge-prompt arms"
model: haiku
allowed-tools: ["Bash", "Read", "Skill(gaslighter:judge)"]
---

# Eval Skill

Run gaslighter eval suite to measure requirement completion across experimental arms.

## Usage

`/gaslighter:eval [args]`

## Quick Examples

- `/gaslighter:eval --selftest` — Validate scorers (no API spend)
- `/gaslighter:eval --task hard-buried-constraints --models haiku --runs 1` — Quick single task
- `/gaslighter:eval --all --runs 4` — Full run with defaults
- `/gaslighter:eval --all --models haiku,sonnet --runs 2` — Multi-model comparison
- `/gaslighter:eval --all --exclude-task hard-preserve-behavior` — Run all except one task

## What It Does

Runs the gaslighter evaluation suite using `evals/run.py`:

**Experimental arms**:
- `baseline` — No plugin (control)
- `gaslighter-off` — Plugin loaded via `--plugin-dir` but disabled (measures plugin overhead)
- `gaslighter-lite` — Plugin with soft non-blocking nudge
- `gaslighter-full` — Plugin with hard-blocking nudge
- `nudge-prompt` — Static system prompt (non-hook nudging)

**Task types** (all from `tasks_hard.py`):
- `hard-buried-constraints` — Requirement deep in description
- `hard-implicit-patterns` — Implicit behavioral requirements
- `hard-cascade-update` — Change propagation across files
- `hard-preserve-behavior` — Don't break existing functionality
- `hard-trailing-reqs` — Requirements after main description

**Model mapping**:
- `haiku` → `claude-haiku-4-5`
- `sonnet` → `claude-sonnet-4-6`
- `opus` → `claude-opus-4-8`

**Output location**: `evals/runs/{timestamp}/` (gitignored)
- `results.json` — All cell results with automated scores
- `summary.json` — Aggregated results by arm/model
- `workspaces/{task}__{arm}__{model}__{run}/` — kept model outputs, enable `--rescore`

**Default config** (from `evals/config.json`) — lean by default; widen with flags:
- Workers: 8
- Timeout: 300s per cell
- Runs: 2
- Models: `["haiku", "sonnet"]`
- Arms: `["baseline", "gaslighter-lite", "gaslighter-full"]`
- Default matrix: 8 tasks × 2 models × 3 arms × 2 runs = **96 cells**. Use `--all --arms ...` to widen further.

## Implementation Instructions

When invoked:

1. **Parse arguments**: Extract flags from user input (default to config.json values if not specified)

2. **Build command**: `cd "${CLAUDE_PLUGIN_ROOT}/evals" && python3 run.py {args}`

3. **Determine execution mode**:
   - If `--selftest`: run foreground (fast, <10s)
   - Otherwise: run in background (evals take 5-20+ minutes)

4. **Launch task**:
   ```
   Bash({
     command: "cd "${CLAUDE_PLUGIN_ROOT}/evals" && python3 run.py {args}",
     run_in_background: true,  // false if --selftest
     description: "Run gaslighter eval suite"
   })
   ```

5. **Report to user**:
   - Task ID for tracking (if background)
   - Estimated completion time based on `--runs` and `--models`:
     * 1 run × 1 model ≈ 5-8 min
     * 4 runs × 1 model ≈ 20-30 min
     * 4 runs × 3 models ≈ 60-90 min

6. **On completion**: Extract the run timestamp from the eval output, print the automated score summary, then chain into judging:
   ```
   Bash({ command: "cd "${CLAUDE_PLUGIN_ROOT}/evals" && python3 analyze.py summary runs/{timestamp}" })
   Skill({ skill: "gaslighter:judge", args: "runs/{timestamp}" })
   ```
   `analyze.py summary` reads `summary.json` (complete_rate, correct_rate, turns, cost per task/arm/model) — free, no API spend — and gives the user a quick read before the judge skill spends tokens on LLM scoring. Do NOT tell the user to run judge manually — always chain automatically.

## Available Flags

- `--selftest` — Validate scorers without API spend
- `--all` — Run all tasks
- `--task TASK` — Run specific task (use multiple times or comma-separated)
- `--exclude-task TASK` — Skip specific task (use multiple times or comma-separated)
- `--models MODELS` — Comma-separated list (haiku, sonnet, opus)
- `--runs N` — Number of runs per cell
- `--workers N` — Parallel workers
- `--timeout N` — Seconds per cell
- `--config PATH` — Custom config file
- `--plugin-dir PATH` — Override plugin path (advanced)

## Error Handling

- **Invalid task name**: List available tasks: `hard-buried-constraints, hard-implicit-patterns, hard-cascade-update, hard-preserve-behavior, hard-trailing-reqs`
- **Invalid model**: List valid models: `haiku, sonnet, opus`
- **No timestamp in output**: Eval may have failed — check stderr and report to user
- **Config file not found**: Report error with expected path

## Example Session

User: `/gaslighter:eval --task hard-buried-constraints --models haiku --runs 1`

Response:
```
Running eval in background (task ID: bash_xyz)
Estimated time: 5-8 minutes

Configuration:
- Tasks: hard-buried-constraints
- Models: haiku (claude-haiku-4-5)
- Runs: 1
- Workers: 4
```

On completion, auto-invokes `Skill({ skill: "gaslighter:judge", args: "runs/{timestamp}" })`.
