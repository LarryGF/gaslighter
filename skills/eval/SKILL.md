---
name: eval
description: "Run gaslighter's eval suite to measure requirement completion across baseline and nudge arms."
---

# Gaslighter Eval

Resolve `<plugin-root>` from this loaded skill's location. Run every command below from `<plugin-root>`; do not assume the caller's cwd is the gaslighter checkout.

```sh
cd "<plugin-root>/evals" && python3 run.py <arguments>
```

## Execution

1. Parse user arguments; use `config.json` defaults when absent.
2. For `--selftest`, run in the foreground.
3. Otherwise launch the command through the host's background-task or supervised-process facility; report its task identifier and configuration.
4. On completion, run:

   ```sh
cd "<plugin-root>/evals" && python3 analyze.py summary runs/<timestamp>
   ```

5. Then load the `judge` skill for `runs/<timestamp>` automatically. Do not tell the user to do that manually.

Use the host's shell, task, and skill mechanisms; do not assume Claude-specific tool names.

## Arms

- `baseline` — no plugin.
- `gaslighter-off` — plugin loaded but disabled.
- `gaslighter-lite` — soft nudge.
- `gaslighter-full` — hard block.
- `nudge-prompt` — static prompt-only control.

## Flags

- `--selftest` — validate scorers without API spend.
- `--all` — run all tasks.
- `--task TASK` / `--exclude-task TASK` — select tasks.
- `--models MODELS` — `haiku`, `sonnet`, `opus`.
- `--runs N`, `--workers N`, `--timeout N`.
- `--config PATH`.
- `--plugin-dir PATH`.

Results are written under `evals/runs/<timestamp>/`: `results.json`, `summary.json`, and preserved workspaces.
