---
name: gaslighter
description: "Requirement completeness checker — nudges you to re-read the original request before finishing"
model: sonnet
---

# Gaslighter — Requirement Completeness Guard

A Stop hook that asks you to verify you haven't missed anything before completing code changes. When nudged, genuinely re-read the original request — don't assume you're done.

## Switching Modes

- `GASLIGHTER_DEFAULT_MODE=on` (default) — active
- `GASLIGHTER_DEFAULT_MODE=off` — disabled
- `stop gaslighter` or `normal mode` in conversation — disable for session

## How It Works

When you use Write or Edit tools, the hook fires and asks you to re-check the original request. It fires at most once per turn and at most 3 times per session. First nudge forces re-examination; subsequent nudges give you an escape hatch if you're genuinely done.
