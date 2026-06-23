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

**Current version**: 0.2.0 (2026-06-23)

**v0.1.0 eval results**: Underperformed baseline (78.5-96.5% vs 94-100%) on single-turn tasks. See `docs/eval-findings-2026-06-23.md` and `docs/root-cause-analysis-2026-06-23.md` for detailed analysis.

**v0.2.0 changes**: 
- Recalibrated thresholds (AND logic instead of OR for full mode)
- Rewrote all nudge prompts (numbered checklists, "re-read requirements first")
- Added early termination detection
- See `docs/v0.2.0-implementation.md` for implementation notes

**Validation needed**: Run evals to confirm improvements. See CLAUDE.md for detailed eval workflow.

## Eval Suite

```bash
cd evals

# Validate all scorers (no API spend)
python run.py --selftest

# Recommended: run on both haiku and sonnet
python run.py --task hard-* --models haiku,sonnet --runs 4

# Pilot: 5 tasks × 3 arms × 4 runs
python run.py --pilot --runs 4

# Rescore from kept workspaces
python run.py --rescore runs/<stamp>
```

For systematic analysis of eval results, see the "Quick Start — Validate v0.2.0 Improvements" section in CLAUDE.md.

### Arms

- **baseline** — no plugin, no extra prompts
- **gaslighter** — plugin loaded via `--plugin-dir`
- **nudge-prompt** — static system prompt with nudge text (control: does a dynamic hook outperform a static instruction?)

### Primary metric

`complete_rate` — fraction of stated requirements implemented (deterministic, per-requirement scoring).

## Testing the Judge Skill

The judge skill allows LLM-based evaluation of completeness and overcorrection without direct API calls. Instead of using `judge.py`, you can run judging inside a Claude Code session with the plugin loaded.

### Load plugin in a test session

```bash
claude --plugin-dir /path/to/gaslighter
```

### Run pilot evals to generate workspaces

```bash
cd evals
python run.py --pilot --runs 2
# outputs to runs/<timestamp>/
```

### Invoke the judge skill

In the Claude Code session with the plugin loaded:

```
/gaslighter:judge runs/<timestamp>
```

This will:
1. Read task prompts from `evals/tasks.py`
2. For each workspace, judge completeness (0-3) and overcorrection (0-3)
3. Write `judge.json` to the run directory
4. Display aggregate statistics by arm

### Compare to direct API approach

The skill produces the same output format as `python judge.py --run runs/<timestamp>` but runs within the Claude session instead of making direct API calls.
