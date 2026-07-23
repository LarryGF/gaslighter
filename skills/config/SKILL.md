---
name: config
description: "Configure gaslighter's mode and nudge cap in persisted config.json."
---

# Gaslighter Config

Read and write gaslighter's persisted `config.json` through `hooks/gaslighter-config-cli.js`.

## Read

Resolve the plugin root from the current skill location. Run:

```sh
node "<plugin-root>/hooks/gaslighter-config-cli.js" --get
```

## Choose settings

If no config exists (`{}` or no `mode`), use the host's interactive question tool to collect:

1. **Mode** — `lite` (default), `full`, `smart`, or `off`.
2. **Nudge cap**, unless mode is `off` — default (`lite=3`, `full=unlimited`, `smart=2`) or a custom positive integer / unlimited value.
3. **Delivery**, unless mode is `off` — default, quiet, or visible.
4. **Read-only turns**, unless mode is `off` — only after edits (default) or always nudge.

If a config exists, show its effective `mode`, `maxNudges`, `quiet`, and `nudgeOnReadOnly`; ask whether to keep it or replace it. Do not ask follow-ups when the user keeps it.

Omit `maxNudges`, `quiet`, and `nudgeOnReadOnly` when the user selected their defaults.

## Persist

Run:

```sh
node "<plugin-root>/hooks/gaslighter-config-cli.js" --set '<json config>'
```

Show the command result. Explain that `GASLIGHTER_MODE`, `GASLIGHTER_MAX_NUDGES`, `GASLIGHTER_QUIET`, and `GASLIGHTER_NUDGE_ON_READONLY` override persisted settings for a session.
