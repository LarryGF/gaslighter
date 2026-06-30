#!/usr/bin/env python3
"""Workspace collector for gaslighter eval judge.

Reads eval workspaces and outputs task prompts + source files for judging.
Judging is done by the Claude Code session model via the judge skill,
not by direct API calls.

  python judge.py --collect runs/<stamp>   # output workspace data as JSON
  python judge.py --summarize runs/<stamp> # summarize existing judge.json
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from tasks_hard import TASKS

RUNS_DIR = Path(__file__).resolve().parent / "runs"


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
    run_dir = Path(run_dir)
    if not run_dir.exists():
        run_dir = RUNS_DIR / run_dir.name

    workspaces = []
    for ws in sorted(p for p in run_dir.iterdir() if p.is_dir()):
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
    run_dir = Path(run_dir)
    if not run_dir.exists():
        run_dir = RUNS_DIR / run_dir.name

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--collect", help="collect workspace data from run dir (outputs JSON)")
    ap.add_argument("--summarize", help="summarize existing judge.json")
    args = ap.parse_args()

    if args.collect:
        workspaces = collect(args.collect)
        print(json.dumps(workspaces, indent=2))
        return

    if args.summarize:
        return summarize(args.summarize)

    sys.exit("give --collect <run_dir> or --summarize <run_dir>")


if __name__ == "__main__":
    main()
