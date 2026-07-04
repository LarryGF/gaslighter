---
name: gaslighter
description: "Requirement completeness checker — nudges you to re-read the original request before finishing. Routes to eval and judge sub-skills."
when_to_use: "Use when user says 'gaslighter', 'eval', 'evals', 'run evals', 'benchmark', 'judge', 'score', 'rate', or invokes /gaslighter directly."
model: haiku
allowed-tools:
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/hooks/gaslighter-config-cli.js" --get)
  - Skill(gaslighter:eval)
  - Skill(gaslighter:judge)
  - Skill(gaslighter:config)
  - AskUserQuestion()
---

# Gaslighter — Requirement Completeness Guard

A Stop hook that asks you to verify you haven't missed anything before completing code changes. When nudged, genuinely re-read the original request — don't assume you're done.

## Config Check

Current persisted config: !`node "${CLAUDE_PLUGIN_ROOT}/hooks/gaslighter-config-cli.js" --get`

## Routing

Before routing to `eval`/`judge` (including the AskUserQuestion fallback for "Run evals" / "Judge run"): check the config JSON injected above. If it is `{}` or missing the `mode` key, ignore ARGUMENTS and route straight to `Skill({ skill: "gaslighter:config" })` instead — the plugin isn't configured yet.

This gate does **not** apply when ARGUMENTS is `config`/`configure`/`setup` or `help` — config is already the destination, or isn't needed.

Route based on ARGUMENTS:

- `eval`, `evals`, `benchmark` → `Skill({ skill: "gaslighter:eval", args: "{remaining args}" })`
- `judge`, `score`, `rate` → `Skill({ skill: "gaslighter:judge", args: "{remaining args}" })`
- `config`, `configure`, `setup` → `Skill({ skill: "gaslighter:config" })`
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
      { label: "Configure", description: "Set mode and nudge cap, persisted to config.json" },
      { label: "Help", description: "Show gaslighter usage and configuration" }
    ]
  }]
})
```

Then route based on selection (Configure and Help bypass the config gate; Run evals / Judge run are subject to it):
- Run evals → `Skill({ skill: "gaslighter:eval" })`
- Judge run → `Skill({ skill: "gaslighter:judge" })`
- Configure → `Skill({ skill: "gaslighter:config" })`
- Help → show sections below

## Modes

Mode and nudge cap are persisted in `${CLAUDE_PLUGIN_DATA}/config.json` — set them via `Skill({ skill: "gaslighter:config" })` (or `/gaslighter:config`) instead of re-exporting an env var every session.

Precedence (mode and nudge cap independently): env var > persisted `config.json` > mode default.

- `lite` (default) — hook on, soft nudge via `additionalContext`, up to 3 nudges/session by default
- `full` — hook on, hard block via `decision: "block"`, unlimited nudges by default
- `off` — hook disabled, 0 nudges, always

Override per-session without touching the persisted config:
- `GASLIGHTER_MODE` — `off` / `lite` / `full`
- `GASLIGHTER_MAX_NUDGES` — a positive integer, or `infinite`/`unlimited`/`-1` for no cap

## How It Works

Each time you try to finish a response, the hook fires and asks you to re-check the original request. It fires at most once per stop, up to the mode's nudge cap (see Modes above). First nudge forces re-examination; subsequent nudges give you an escape hatch if you're genuinely done.
