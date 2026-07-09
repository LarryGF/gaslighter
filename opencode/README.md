# gaslighter for OpenCode

The OpenCode adapter for gaslighter. It shares the exact same decision engine as
the Claude Code plugin (`../hooks/lib/`); only the I/O is different.

| Concern | Claude Code | OpenCode |
| --- | --- | --- |
| Detect finish | `Stop` hook | `session.idle` event |
| Read last turn | JSONL transcript | `client.session.messages()` |
| Deliver nudge | `decision:"block"` / `additionalContext` | `client.session.prompt()` (+ toast) |
| Smart check | `claude -p` CLI | throwaway session at the configured model |

## Install

OpenCode loads local plugins from `~/.config/opencode/plugins/` (global) or
`.opencode/plugins/` (per project). The plugin imports the shared engine from
this repo, so it needs to know where the repo is.

**Recommended — symlink the plugin and point it at the repo:**

```sh
ln -s /abs/path/to/gaslighter/opencode/gaslighter.js \
      ~/.config/opencode/plugins/gaslighter.js
```

Then set `GASLIGHTER_ROOT` so the shared lib resolves regardless of the symlink
location (e.g. in your shell profile):

```sh
export GASLIGHTER_ROOT=/abs/path/to/gaslighter
```

If you instead copy the whole `opencode/` directory next to the repo (keeping
the relative path to `../hooks/lib/`), `GASLIGHTER_ROOT` is optional — the lib is
resolved relative to the plugin file.

## Configuration

Same knobs as the Claude plugin, resolved the same way
(`env var > config.json > mode default`):

- `GASLIGHTER_MODE` — `lite` (default) / `full` / `smart` / `off`
- `GASLIGHTER_MAX_NUDGES` — cap (`infinite` for none)
- `GASLIGHTER_NUDGE_ON_READONLY` — nudge even when nothing was edited
- `GASLIGHTER_DATA_DIR` — where state/config live (defaults to the XDG data dir)
- `GASLIGHTER_SMART_MODEL` — for `smart` mode, **must be `provider/model`** in
  OpenCode (e.g. `anthropic/claude-haiku-4-5`), since the SDK addresses models by
  provider + id. Without a `/`, smart mode falls back to a plain nudge.

`config.json` (in `GASLIGHTER_DATA_DIR`) accepts `mode`, `maxNudges`, `quiet`,
`nudgeOnReadOnly`, `smartModel`, `smartCmd`.

## Behavioral difference vs. Claude Code

OpenCode has no "soft, non-blocking" continuation equivalent to Claude's
`additionalContext` — once `session.idle` fires the turn is over. To make the
model actually re-verify, the adapter sends a real follow-up prompt in **every**
mode. So `lite` and `full` differ mainly by nudge cap and by whether a toast is
shown (`quiet` suppresses the toast). The anti-loop guards (cap, confidence
declaration, tool-free follow-up) work identically to the Claude adapter.

## Status

The shared decision core and the OpenCode parsing/wiring are unit- and
mock-tested (`tests/test-agnostic.js`). Full live end-to-end verification inside
a running OpenCode instance has not been performed — report issues if the SDK
shape differs in your version.
