#!/usr/bin/env python3
"""Agentic benchmark for gaslighter.

Measures requirement completion rate: what fraction of explicitly stated
requirements were actually implemented, across three arms:
  - baseline: no plugin
  - gaslighter: plugin loaded via --plugin-dir
  - nudge-prompt: static system prompt with nudge text baked in

  python run.py --selftest          # validate scorers (no API)
  python run.py --all --runs 4      # live run (spends API)
  python run.py --rescore runs/<stamp>  # rescore from kept workspaces
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

from tasks_hard import TASKS

ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = Path(__file__).resolve().parent / "runs"

NUDGE_PROMPT = (
    "Before finishing any response that involves code changes, pause and verify:\n"
    "1. Re-read the original request\n"
    "2. List every stated requirement\n"
    "3. Check each requirement against what you implemented\n"
    "4. Fix any gaps — do NOT add unrequested features\n"
    "This is a self-review checkpoint for completeness."
)

ARMS = {
    "baseline": lambda: None,
    "gaslighter-off": lambda: None,
    "gaslighter-lite": lambda: None,
    "gaslighter-full": lambda: None,
    "gaslighter-smart": lambda: None,
    "nudge-prompt": lambda: NUDGE_PROMPT,
}

MODELS = {
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-4-6",
    "opus": "claude-opus-4-8",
}

PLUGIN_CACHE = Path.home() / ".claude" / "plugins" / "cache"
DEFAULT_CONFIG = Path(__file__).resolve().parent / "config.json"
CELL_TIMEOUT = 300

NO_RUN = (
    "Write the implementation. Do not run a dev server, install dependencies, "
    "or open a browser — just write the code and stop."
)

CODE_EXT = {".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".go", ".rs", ".java", ".rb", ".sh"}


def _plugin_dir():
    env = os.environ.get("GASLIGHTER_PLUGIN_DIR")
    if env:
        return env
    if (ROOT / ".claude-plugin" / "plugin.json").exists():
        return str(ROOT)
    base = PLUGIN_CACHE / "gaslighter" / "gaslighter"
    versions = sorted(p for p in base.glob("*") if p.is_dir()) if base.exists() else []
    if versions:
        return str(versions[-1])
    sys.exit("gaslighter plugin not found; run from the repo root or set GASLIGHTER_PLUGIN_DIR")


def _is_test(p, workdir):
    name = p.name.lower()
    rel = p.relative_to(workdir)
    return (name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py"
            or any(part.lower() in ("test", "tests") for part in rel.parts[:-1]))


def _count(p, with_comments):
    try:
        lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return 0
    n = 0
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        if not with_comments and s.startswith(("#", "//", "*", "/*", "*/")):
            continue
        n += 1
    return n


def code_stats(workdir):
    files = [p for p in workdir.rglob("*") if p.is_file() and p.suffix in CODE_EXT
             and "__pycache__" not in p.parts and not p.name.startswith((".", "_"))]
    src = [p for p in files if not _is_test(p, workdir)]
    tst = [p for p in files if _is_test(p, workdir)]
    return {
        "files": len(files),
        "src_files": len(src),
        "total_loc": sum(_count(p, True) for p in src),
        "src_loc": sum(_count(p, False) for p in src),
        "test_files": len(tst),
        "test_loc": sum(_count(p, True) for p in tst),
    }


def check_plugin():
    failures = 0
    hook = Path(_plugin_dir()) / "hooks" / "gaslighter-nudge.js"
    if not hook.exists():
        print(f"XX  hook script not found: {hook}")
        return 1
    data_dir = Path.home() / ".claude" / "plugins" / "data" / "gaslighter"
    # lite delivers a non-blocking nudge via additionalContext, full hard-blocks via
    # decision:block, both on stdout + exit 0 (stderr/exit-code protocol is broken, see docs)
    checks = {
        "lite": lambda out: '"additionalContext"' in out and '"decision"' not in out,
        "full": lambda out: '"decision":"block"' in out.replace(" ", ""),
        "off": lambda out: out.strip() == "",
    }
    for mode, check in checks.items():
        sid = f"selftest-plugin-{mode}"
        state_path = data_dir / f"state-{sid}.json"
        state_path.unlink(missing_ok=True)
        # no transcript_path in the payload here, so bypass Phase 1.1's edit-activity gate
        env = {**os.environ, "GASLIGHTER_MODE": mode, "CLAUDE_SESSION_ID": sid,
               "GASLIGHTER_NUDGE_ON_READONLY": "1"}
        r = subprocess.run(["node", str(hook)], input="{}", capture_output=True, text=True, env=env)
        ok = check(r.stdout) and r.returncode == 0
        print(f"{'ok ' if ok else 'XX '} hook mode={mode:<5} exit={r.returncode} stdout={r.stdout[:80]!r}")
        failures += 0 if ok else 1
        state_path.unlink(missing_ok=True)
    failures += _check_smart(hook, data_dir)
    return failures


def _check_smart(hook, data_dir):
    # smart mode reads the last turn's text, so it needs a transcript (unlike
    # the input="{}" modes above). A deliberately-missing GASLIGHTER_SMART_CMD
    # forces the fail-quiet fallback to a plain lite-style nudge — verifies the
    # protocol without spending an API call on the real Haiku check.
    sid = "selftest-plugin-smart"
    state_path = data_dir / f"state-{sid}.json"
    state_path.unlink(missing_ok=True)
    turn = [
        {"type": "user", "message": {"role": "user", "content": "Add a widget endpoint with validation."}},
        {"type": "assistant", "uuid": "u1", "message": {"role": "assistant", "content": [{"type": "tool_use", "name": "Edit", "input": {}}]}},
        {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "ok"}]}},
        {"type": "assistant", "uuid": "u2", "message": {"role": "assistant", "content": [{"type": "text", "text": "Added the endpoint."}]}},
    ]
    with tempfile.TemporaryDirectory() as d:
        tp = Path(d) / "transcript.jsonl"
        tp.write_text("\n".join(json.dumps(e) for e in turn) + "\n", encoding="utf-8")
        env = {**os.environ, "GASLIGHTER_MODE": "smart", "CLAUDE_SESSION_ID": sid,
               "GASLIGHTER_SMART_CMD": "/nonexistent/gaslighter-smart-selftest",
               "GASLIGHTER_FLUSH_WAIT_MS": "1000"}
        payload = json.dumps({"session_id": sid, "transcript_path": str(tp)})
        r = subprocess.run(["node", str(hook)], input=payload, capture_output=True, text=True, env=env)
    ok = '"additionalContext"' in r.stdout and '"decision"' not in r.stdout and r.returncode == 0
    print(f"{'ok ' if ok else 'XX '} hook mode=smart exit={r.returncode} stdout={r.stdout[:80]!r}")
    state_path.unlink(missing_ok=True)
    return 0 if ok else 1


def selftest():
    failures = 0
    failures += check_plugin()
    for tid, task in TASKS.items():
        axis = task.get("axis", "complete_rate")
        for kind in ("good", "bad"):
            with tempfile.TemporaryDirectory() as d:
                wd = Path(d)
                for fn, content in task.get("seed", {}).items():
                    fp = wd / fn
                    fp.parent.mkdir(parents=True, exist_ok=True)
                    fp.write_text(content, encoding="utf-8")

                # Handle both single-file and multi-file good/bad refs
                refs = task[kind] if isinstance(task[kind], dict) else {task["file"]: task[kind]}
                for fn, content in refs.items():
                    fp = wd / fn
                    fp.parent.mkdir(parents=True, exist_ok=True)
                    fp.write_text(content, encoding="utf-8")

                r = task["score"](wd)
            if kind == "good":
                ok = r.get("correct", 0) == 1 and r.get("complete_rate", 0) == 1.0
            else:
                ok = r.get("complete_rate", 1.0) < 1.0
            print(f"{'ok ' if ok else 'XX '} {tid:24} {kind:4} correct={r.get('correct')} "
                  f"complete_rate={r.get('complete_rate')} axis={axis}  {r.get('reason', '')}")
            failures += 0 if ok else 1
    print(f"\nselftest: {'all instruments valid' if not failures else str(failures) + ' BROKEN'}")
    return failures


def _check_hook_fired(arm, session_id):
    """Verify gaslighter hook actually fired. Returns (nudge_count, state_dict) or (0, None).

    Reads the hook's GASLIGHTER_DEBUG log rather than its state file. gaslighter-cleanup.js's
    SessionEnd hook unconditionally deletes state-{session_id}.json as soon as the session
    ends (correct behavior for a real interactive session), but a one-shot `claude -p` eval
    cell ends its session the instant the subprocess exits — before this check runs — so the
    state file is always already gone by the time we look. The debug log isn't touched by
    that cleanup and is the only record left. Confirmed via manual repro: the state file
    approach reported 0/90 gaslighter-lite/full/smart cells as fired in run 20260706-195854,
    even though the debug log showed hook_invoked+nudge_fired for every one of them.
    """
    if not arm.startswith("gaslighter-") or arm == "gaslighter-off":
        return 0, None
    if not session_id:
        return 0, None
    # lkb: shared, ever-appending log across all sessions on the machine — fine at today's
    # size (sub-MB), revisit with log rotation if it ever gets slow to scan.
    debug_log = Path(tempfile.gettempdir()) / "gaslighter-debug.jsonl"
    if not debug_log.exists():
        return 0, None
    nudge_count = 0
    try:
        with debug_log.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                if entry.get("session") == session_id and entry.get("event") == "nudge_fired":
                    nudge_count = max(nudge_count, entry.get("nudge_count", 0))
    except Exception:
        return 0, None
    return nudge_count, None


def score_workspace(task_id, arm, model, workdir):
    meta = {}
    cj = workdir / "_claude.json"
    session_id = None
    if cj.exists():
        try:
            j = json.loads(cj.read_text(encoding="utf-8"))
            u = j.get("usage") or {}
            session_id = j.get("session_id")
            meta = {
                "cost": j.get("total_cost_usd"),
                "duration_ms": j.get("duration_ms"),
                "turns": j.get("num_turns"),
                "out_tokens": u.get("output_tokens"),
                "in_tokens": u.get("input_tokens"),
                "session_id": session_id,
            }
        except Exception:
            pass
    nudge_count, _ = _check_hook_fired(arm, session_id)
    meta["hook_fired"] = nudge_count > 0
    meta["nudge_count"] = nudge_count
    if arm in ("gaslighter-lite", "gaslighter-full") and nudge_count == 0:
        print(f"  !! HOOK DID NOT FIRE: {task_id}/{arm}/{model} session={session_id}", flush=True)
    stats = code_stats(workdir)
    sc = TASKS[task_id]["score"](workdir)
    return {"task": task_id, "arm": arm, "model": model, **sc, **stats, **meta}


def run_cell(task_id, arm, model, workdir, timeout=CELL_TIMEOUT):
    task = TASKS[task_id]
    for fn, content in task.get("seed", {}).items():
        fp = workdir / fn
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(content, encoding="utf-8")

    claude = shutil.which("claude")
    if not claude:
        sys.exit("claude CLI not found on PATH")

    cmd = [claude, "-p", task["prompt"], "--model", MODELS[model],
           "--permission-mode", "bypassPermissions", "--output-format", "json"]

    append = NO_RUN
    env = os.environ.copy()
    env["GASLIGHTER_DEBUG"] = "1"
    if arm.startswith("gaslighter-"):
        cmd += ["--plugin-dir", _plugin_dir()]
        gaslighter_mode = arm.split("-", 1)[1]  # off, lite, full
        env["GASLIGHTER_MODE"] = gaslighter_mode
    elif arm == "nudge-prompt":
        append = NUDGE_PROMPT + "\n\n" + NO_RUN
    cmd += ["--append-system-prompt", append]

    out_path = workdir / "_claude.json"
    err_path = workdir / "_claude.stderr.txt"
    try:
        with open(out_path, "wb") as so, open(err_path, "wb") as se:
            proc = subprocess.Popen(cmd, cwd=str(workdir), stdout=so, stderr=se, env=env)
            try:
                proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=15)
                except Exception:
                    pass
                se.write(f"\n[KILLED after {timeout}s timeout]".encode())
    except Exception as e:
        out_path.write_text(json.dumps({"error": str(e)[:300]}), encoding="utf-8")

    # lkb: flush OS write buffers before scoring — 4 parallel workers + heavy I/O
    # caused stale reads where scorer saw seed files instead of CLI-written output
    os.sync()
    return score_workspace(task_id, arm, model, workdir)


def aggregate(results):
    groups = defaultdict(list)
    for r in results:
        groups[(r["task"], r["arm"], r["model"])].append(r)
    rows = []
    for (t, a, m), cells in sorted(groups.items()):
        n = len(cells)
        costs = [c["cost"] for c in cells if c.get("cost") is not None]
        hook_fired_count = sum(1 for c in cells if c.get("hook_fired"))
        nudge_counts = [c.get("nudge_count", 0) for c in cells]
        row = {
            "task": t, "arm": a, "model": m, "n": n,
            "correct_rate": round(sum(c.get("correct", 0) for c in cells) / n, 3),
            "complete_rate_mean": round(sum(c.get("complete_rate", 0) for c in cells) / n, 3),
            "total_loc_median": statistics.median(c.get("total_loc", 0) for c in cells),
            "cost_mean": round(statistics.mean(costs), 4) if costs else None,
            "turns_mean": round(statistics.mean([c["turns"] for c in cells if c.get("turns")]), 1)
                if any(c.get("turns") for c in cells) else None,
        }
        if a.startswith("gaslighter-") and a != "gaslighter-off":
            row["hook_fired_rate"] = round(hook_fired_count / n, 3)
            row["nudge_mean"] = round(statistics.mean(nudge_counts), 2)
        rows.append(row)
    return rows


def print_table(rows):
    by_model = defaultdict(list)
    for r in rows:
        by_model[r["model"]].append(r)
    for model, mrs in sorted(by_model.items()):
        n = mrs[0]["n"]
        print(f"\n## {model} (n={n})\n")
        print("| Task | Arm | Correct | Complete | LOC | Turns | $/run |")
        print("|------|-----|---------|----------|-----|-------|-------|")
        by_task = defaultdict(list)
        for r in mrs:
            by_task[r["task"]].append(r)
        for task in sorted(by_task):
            for r in sorted(by_task[task], key=lambda x: x["arm"]):
                c = f"${r['cost_mean']:.4f}" if r["cost_mean"] is not None else "-"
                t = r.get("turns_mean")
                t_s = f"{t:.1f}" if t is not None else "-"
                print(f"| {task} | {r['arm']} | {r['correct_rate']} | "
                      f"{r['complete_rate_mean']} | {r['total_loc_median']:.0f} | {t_s} | {c} |")


def rescore(run_dir):
    run_dir = Path(run_dir)
    if not run_dir.exists():
        run_dir = RUNS_DIR / run_dir.name
    ws_dir = Path(tempfile.gettempdir()) / "gaslighter-evals" / run_dir.name
    if not ws_dir.exists():
        ws_dir = run_dir  # older runs kept workspaces alongside results.json
    results = []
    for ws in sorted(p for p in ws_dir.iterdir() if p.is_dir()):
        parts = ws.name.split("__")
        if len(parts) != 4 or parts[0] not in TASKS:
            continue
        tid, arm, model, r = parts
        res = score_workspace(tid, arm, model, ws)
        res["run"] = int(r)
        results.append(res)
    rows = aggregate(results)
    (run_dir / "results.json").write_text(
        json.dumps({"rescored": True, "results": results}, indent=2), encoding="utf-8")
    (run_dir / "summary.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print_table(rows)
    print(f"\nrescored {len(results)} cells from {run_dir}")


def load_config(config_path):
    try:
        with open(config_path, encoding="utf-8") as f:
            return json.load(f).get("defaults", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def main():
    cfg = load_config(DEFAULT_CONFIG)

    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--rescore", help="rescore from a kept run dir")
    ap.add_argument("--config", help="config JSON file (default: evals/config.json)")
    ap.add_argument("--task", help="single task id (comma list ok, globs ok)")
    ap.add_argument("--exclude-task", help="exclude task ids (comma list ok, globs ok)")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--pilot", action="store_true", help="first 5 tasks only")
    ap.add_argument("--arms", default=None)
    ap.add_argument("--model", help="single model shorthand")
    ap.add_argument("--models", default=None)
    ap.add_argument("--runs", type=int, default=None)
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--timeout", type=int, default=None)
    args = ap.parse_args()

    if args.config:
        cfg = load_config(args.config)

    if args.selftest:
        sys.exit(1 if selftest() else 0)
    if args.rescore:
        return rescore(args.rescore)
    if selftest():
        sys.exit("instruments broken; refusing to spend on the API")

    import fnmatch

    pilot_ids = list(TASKS)[:5]
    task_ids = (list(TASKS) if args.all
                else pilot_ids if args.pilot
                else ([t.strip() for t in args.task.split(",")] if args.task else []))
    if not task_ids:
        sys.exit("give --task <id>, --pilot, --all, or --rescore <dir>")

    exclude = args.exclude_task
    if exclude:
        pats = [p.strip() for p in exclude.split(",")]
        task_ids = [t for t in task_ids if not any(fnmatch.fnmatch(t, p) for p in pats)]

    arms_str = args.arms or ",".join(cfg.get("arms", list(ARMS)))
    arms = [a.strip() for a in arms_str.split(",")]
    models_str = args.model or args.models or ",".join(cfg.get("models", ["haiku"]))
    models = [m.strip() for m in models_str.split(",")]
    runs = args.runs if args.runs is not None else cfg.get("runs", 1)
    workers = args.workers if args.workers is not None else cfg.get("workers", 4)
    timeout = args.timeout if args.timeout is not None else cfg.get("timeout", CELL_TIMEOUT)

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = RUNS_DIR / stamp
    out_dir.mkdir(parents=True, exist_ok=True)
    workspace_root = Path(tempfile.gettempdir()) / "gaslighter-evals" / stamp
    workspace_root.mkdir(parents=True, exist_ok=True)

    cells = [(tid, arm, model, r)
             for tid in task_ids for model in models for arm in arms for r in range(runs)]
    total = len(cells)
    results, done = [], 0

    def _one(spec):
        tid, arm, model, r = spec
        ws = workspace_root / f"{tid}__{arm}__{model}__{r}"
        ws.mkdir(parents=True, exist_ok=True)
        return run_cell(tid, arm, model, ws, timeout=timeout)

    print(f"running {total} cells, {workers} at a time", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_one, s): s for s in cells}
        for fut in concurrent.futures.as_completed(futs):
            tid, arm, model, r = futs[fut]
            try:
                res = fut.result()
            except Exception as e:
                res = {"task": tid, "arm": arm, "model": model, "error": str(e)[:200]}
            res["run"] = r
            results.append(res)
            done += 1
            print(f"  [{done}/{total}] {tid} / {arm} / {model} #{r}  "
                  f"complete_rate={res.get('complete_rate')} "
                  f"cost=${res.get('cost')} "
                  f"correct={res.get('correct')}", flush=True)
            (out_dir / "results.json").write_text(json.dumps(
                {"date": stamp, "models": {m: MODELS[m] for m in models},
                 "results": results}, indent=2), encoding="utf-8")

    rows = aggregate(results)
    (out_dir / "summary.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print_table(rows)
    print(f"\nwrote {out_dir}/results.json + summary.json ({len(results)} cells)")


if __name__ == "__main__":
    main()
