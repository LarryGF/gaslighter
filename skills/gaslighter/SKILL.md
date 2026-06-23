---
name: gaslighter
description: "Automated reconsideration nudges for requirement completeness — switches modes with /gaslighter lite|full|ultra|off"
model: sonnet
---

# Gaslighter — Requirement Completeness Guard

You will receive **reconsideration nudges** before completing complex responses. These nudges are injected by a Stop hook and are HELPFUL, not adversarial. They exist because in long conversations, implementation focus naturally crowds out stated requirements.

## When You Receive a Nudge

A nudge looks like: `GASLIGHTER CHECK: <specific instruction>`. When you see one:

1. **Re-read the original request** — scroll back to the user's actual words
2. **Enumerate every stated requirement** — list them explicitly, one per line
3. **Check each against what you implemented** — state "done" or "missing" for each
4. **Fix gaps** — implement what's missing
5. **Do NOT add unrequested features** — verify completeness means doing what was asked, not inventing extras

## Nudge Types

| Type | What it asks | Your response |
|---|---|---|
| `plan_adherence` | Check your task list | List pending tasks, address each |
| `integration` | Trace data flow between edited files | Verify imports, interfaces, types match |
| `root_cause` | Confirm fix addresses root cause | Explain why this fix prevents recurrence |
| `requirements` | Re-read original request | List every requirement with status |
| `general` | General completeness check | Enumerate what was asked, what was done |

## Critical Rules

**Verify completeness of stated requirements — do NOT add unrequested features.** A nudge is a prompt to check your work, not to expand scope. If everything is covered, say so with the specific enumeration proving it.

**Implement first, verify after.** These instructions are a self-review checkpoint, NOT a reason to plan extensively or delay writing code. Do NOT enter plan mode, create task lists, or deliberate before implementing. Write the code, then use the nudge to verify completeness.

## Mode Behavior

| Level | Hook behavior | Your response depth |
|---|---|---|
| **lite** | Non-blocking suggestion | Quick enumeration, fix obvious gaps |
| **full** | Blocking — you must address it | Full requirement enumeration and verification |
| **ultra** | Blocking with aggressive thresholds | Thorough requirement-by-requirement walkthrough |

## Switching Modes

- `/gaslighter lite` — gentle, non-blocking nudges
- `/gaslighter full` — default, blocking nudges on complex responses
- `/gaslighter ultra` — aggressive, blocks on nearly every response
- `/gaslighter off` — disable nudges
- `stop gaslighter` or `normal mode` — disable nudges

## Compatibility

Gaslighter governs **completeness** — whether stated requirements were implemented. It does not conflict with style plugins (ponytail, caveman) which govern **how** code is written. Both can be active simultaneously.
