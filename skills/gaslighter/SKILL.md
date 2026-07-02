---
name: gaslighter
description: "Requirement completeness checker — nudges you to re-read the original request before finishing. Routes to eval and judge sub-skills."
when_to_use: "Use when user says 'gaslighter', 'eval', 'evals', 'run evals', 'benchmark', 'judge', 'score', 'rate', or invokes /gaslighter directly."
model: haiku
allowed-tools:
  - Skill(gaslighter:eval)
  - Skill(gaslighter:judge)
  - AskUserQuestion()
---

# Gaslighter — Requirement Completeness Guard

A Stop hook that asks you to verify you haven't missed anything before completing code changes. When nudged, genuinely re-read the original request — don't assume you're done.

## Routing

Route based on ARGUMENTS:

- `eval`, `evals`, `benchmark` → `Skill({ skill: "gaslighter:eval", args: "{remaining args}" })`
- `judge`, `score`, `rate` → `Skill({ skill: "gaslighter:judge", args: "{remaining args}" })`
- `help` → show the Modes and How It Works sections below
- anything else or empty → ask the user:

```
AskUserQuestion({
  questions: [{
    question: "What would you like to do?",
    header: "Action",
    multiSelect: false,
    options: [
      { label: "Run evals", description: "Run the gaslighter benchmark suite" },
      { label: "Judge run", description: "Score a completed eval run for completeness and overcorrection" },
      { label: "Help", description: "Show gaslighter usage and configuration" }
    ]
  }]
})
```

Then route based on selection:
- Run evals → `Skill({ skill: "gaslighter:eval" })`
- Judge run → `Skill({ skill: "gaslighter:judge" })`
- Help → show sections below

## Modes

Set `GASLIGHTER_MODE` env var:

- `lite` (default) — exit 1, soft nudge suggests re-examination
- `full` — exit 2, hard block forces re-examination
- `off` — disabled, hook exits silently

## How It Works

When you use Write or Edit tools, the hook fires and asks you to re-check the original request. It fires at most once per turn and at most 3 times per session. First nudge forces re-examination; subsequent nudges give you an escape hatch if you're genuinely done.
