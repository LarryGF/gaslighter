#!/usr/bin/env python3
"""Workspace collector for gaslighter eval judge.

Reads eval workspaces and outputs task prompts + source files for judging.
Judging is done by the Claude Code session model via the judge skill,
not by direct API calls.

  python judge.py --collect runs/<stamp>   # output workspace data as JSON
  python judge.py --summarize runs/<stamp> # summarize existing judge.json
  python judge.py --prep runs/<stamp>      # collect+annotate+group into judge_input/<task>.json
  python judge.py --merge runs/<stamp>     # merge judge_input/<task>.scores.json into judge.json
"""
import argparse
import json
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

from tasks_hard import TASKS

RUNS_DIR = Path(__file__).resolve().parent / "runs"


def _resolve(run_dir):
    run_dir = Path(run_dir)
    if not run_dir.exists():
        run_dir = RUNS_DIR / run_dir.name
    return run_dir


def _is_test(name):
    n = name.lower()
    return n.startswith("test_") or n.endswith("_test.py") or n == "conftest.py"


def source_text(workdir):
    out = []
    for p in sorted(workdir.rglob("*")):
        if not p.is_file() or "__pycache__" in p.parts or p.suffix == ".pyc":
            continue
        if p.name.startswith((".", "_")) or _is_test(p.name):
            continue
        try:
            out.append(f"# === {p.relative_to(workdir)} ===\n{p.read_text(encoding='utf-8', errors='ignore')}")
        except Exception:
            continue
    return "\n\n".join(out)


def collect(run_dir):
    """Collect workspace data for judging. Returns list of workspace dicts."""
    run_dir = _resolve(run_dir)
    ws_dir = run_dir / "workspaces"
    if not ws_dir.exists():
        ws_dir = Path(tempfile.gettempdir()) / "gaslighter-evals" / run_dir.name
    if not ws_dir.exists():
        ws_dir = run_dir  # oldest runs kept workspaces alongside results.json

    workspaces = []
    for ws in sorted(p for p in ws_dir.iterdir() if p.is_dir()):
        parts = ws.name.split("__")
        if len(parts) != 4 or parts[0] not in TASKS:
            continue
        tid, arm, model, _ = parts
        workspaces.append({
            "task": tid,
            "arm": arm,
            "model": model,
            "prompt": TASKS[tid]["prompt"],
            "source": source_text(ws),
            "workspace": str(ws),
        })

    return workspaces


def summarize(run_dir):
    """Summarize existing judge.json results."""
    run_dir = _resolve(run_dir)

    judge_file = run_dir / "judge.json"
    if not judge_file.exists():
        sys.exit(f"no judge.json in {run_dir}")

    data = json.loads(judge_file.read_text(encoding="utf-8"))
    scores = data.get("scores", [])

    print(f"\n=== completeness by arm (0=stub .. 3=fully implements) ===")
    by_arm = defaultdict(list)
    for r in scores:
        if isinstance(r.get("completeness"), int):
            by_arm[r["arm"]].append(r["completeness"])
    print(f"  {'arm':16} {'n':>4} {'mean':>6}")
    for arm in sorted(by_arm):
        v = by_arm[arm]
        print(f"  {arm:16} {len(v):>4} {sum(v)/len(v):>6.2f}")

    print(f"\n=== overcorrection by arm (0=minimal .. 3=over-built) ===")
    by_arm2 = defaultdict(list)
    for r in scores:
        if isinstance(r.get("overcorrection"), int):
            by_arm2[r["arm"]].append(r["overcorrection"])
    print(f"  {'arm':16} {'n':>4} {'mean':>6}")
    for arm in sorted(by_arm2):
        v = by_arm2[arm]
        print(f"  {arm:16} {len(v):>4} {sum(v)/len(v):>6.2f}")


def prep(run_dir):
    """collect() + annotate complete_rate + group by task + write judge_input/<task>.json.

    Returns manifest: {task: {"path": str, "count": int, "workspaces": [basename, ...]}}
    """
    run_dir = _resolve(run_dir)
    workspaces = collect(run_dir)
    data = json.loads((run_dir / "results.json").read_text(encoding="utf-8"))
    rate_by_key = {}
    for r in data.get("results", []):
        if "run" not in r:  # legitimately absent on old/rescored data — skip, don't crash
            continue
        key = f"{r['task']}__{r['arm']}__{r['model']}__{r['run']}"
        rate_by_key[key] = r.get("complete_rate")

    by_task = defaultdict(list)
    for ws in workspaces:
        key = Path(ws["workspace"]).name  # already task__arm__model__run
        ws["complete_rate"] = rate_by_key.get(key)
        by_task[ws["task"]].append(ws)

    input_dir = run_dir / "judge_input"
    input_dir.mkdir(exist_ok=True)
    manifest = {}
    for task, items in by_task.items():
        path = input_dir / f"{task}.json"
        path.write_text(json.dumps(items, indent=2), encoding="utf-8")
        manifest[task] = {
            "path": str(path), "count": len(items),
            "workspaces": [Path(i["workspace"]).name for i in items],
        }
    return manifest


def merge(run_dir):
    """Read judge_input/<task>.scores.json per task, match scores to expected
    workspaces BY NAME (not position), report missing/duplicate by name,
    merge into judge.json (idempotent per-task overwrite), call summarize().

    Exits 1 if any task has unresolved problems.
    """
    run_dir = _resolve(run_dir)
    input_dir = run_dir / "judge_input"
    if not input_dir.exists():
        sys.exit(f"no {input_dir} — run --prep first")

    problems = []
    new_scores = []
    for task_file in sorted(input_dir.glob("*.json")):
        if task_file.name.endswith(".scores.json"):
            continue
        task = task_file.stem
        expected_items = json.loads(task_file.read_text(encoding="utf-8"))
        expected = {Path(it["workspace"]).name for it in expected_items}

        scores_file = input_dir / f"{task}.scores.json"
        if not scores_file.exists():
            problems.append(f"{task}: missing {scores_file.name}")
            continue

        scores = json.loads(scores_file.read_text(encoding="utf-8")).get("scores", [])
        got = set()
        for s in scores:
            ws = s.get("workspace")
            if not ws:
                problems.append(f"{task}: score entry has no 'workspace' field: {s}")
                continue
            name = Path(ws).name  # tolerate agent copying full path OR basename verbatim
            if name in got:
                problems.append(f"{task}: duplicate score for workspace {name!r}")
                continue
            got.add(name)
            new_scores.append(s)

        missing = sorted(expected - got)
        if missing:
            problems.append(f"{task}: no score for workspace(s): {missing}")

    judge_path = run_dir / "judge.json"
    existing = (json.loads(judge_path.read_text(encoding="utf-8"))["scores"]
                if judge_path.exists() else [])
    by_name = {Path(s["workspace"]).name: s for s in existing if s.get("workspace")}
    for s in new_scores:
        by_name[Path(s["workspace"]).name] = s  # relaunch-and-remerge overwrites cleanly
    judge_path.write_text(json.dumps({"scores": list(by_name.values())}, indent=2),
                           encoding="utf-8")

    if problems:
        print("MERGE PROBLEMS:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)

    summarize(run_dir)
    if problems:
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collect", help="collect workspace data from run dir (outputs JSON)")
    ap.add_argument("--summarize", help="summarize existing judge.json")
    ap.add_argument("--prep", help="collect+annotate+group workspaces, write judge_input/<task>.json")
    ap.add_argument("--merge", help="merge judge_input/<task>.scores.json into judge.json")
    args = ap.parse_args()

    if args.collect:
        workspaces = collect(args.collect)
        print(json.dumps(workspaces, indent=2))
        return

    if args.summarize:
        return summarize(args.summarize)

    if args.prep:
        print(json.dumps(prep(args.prep), indent=2))
        return

    if args.merge:
        return merge(args.merge)

    sys.exit("give --collect, --summarize, --prep, or --merge <run_dir>")


if __name__ == "__main__":
    main()
