# Gaslighter

A Claude Code plugin that automatically nudges the model to verify requirement completeness before finishing complex responses.

## What It Does

In long conversations, Claude often focuses on implementation and forgets stated requirements. Users work around this by prompting "are you sure?" or "did you cover everything?". Gaslighter automates this by using a **Stop hook** to block Claude's completion and inject a targeted "review your work" prompt.

The nudge demands **specific enumeration** of requirements — not a vague "yes I checked" — making dismissal more costly than genuine reconsideration.

## Install

```bash
claude plugin add /path/to/gaslighter
```

Or clone and point to the repo:

```bash
claude plugin add ~/Documents/GitHub/gaslighter
```

## Modes

| Mode | Behavior | When it fires |
|------|----------|---------------|
| `lite` | Non-blocking suggestion | 2+ files edited, or task list + 4+ tool calls |
| `full` (default) | Blocking — must address | Task list present, OR (1+ file edited AND 3+ tool calls) |
| `ultra` | Blocking, aggressive | Any tool call, or response > 500 chars |
| `off` | Disabled | Never |

### Switching modes

In a Claude Code session:

```
/gaslighter lite
/gaslighter full
/gaslighter ultra
/gaslighter off
```

Or deactivate with `stop gaslighter` / `normal mode`.

### Persistent configuration

Set the default mode via environment variable:

```bash
export GASLIGHTER_DEFAULT_MODE=lite
```

Or config file (`~/.config/gaslighter/config.json`):

```json
{"defaultMode": "full"}
```

Resolution order: env var > config file > `full`.

## How It Works

1. **SessionStart** — activates the plugin, writes flag file, injects behavioral instructions
2. **UserPromptSubmit** — tracks `/gaslighter` commands, increments turn count
3. **Stop** (the core) — analyzes the transcript, decides whether to nudge:
   - Counts tool calls, files edited, task list usage
   - Compares against mode thresholds
   - Selects context-appropriate nudge text
   - Blocks (exit 2) or suggests (exit 0) depending on mode
4. **PreCompact** — reminds Claude to preserve unfinished requirements in compaction summaries

### Safety guards

- At most 1 nudge per turn (prevents re-block loops)
- Max 2 consecutive nudges
- Max 10 nudges per session
- `off` mode skips all checks

## What a Nudge Looks Like

When the Stop hook fires in blocking mode, Claude receives something like:

> GASLIGHTER CHECK: Re-read the original request. List every requirement the user stated (numbered). For each, state whether it is fully implemented, partially implemented, or missing. Fix any gaps.

Claude must then enumerate requirements before completing its response.

## Compatibility

Gaslighter governs **completeness** (were stated requirements implemented?), not **style** (how code is written). It works alongside ponytail, caveman, or other style plugins without conflict.

## Manual Testing

1. Install the plugin
2. Start a session — you should see "Loading gaslighter mode..." in the status
3. Give a multi-requirement task, e.g.:
   > Create a function that: accepts a list of numbers, filters out negatives, sorts ascending, returns the median. Also add a docstring and type hints.
4. After Claude responds, the Stop hook should fire and inject a completeness check
5. Verify Claude enumerates requirements and addresses any gaps
6. Try `/gaslighter off` to disable, `/gaslighter ultra` for aggressive mode

## Status

**Current version**: 0.2.0 (2026-06-29)

### Eval history

**v0.1.0** — Underperformed baseline (78.5–96.5% vs 94–100%) on single-turn explicit-checklist tasks. Root cause: tasks were too easy — models went item-by-item and rarely missed anything, so the nudge had nothing to catch.

**v0.2.0** — Recalibrated thresholds (AND logic for full mode), rewrote nudge prompts, added early termination detection. Rewrote eval tasks to target five specific failure modes where models actually drop requirements:

| Task | Failure mode | What it tests |
|------|-------------|---------------|
| `hard-buried-constraints` | Requirements buried in prose | Did the model read the entire prompt? |
| `hard-implicit-patterns` | Conventions in seed code, not stated in prompt | Did the model look at existing code? |
| `hard-cascade-update` | One change implies updates to 6 dependent files | Did the model trace dependencies? |
| `hard-preserve-behavior` | Fix a bug without "improving" intentional design | Did the model resist unnecessary cleanup? |
| `hard-trailing-reqs` | Requirements appended after the main ask | Did the model read to the end? |

### Results (n=5, 2026-06-29)

Complete rate by arm (mean of 5 runs). Bold = best arm for that task.

**Haiku**

| Task | Baseline | Gaslighter | Nudge-prompt |
|------|----------|------------|--------------|
| buried-constraints | **1.00** | 0.98 | **1.00** |
| cascade-update | 0.78 | **0.88** | 0.27 |
| implicit-patterns | **1.00** | **1.00** | **1.00** |
| preserve-behavior | **1.00** | **1.00** | **1.00** |
| trailing-reqs | **1.00** | **1.00** | 0.80 |

**Sonnet**

| Task | Baseline | Gaslighter | Nudge-prompt |
|------|----------|------------|--------------|
| buried-constraints | 0.88 | **0.90** | **0.90** |
| cascade-update | **0.90** | 0.78 | 0.75 |
| implicit-patterns | **1.00** | **1.00** | **1.00** |
| preserve-behavior | **1.00** | **1.00** | **1.00** |
| trailing-reqs | 0.20 | 0.00 | 0.00 |

**Key findings:**

- **Haiku + cascade-update**: Gaslighter's strongest win — 0.88 vs 0.78 baseline, 0.27 nudge-prompt. The hook caught missed dependency updates that static nudging didn't.
- **Haiku + trailing-reqs**: Nudge-prompt regressed (0.80) while baseline and gaslighter held at 1.0.
- **Sonnet + trailing-reqs**: All arms scored near zero — this was a **harness bug**, not a task difficulty finding. Sonnet hallucinated "the file already exists" in empty workspaces (14/15 runs wrote no files). Fixed by adding a seed file.
- **Sonnet + cascade-update**: Gaslighter slightly underperformed baseline. One run scored 0.0 during eval but rescores as 0.88 — likely a scorer race condition under parallel I/O. Fixed with `os.sync()` before scoring.
- **3 of 5 tasks showed no differentiation** (all arms ~1.0) on both models — these tasks may be too easy or need harder variants.

## Eval Suite

```bash
cd evals

# Validate all scorers (no API spend)
python run.py --selftest

# Single task, quick check
python run.py --task hard-buried-constraints --models haiku --runs 1

# Full run: 5 tasks × 3 arms × 4 runs
python run.py --all --runs 4

# Multi-model
python run.py --all --models haiku,sonnet --runs 4

# Exclude a task
python run.py --all --exclude-task hard-preserve-behavior

# Rescore from kept workspaces
python run.py --rescore runs/<stamp>
```

### Arms

| Arm | What it does |
|-----|-------------|
| **baseline** | No plugin, no extra prompts |
| **gaslighter** | Plugin loaded via `--plugin-dir` |
| **nudge-prompt** | Static system prompt with nudge text (control: does a dynamic hook outperform a static instruction?) |

### Metrics

| Metric | Source | Meaning |
|--------|--------|---------|
| `complete_rate` | Deterministic scorer (string match + AST) | Fraction of scored requirements found in workspace files |
| `correct` | `1 if complete_rate >= 0.75 else 0` | Binary pass/fail threshold on complete_rate |
| `LOC` | `code_stats()` | Non-blank non-comment source lines (excludes tests) |
| `turns` | Claude CLI metadata | Number of model turns in the session |
| `cost` | Claude CLI metadata | API cost per session in USD |

### LLM Judge

For subjective evaluation (completeness and overcorrection ratings), use the judge skill in a Claude Code session with the plugin loaded:

```bash
claude --plugin-dir /path/to/gaslighter
```

Then invoke:

```
/gaslighter:judge runs/<timestamp>
```

This collects workspace data via `judge.py --collect`, then the session model rates each workspace on completeness (0–3) and overcorrection (0–3). Results are written to `runs/<timestamp>/judge.json`. No direct API calls — the session model is the judge.
