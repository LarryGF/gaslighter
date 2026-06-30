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
    "gaslighter": lambda: None,
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
    base = PLUGIN_CACHE / "gaslighter" / "gaslighter"
    versions = sorted(p for p in base.glob("*") if p.is_dir()) if base.exists() else []
    if not versions:
        # Fall back to the repo root itself
        if (ROOT / ".claude-plugin" / "plugin.json").exists():
            return str(ROOT)
        sys.exit(f"gaslighter plugin dir not found under {base}; set GASLIGHTER_PLUGIN_DIR")
    return str(versions[-1])


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


def selftest():
    failures = 0
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


def score_workspace(task_id, arm, model, workdir):
    meta = {}
    cj = workdir / "_claude.json"
    if cj.exists():
        try:
            j = json.loads(cj.read_text(encoding="utf-8"))
            u = j.get("usage") or {}
            meta = {
                "cost": j.get("total_cost_usd"),
                "duration_ms": j.get("duration_ms"),
                "turns": j.get("num_turns"),
                "out_tokens": u.get("output_tokens"),
                "in_tokens": u.get("input_tokens"),
            }
        except Exception:
            pass
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

    cmd = [claude, "--bare", "-p", task["prompt"], "--model", MODELS[model],
           "--permission-mode", "bypassPermissions", "--output-format", "json"]

    append = NO_RUN
    if arm == "gaslighter":
        cmd += ["--plugin-dir", _plugin_dir()]
    elif arm == "nudge-prompt":
        append = NUDGE_PROMPT + "\n\n" + NO_RUN
    cmd += ["--append-system-prompt", append]

    out_path = workdir / "_claude.json"
    err_path = workdir / "_claude.stderr.txt"
    try:
        with open(out_path, "wb") as so, open(err_path, "wb") as se:
            proc = subprocess.Popen(cmd, cwd=str(workdir), stdout=so, stderr=se)
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
        rows.append({
            "task": t, "arm": a, "model": m, "n": n,
            "correct_rate": round(sum(c.get("correct", 0) for c in cells) / n, 3),
            "complete_rate_mean": round(sum(c.get("complete_rate", 0) for c in cells) / n, 3),
            "total_loc_median": statistics.median(c.get("total_loc", 0) for c in cells),
            "cost_mean": round(statistics.mean(costs), 4) if costs else None,
            "turns_mean": round(statistics.mean([c["turns"] for c in cells if c.get("turns")]), 1)
                if any(c.get("turns") for c in cells) else None,
        })
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
    results = []
    for ws in sorted(p for p in run_dir.iterdir() if p.is_dir()):
        parts = ws.name.split("__")
        if len(parts) != 4 or parts[0] not in TASKS:
            continue
        tid, arm, model, _r = parts
        results.append(score_workspace(tid, arm, model, ws))
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

    cells = [(tid, arm, model, r)
             for tid in task_ids for model in models for arm in arms for r in range(runs)]
    total = len(cells)
    results, done = [], 0

    def _one(spec):
        tid, arm, model, r = spec
        ws = out_dir / f"{tid}__{arm}__{model}__{r}"
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
