---
name: gaslighter
description: "Requirement completeness checker: configure nudges, run gaslighter evals, or judge a completed eval run."
---

# Gaslighter

Use this playbook to route gaslighter requests.

## Routing

- `eval`, `evals`, `benchmark` — load the `eval` skill and preserve remaining arguments.
- `judge`, `score`, `rate` — load the `judge` skill and preserve remaining arguments.
- `config`, `configure`, `setup` — load the `config` skill.
- `help` — explain Modes and How It Works below.
- No argument — use the host's interactive question tool to ask whether to run evals, judge a run, configure, or show help; then follow the matching route.

Use the host's skill-loading mechanism. Do not assume a harness-specific skill tool name.

## Modes

Mode and nudge cap are persisted in gaslighter's `config.json`. Configure them through the `config` skill rather than re-exporting environment variables every session.

Precedence, independently for mode and cap: environment variable > persisted config > mode default.

- `lite` (default) — soft nudge; default cap 3/session.
- `full` — hard block; unlimited by default.
- `smart` — asks a cheap model whether a requirement was missed; default cap 2/session.
- `off` — disabled.

Per-session overrides:

- `GASLIGHTER_MODE` — `off`, `lite`, `full`, or `smart`.
- `GASLIGHTER_MAX_NUDGES` — positive integer, `infinite`, `unlimited`, or `-1`.

## How It Works

At the end of a changed coding turn, gaslighter asks the agent to re-check the original request. It nudges at most once per attempted completion and respects the mode's cap. A subsequent tool-free re-check or an explicit 100%-certainty declaration ends the nudge cycle.
