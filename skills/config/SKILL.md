---
name: config
description: "Configure gaslighter's mode and nudge cap, persisted to config.json"
when_to_use: "Use when user says 'config', 'configure', 'setup gaslighter', or invokes /gaslighter:config directly."
model: haiku
allowed-tools:
  - Bash
  - AskUserQuestion()
---

# Gaslighter Config

Reads and writes the persisted `${CLAUDE_PLUGIN_DATA}/config.json` (mode + nudge cap) via `hooks/gaslighter-config-cli.js`.

## Step 1: Read current config

Run:

```
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/hooks/gaslighter-config-cli.js" --get
```

## Step 2: Branch on result

**If the output is `{}` (no config yet)** — ask for a mode:

```
AskUserQuestion({
  questions: [{
    question: "Which gaslighter mode do you want to persist?",
    header: "Mode",
    multiSelect: false,
    options: [
      { label: "lite (default)", description: "Hook on, soft nudge, up to 3 per session" },
      { label: "full", description: "Hook on, hard block, unlimited nudges" },
      { label: "smart", description: "Hook on, asks a cheap model whether anything was actually missed before nudging; up to 2 per session, ~2-5s + one Haiku call per gated stop" },
      { label: "off", description: "Hook disabled, 0 nudges" }
    ]
  }]
})
```

If the chosen mode is not `off`, ask a follow-up about the nudge cap:

```
AskUserQuestion({
  questions: [{
    question: "Use the default nudge cap for this mode, or set a custom one?",
    header: "Nudge cap",
    multiSelect: false,
    options: [
      { label: "Use default", description: "lite=3, full=unlimited, smart=2" }
    ]
  }]
})
```

The user can select "Other" to type a custom number (or "infinite"/"unlimited"). If they chose "Use default", omit `maxNudges` from the config entirely (mode default applies).

If mode is not `off`, also ask about the two delivery options (skip both if the user just
wants defaults — `quiet` defaults to `true` for lite / `false` for full, `nudgeOnReadOnly`
defaults to `false`):

```
AskUserQuestion({
  questions: [{
    question: "Should the nudge be hidden from the transcript (quiet) or shown to the user?",
    header: "Quiet",
    multiSelect: false,
    options: [
      { label: "Use default", description: "quiet for lite, visible for full" },
      { label: "Quiet", description: "suppressOutput: true — model still sees it, user doesn't" },
      { label: "Visible", description: "user sees the nudge in the transcript" }
    ]
  }, {
    question: "Nudge on read-only (no file-edit) turns too, or only after file changes?",
    header: "Read-only",
    multiSelect: false,
    options: [
      { label: "Only after edits (default)", description: "skip the first nudge on pure Q&A turns" },
      { label: "Always nudge", description: "nudgeOnReadOnly: true — nudge even with no Edit/Write/Bash activity" }
    ]
  }]
})
```

Omit `quiet`/`nudgeOnReadOnly` from the persisted config when the user picks the default option for each.

**If the output already has a `mode`** — show the current `mode`/`maxNudges`/`quiet`/`nudgeOnReadOnly` and ask:

```
AskUserQuestion({
  questions: [{
    question: "Current mode is {mode} (nudge cap: {maxNudges or 'default'}, quiet: {quiet or 'default'}, nudgeOnReadOnly: {nudgeOnReadOnly or 'default'}). Keep it or change it?",
    header: "Config",
    multiSelect: false,
    options: [
      { label: "Keep", description: "Leave the persisted config as-is" },
      { label: "Change", description: "Pick a new mode and/or nudge cap" }
    ]
  }]
})
```

If "Change", repeat Step 2's "no config yet" flow to collect a new mode/cap.

## Step 3: Persist

Run:

```
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/hooks/gaslighter-config-cli.js" --set '{"mode":"<mode>","maxNudges":<n or omitted>,"quiet":<bool or omitted>,"nudgeOnReadOnly":<bool or omitted>}'
```

Confirm what was saved by printing the `--set` output, and note that the `GASLIGHTER_MODE` and `GASLIGHTER_MAX_NUDGES` env vars override this persisted config when set (useful for CI or one-off runs).
