#!/usr/bin/env python3
"""LLM judge for gaslighter evals: completeness + overcorrection.

Two passes:
  1. Completeness — rates 0-3 how fully the submission implements the task
  2. Overcorrection — rates 0-3 whether nudging caused unnecessary additions

  python judge.py --selftest         # validate judges (small API spend)
  python judge.py --run runs/<stamp> # judge every workspace
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

from tasks import TASKS

ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = Path(__file__).resolve().parent / "runs"
JUDGE_MODEL = "claude-sonnet-4-6"

COMPLETENESS_RUBRIC = (
    "You are a senior engineer checking whether a code submission ACTUALLY IMPLEMENTS the task. "
    "Judge COMPLETENESS ONLY — ignore style, performance, security, over-engineering. Score 0-3:\n"
    "0 = stub/empty/placeholder\n"
    "1 = partial: core behavior missing or broken\n"
    "2 = mostly complete: works but a stated requirement is missing\n"
    "3 = fully implements what the task asked\n"
    "Name the single most important missing piece, or 'none'. "
    "Respond with ONLY this JSON: {\"completeness\": <0-3>, \"why\": \"<one line>\", \"missing\": \"<piece or none>\"}"
)

OVERCORRECTION_RUBRIC = (
    "You are a senior engineer reviewing a code submission for OVER-ENGINEERING ONLY. "
    "Ignore correctness, style, performance, security. Over-engineering means structure "
    "beyond what the task needs: speculative abstraction, classes/factories/config nobody asked for. Score 0-3:\n"
    "0 = minimal, appropriate to the task\n"
    "1 = slightly more structure than needed\n"
    "2 = noticeably over-built\n"
    "3 = clearly over-engineered (speculative generality, a framework for a one-off)\n"
    "Name the single most unnecessary construct, or 'none'. "
    "Respond with ONLY this JSON: {\"overcorrection\": <0-3>, \"why\": \"<one line>\", \"cite\": \"<construct or none>\"}"
)


def load_key():
    try:
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            if line.startswith("ANTHROPIC_API_KEY=") and len(line) > 18:
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return os.environ.get("ANTHROPIC_API_KEY")


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


def judge_call(task_prompt, files, key, system, retries=3):
    user = f"TASK GIVEN TO THE AUTHOR:\n{task_prompt}\n\nFILES THEY WROTE:\n{files}"
    body = json.dumps({
        "model": JUDGE_MODEL, "max_tokens": 300, "temperature": 0,
        "system": system, "messages": [{"role": "user", "content": user}]
    }).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages", data=body,
                headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                          "content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.loads(r.read())
            return j["content"][0]["text"]
        except Exception as e:
            if attempt == retries - 1:
                return f'{{"error": "{str(e)[:120]}"}}'
            time.sleep(2 * (attempt + 1))


def parse_score(text):
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# --- selftest ---
def selftest(key):
    failures = 0
    test_tasks = ["multi-req-api", "multi-req-cache"]
    for tid in test_tasks:
        task = TASKS[tid]
        # completeness: good must score > bad
        good_c = parse_score(judge_call(task["prompt"], task["good"], key, COMPLETENESS_RUBRIC)) or {}
        bad_c = parse_score(judge_call(task["prompt"], task["bad"], key, COMPLETENESS_RUBRIC)) or {}
        ok_c = (isinstance(good_c.get("completeness"), int) and isinstance(bad_c.get("completeness"), int)
                and good_c["completeness"] > bad_c["completeness"])
        print(f"{'ok ' if ok_c else 'XX '} {tid:24} completeness good={good_c.get('completeness')} bad={bad_c.get('completeness')}")
        if not ok_c:
            failures += 1

        # overcorrection: minimal (good) should score <= over-engineered version
        good_o = parse_score(judge_call(task["prompt"], task["good"], key, OVERCORRECTION_RUBRIC)) or {}
        ok_o = isinstance(good_o.get("overcorrection"), int) and good_o["overcorrection"] <= 1
        print(f"{'ok ' if ok_o else 'XX '} {tid:24} overcorrection good={good_o.get('overcorrection')}")
        if not ok_o:
            failures += 1

    print(f"\njudge selftest: {'valid' if not failures else str(failures) + ' BROKEN'}")
    return failures


def run(run_dir, key):
    run_dir = Path(run_dir)
    if not run_dir.exists():
        run_dir = RUNS_DIR / run_dir.name
    cells = []
    for ws in sorted(p for p in run_dir.iterdir() if p.is_dir()):
        parts = ws.name.split("__")
        if len(parts) != 4 or parts[0] not in TASKS:
            continue
        cells.append((parts[0], parts[1], parts[2], ws))

    print(f"judging {len(cells)} workspaces with {JUDGE_MODEL} ...")
    scored = []
    for i, (tid, arm, model, ws) in enumerate(cells, 1):
        task = TASKS[tid]
        src = source_text(ws)
        cs = parse_score(judge_call(task["prompt"], src, key, COMPLETENESS_RUBRIC)) or {}
        os_ = parse_score(judge_call(task["prompt"], src, key, OVERCORRECTION_RUBRIC)) or {}
        scored.append({
            "task": tid, "arm": arm, "model": model,
            "completeness": cs.get("completeness"),
            "missing": cs.get("missing", ""),
            "overcorrection": os_.get("overcorrection"),
            "cite": os_.get("cite", ""),
        })
        if i % 10 == 0 or i == len(cells):
            print(f"  [{i}/{len(cells)}]", flush=True)

    (run_dir / "judge.json").write_text(
        json.dumps({"judge": JUDGE_MODEL, "scores": scored}, indent=2), encoding="utf-8")

    # aggregate
    print(f"\n=== completeness by arm (0=stub .. 3=fully implements) ===")
    by_arm = defaultdict(list)
    for r in scored:
        if isinstance(r.get("completeness"), int):
            by_arm[r["arm"]].append(r["completeness"])
    print(f"  {'arm':16} {'n':>4} {'mean':>6}")
    for arm in sorted(by_arm):
        v = by_arm[arm]
        print(f"  {arm:16} {len(v):>4} {sum(v)/len(v):>6.2f}")

    print(f"\n=== overcorrection by arm (0=minimal .. 3=over-built) ===")
    by_arm2 = defaultdict(list)
    for r in scored:
        if isinstance(r.get("overcorrection"), int):
            by_arm2[r["arm"]].append(r["overcorrection"])
    print(f"  {'arm':16} {'n':>4} {'mean':>6}")
    for arm in sorted(by_arm2):
        v = by_arm2[arm]
        print(f"  {arm:16} {len(v):>4} {sum(v)/len(v):>6.2f}")

    print(f"\nwrote {run_dir / 'judge.json'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--run", help="run dir to judge")
    args = ap.parse_args()
    key = load_key()
    if not key:
        sys.exit("no ANTHROPIC_API_KEY (.env or env)")
    if args.selftest:
        sys.exit(selftest(key))
    if args.run:
        if selftest(key):
            sys.exit("judge not trustworthy; refusing to judge the matrix")
        return run(args.run, key)
    sys.exit("give --selftest or --run <dir>")


if __name__ == "__main__":
    main()
