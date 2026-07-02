#!/usr/bin/env python3
"""Quick analysis scripts for eval results."""
import json
import sys
from pathlib import Path

def summary_stats(run_dir):
    """Extract summary statistics by arm/model."""
    summary_path = Path(run_dir) / "summary.json"
    if not summary_path.exists():
        print(f"No summary.json in {run_dir}")
        return

    data = json.loads(summary_path.read_text())

    for stats in sorted(data, key=lambda x: (x['task'], x['model'], x['arm'])):
        task_id = stats['task']
        arm = stats['arm']
        model = stats['model']
        print(f"\n{task_id:30} {arm:15} {model:8}")
        print(f"  complete_rate: {stats.get('complete_rate_mean', 0):.2f}")
        print(f"  correct_rate:  {stats.get('correct_rate', 0):.2f}")
        print(f"  turns:         {stats.get('turns_mean', 0):.1f}")
        print(f"  cost:          ${stats.get('cost_mean', 0):.3f}")

def find_failures(run_dir, threshold=0.9):
    """Find cells where a gaslighter-* arm scored below threshold completion."""
    results_path = Path(run_dir) / "results.json"
    if not results_path.exists():
        print(f"No results.json in {run_dir}")
        return

    data = json.loads(results_path.read_text())
    failures = [
        r for r in data["results"]
        if r.get("arm", "").startswith("gaslighter") and r.get("complete_rate", 0) < threshold
    ]

    if not failures:
        print(f"No gaslighter-* failures below {threshold}")
        return

    print(f"\n{'Task':30} {'Model':8} {'Complete':8} {'Correct':8}")
    print("-" * 60)
    for f in sorted(failures, key=lambda x: x.get("complete_rate", 0)):
        task = f.get("task", "?")
        model = f.get("model", "?")
        comp = f.get("complete_rate", 0)
        corr = f.get("correct", 0)
        print(f"{task:30} {model:8} {comp:8.2f} {corr:8}")

def compare_arms(run_dir, task_id, model, arm_a="baseline", arm_b="gaslighter-lite"):
    """Compare two arms (default baseline vs gaslighter-lite) for a specific task/model."""
    results_path = Path(run_dir) / "results.json"
    if not results_path.exists():
        print(f"No results.json in {run_dir}")
        return

    data = json.loads(results_path.read_text())
    a = [r for r in data["results"]
         if r.get("task") == task_id and r.get("model") == model and r.get("arm") == arm_a]
    b = [r for r in data["results"]
         if r.get("task") == task_id and r.get("model") == model and r.get("arm") == arm_b]

    print(f"\n{task_id} ({model})")
    print(f"  {arm_a}:    {len(a)} runs, avg complete={sum(r.get('complete_rate',0) for r in a)/len(a):.2f}")
    print(f"  {arm_b}:  {len(b)} runs, avg complete={sum(r.get('complete_rate',0) for r in b)/len(b):.2f}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage:")
        print("  python analyze.py summary <run_dir>")
        print("  python analyze.py failures <run_dir> [threshold]")
        print("  python analyze.py compare <run_dir> <task_id> <model> [arm_a] [arm_b]")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "summary":
        summary_stats(sys.argv[2])
    elif cmd == "failures":
        threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.9
        find_failures(sys.argv[2], threshold)
    elif cmd == "compare":
        extra = sys.argv[5:7]
        compare_arms(sys.argv[2], sys.argv[3], sys.argv[4], *extra)
    else:
        print(f"Unknown command: {cmd}")
