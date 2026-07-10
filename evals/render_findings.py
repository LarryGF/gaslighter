#!/usr/bin/env python3
"""Splice results.json + judge.json into the sentinel-marked regions of the
three findings docs, appending new appendix rows without rewriting old ones.

  python render_findings.py --check              # verify sentinel markers exist
  python render_findings.py runs/<stamp>          # merge + write the 3 docs + chart SVGs
  python render_findings.py runs/<stamp> --dry-run  # compute + print, write nothing
  python render_findings.py --chart               # regenerate chart SVGs from the current appendix
"""
import argparse
import functools
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

from judge import _resolve

ROOT = Path(__file__).resolve().parents[1]
FINDINGS = ROOT / "docs" / "eval-findings.md"
README = ROOT / "README.md"
EVALS_README = ROOT / "evals" / "README.md"

APPENDIX_COLUMNS = ["task", "arm", "model", "run_stamp", "run", "correct",
                    "auto_complete", "judge_completeness", "judge_overcorrection",
                    "turns", "cost", "missing", "cite", "hook_sha"]

ARM_ORDER = ["baseline", "gaslighter-off", "gaslighter-lite", "gaslighter-full", "nudge-prompt"]

BLOCK_MARKERS = {
    FINDINGS: ["INTRO", "SAMPLE_SIZE", "MISSING_METRICS", "VERSION_HISTORY", "HEADLINE_TABLE", "PERTASK_TABLE"],
    README: ["RESULTS_TABLE", "RESULTS_PROSE"],
    EVALS_README: ["RESULTS_INTRO", "RESULTS_TABLE", "RESULTS_PROSE"],
}
APPEND_MARKERS = {
    FINDINGS: ["APPENDIX"],
}

ASSETS = ROOT / "assets"

# One accent for the featured arm, neutral gray for context bars. Identity is
# carried by the direct arm labels, so the gray is de-emphasis, not a series color.
CHART_THEMES = {
    "light": {"accent": "#2a78d6", "neutral": "#898781",
              "ink": "#0b0b0b", "ink2": "#52514e", "axis": "#c3c2b7"},
    "dark": {"accent": "#3987e5", "neutral": "#898781",
             "ink": "#ffffff", "ink2": "#c3c2b7", "axis": "#383835"},
}
CHART_FEATURED_ARM = "gaslighter-full"

# Each spec drives one metric's light+dark SVG pair. `field` reads a mean from
# the already-aggregated headline row (aggregate() computes all of these);
# `value` rescales it into the chart's plotted unit.
CHART_SPECS = [
    {"key": "benchmark", "title": "Missed requirements per 100 tasks",
     "subtitle": "headless Claude Code sessions, deterministic scoring &#183; lower is better",
     "field": "correct", "value": lambda v: (1 - v) * 100},
    {"key": "benchmark-completeness", "title": "Missed requirements (judged) per 100 tasks",
     "subtitle": "LLM-judged completeness (0-3 scale) rescaled to missed points per 100 tasks &#183; lower is better",
     "field": "judge_completeness", "value": lambda v: (3 - v) / 3 * 100},
    {"key": "benchmark-turns", "title": "Turns per task (mean)",
     "subtitle": "mean turns per arm &#183; cost/overhead, not a quality signal",
     "field": "turns", "value": lambda v: v},
    {"key": "benchmark-overcorrection", "title": "Overcorrection per 100 tasks",
     "subtitle": "LLM-judged overcorrection (0-3 scale) rescaled per 100 tasks &#183; lower is better",
     "field": "judge_overcorrection", "value": lambda v: (v / 3) * 100},
]


def _git_sha():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
                               text=True, check=True).stdout.strip()
    except Exception:
        return None


def _version_tags_containing(sha):
    try:
        out = subprocess.run(["git", "tag", "--contains", sha], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout
    except Exception:
        return []
    return [t.strip() for t in out.splitlines() if t.strip()]


def _semver_tuple(tag):
    return tuple(int(p) for p in tag.lstrip("v").split("."))


@functools.lru_cache(maxsize=None)
def version_bucket(sha):
    """Dynamically resolved at render time from current git tags — a sha never
    changes, but its bucket moves from 'unreleased' to 'vX.Y.Z' the next time
    this runs after that tag exists locally."""
    if not sha or sha == "unknown":
        return "pre-instrumentation"
    tags = _version_tags_containing(sha)
    if not tags:
        return "unreleased"
    return min(tags, key=_semver_tuple)


def _version_sort_key(v):
    if v == "pre-instrumentation":
        return (0, ())
    if v == "unreleased":
        return (2, ())
    return (1, _semver_tuple(v))


class RenderError(Exception):
    pass


def _num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s in ("", "N/A", "n/a", "none", "None"):
        return None
    if s.startswith("$"):
        s = s[1:]
    try:
        return float(s)
    except ValueError:
        return None


def _fmt1(v):
    return f"{v:.1f}" if v is not None else "N/A"


def _fmt_cost(v):
    return f"${v:.4f}" if v is not None else "N/A"


def _arm_key(arm):
    return ARM_ORDER.index(arm) if arm in ARM_ORDER else len(ARM_ORDER)


def _join_names(names):
    names = [f"`{n}`" for n in names]
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return " and ".join(names)
    return ", ".join(names[:-1]) + f", and {names[-1]}"


def load_run(run_dir):
    """-> (results_rows: list[dict], judge_scores: list[dict])"""
    results_path = run_dir / "results.json"
    judge_path = run_dir / "judge.json"
    if not results_path.exists() or not judge_path.exists():
        sys.exit(f"missing results.json/judge.json in {run_dir}: run judge --merge first")
    results_rows = json.loads(results_path.read_text(encoding="utf-8")).get("results", [])
    judge_scores = json.loads(judge_path.read_text(encoding="utf-8")).get("scores", [])
    return results_rows, judge_scores


def join_run_rows(run_stamp, results_rows, judge_scores):
    """Join on (task, arm, model, run) derived from each judge score's
    `workspace` basename. Rows with no matching judge score still get
    emitted with judge_completeness/judge_overcorrection/missing/cite = "N/A"
    (never silently dropped) — collects join warnings, doesn't crash.
    -> (rows: list[dict], warnings: list[str])"""
    judge_by_key = {}
    for s in judge_scores:
        ws = s.get("workspace")
        if not ws:
            continue
        judge_by_key[Path(ws).name] = s

    rows, warnings, seen_keys = [], [], set()
    for r in results_rows:
        if "run" not in r:
            continue
        key = f"{r['task']}__{r['arm']}__{r['model']}__{r['run']}"
        seen_keys.add(key)
        js = judge_by_key.get(key)
        if js is None:
            warnings.append(f"{run_stamp}: no judge score for {key}")
        turns, cost, complete_rate = r.get("turns"), r.get("cost"), r.get("complete_rate")
        rows.append({
            "task": r["task"], "arm": r["arm"], "model": r["model"],
            "run_stamp": run_stamp, "run": str(r["run"]),
            "correct": str(r.get("correct", "N/A")),
            "auto_complete": f"{complete_rate:.2f}" if complete_rate is not None else "N/A",
            "judge_completeness": str(js["completeness"]) if js and js.get("completeness") is not None else "N/A",
            "judge_overcorrection": str(js["overcorrection"]) if js and js.get("overcorrection") is not None else "N/A",
            "turns": str(turns) if turns is not None else "N/A",
            "cost": _fmt_cost(cost) if cost is not None else "N/A",
            "missing": (js.get("missing") or "N/A") if js else "N/A",
            "cite": (js.get("cite") or "N/A") if js else "N/A",
            "hook_sha": r.get("hook_sha") or "unknown",
        })

    for name in judge_by_key:
        if name not in seen_keys:
            warnings.append(f"{run_stamp}: judge score for {name!r} has no matching results.json row (dropped)")
    return rows, warnings


def parse_appendix(findings_text):
    """Read-only parse of the markdown table between the header row and the
    APPENDIX:APPEND_HERE marker. Simple '|'.split per line, no markdown lib.
    -> list[dict] keyed by APPENDIX_COLUMNS"""
    heading_idx = findings_text.index("## Full per-run table")
    marker_idx = findings_text.index("<!-- RENDER:APPENDIX:APPEND_HERE")
    section = findings_text[heading_idx:marker_idx]
    lines = [l for l in section.splitlines() if l.strip().startswith("|")]
    rows = []
    for line in lines[2:]:  # skip header + separator row
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != len(APPENDIX_COLUMNS):
            continue
        rows.append(dict(zip(APPENDIX_COLUMNS, cells)))
    return rows


def format_appendix_rows(rows):
    return "\n".join("| " + " | ".join(str(r.get(c, "N/A")) for c in APPENDIX_COLUMNS) + " |" for r in rows)


def aggregate(rows, group_keys):
    """mean/n per group, .get()-tolerant of missing turns/cost"""
    groups = defaultdict(list)
    for r in rows:
        groups[tuple(r[k] for k in group_keys)].append(r)
    out = []
    for key, grs in groups.items():
        entry = dict(zip(group_keys, key))
        entry["n"] = len(grs)
        for field in ("correct", "auto_complete", "judge_completeness", "judge_overcorrection", "turns", "cost"):
            vals = [v for v in (_num(r.get(field)) for r in grs) if v is not None]
            entry[field] = sum(vals) / len(vals) if vals else None
        out.append(entry)
    return out


_HEADERS = {
    "task": "Task", "arm": "Arm", "n": "n", "correct": "Correct", "auto_complete": "Auto Complete",
    "judge_completeness": "Judge Completeness", "judge_overcorrection": "Judge Overcorrection",
    "turns": "Turns", "cost": "Cost/run", "hook_version": "Version",
}
_FORMATTERS = {
    "task": lambda r: r["task"], "arm": lambda r: r["arm"], "n": lambda r: str(r["n"]),
    "hook_version": lambda r: r["hook_version"],
    "correct": lambda r: f"{r['correct']:.3f}" if r["correct"] is not None else "N/A",
    "auto_complete": lambda r: f"{r['auto_complete']:.3f}" if r["auto_complete"] is not None else "N/A",
    "judge_completeness": lambda r: f"{r['judge_completeness']:.2f}" if r["judge_completeness"] is not None else "N/A",
    "judge_overcorrection": lambda r: f"{r['judge_overcorrection']:.2f}" if r["judge_overcorrection"] is not None else "N/A",
    "turns": lambda r: _fmt1(r["turns"]), "cost": lambda r: _fmt_cost(r["cost"]),
}


def _render_table(agg_rows, columns):
    lines = ["| " + " | ".join(_HEADERS[c] for c in columns) + " |",
             "|" + "|".join("---" for _ in columns) + "|"]
    for r in agg_rows:
        lines.append("| " + " | ".join(_FORMATTERS[c](r) for c in columns) + " |")
    return "\n".join(lines)


def compute_run_meta(pooled_rows):
    by_stamp = defaultdict(list)
    for r in pooled_rows:
        by_stamp[r["run_stamp"]].append(r)
    meta = {}
    for stamp, rs in by_stamp.items():
        cell_counts = defaultdict(int)
        for r in rs:
            cell_counts[(r["task"], r["arm"], r["model"])] += 1
        meta[stamp] = {
            "tasks": sorted(set(r["task"] for r in rs)),
            "arms": sorted(set(r["arm"] for r in rs)),
            "models": sorted(set(r["model"] for r in rs)),
            "cells": len(rs),
            "runs_per_cell": max(cell_counts.values()) if cell_counts else 0,
        }
    return meta


def _chart_svg(bars, theme, title, subtitle):
    """Horizontal bar chart. bars = [(arm, value)] sorted desc."""
    font = 'system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif'
    left, right, top, row_h, bar_h, bottom = 170, 60, 58, 34, 18, 14
    width = 860
    height = top + row_h * len(bars) + bottom
    xmax = max(v for _, v in bars) * 1.15 or 1
    plot_w = width - left - right
    aria = (f"{title} by arm; {bars[-1][0]} lowest at {bars[-1][1]:.1f}, "
            f"{bars[0][0]} highest at {bars[0][1]:.1f}.")
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="{aria}">',
        f'<text x="{left}" y="22" font-family="{font}" font-size="15" font-weight="600" '
        f'fill="{theme["ink"]}">{title}</text>',
        f'<text x="{left}" y="41" font-family="{font}" font-size="12.5" '
        f'fill="{theme["ink2"]}">{subtitle}</text>',
    ]
    for i, (arm, v) in enumerate(bars):
        y = top + i * row_h + (row_h - bar_h) / 2
        w = max(v / xmax * plot_w, 6)
        color = theme["accent"] if arm == CHART_FEATURED_ARM else theme["neutral"]
        weight = ' font-weight="600"' if arm == CHART_FEATURED_ARM else ""
        r = 4
        parts += [
            f'<text x="{left - 12}" y="{y + bar_h / 2 + 4.5}" text-anchor="end" '
            f'font-family="{font}" font-size="13"{weight} fill="{theme["ink2"] if arm != CHART_FEATURED_ARM else theme["ink"]}">{arm}</text>',
            f'<path d="M{left},{y} H{left + w - r} Q{left + w},{y} {left + w},{y + r} '
            f'V{y + bar_h - r} Q{left + w},{y + bar_h} {left + w - r},{y + bar_h} H{left} Z" fill="{color}"/>',
            f'<text x="{left + w + 8}" y="{y + bar_h / 2 + 4.5}" font-family="{font}" '
            f'font-size="13"{weight} fill="{theme["ink"]}">{v:.1f}</text>',
        ]
    parts.append(f'<line x1="{left}" y1="{top - 4}" x2="{left}" y2="{height - bottom}" '
                 f'stroke="{theme["axis"]}" stroke-width="1"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def render_chart_svgs(headline_agg):
    ASSETS.mkdir(exist_ok=True)
    written = []
    for spec in CHART_SPECS:
        bars = sorted(((r["arm"], spec["value"](r[spec["field"]]))
                       for r in headline_agg if r.get(spec["field"]) is not None),
                      key=lambda t: -t[1])
        if not bars:
            raise RenderError(f"no {spec['field']} data to chart for {spec['key']}")
        for suffix, theme in ((".svg", CHART_THEMES["light"]), ("-dark.svg", CHART_THEMES["dark"])):
            path = ASSETS / f"{spec['key']}{suffix}"
            path.write_text(_chart_svg(bars, theme, spec["title"], spec["subtitle"]), encoding="utf-8")
            written.append(path)
    return written


def render_headline_table(pooled_rows):
    agg = sorted(aggregate(pooled_rows, ["arm"]), key=lambda r: _arm_key(r["arm"]))
    return agg


def render_version_history_table(pooled_rows):
    agg = aggregate(pooled_rows, ["hook_version", "arm"])
    agg.sort(key=lambda r: (_version_sort_key(r["hook_version"]), _arm_key(r["arm"])))
    return _render_table(agg, ["hook_version", "arm", "n", "correct", "auto_complete",
                                "judge_completeness", "judge_overcorrection", "turns", "cost"])


def render_per_task_table(pooled_rows):
    agg = aggregate(pooled_rows, ["task", "arm"])
    agg.sort(key=lambda r: (r["task"], _arm_key(r["arm"])))
    table = _render_table(agg, ["task", "arm", "n", "correct", "auto_complete",
                                 "judge_completeness", "judge_overcorrection", "turns", "cost"])

    by_task = defaultdict(list)
    for r in agg:
        if r["correct"] is not None:
            by_task[r["task"]].append(r["correct"])
    spreads = {t: max(v) - min(v) for t, v in by_task.items() if v}
    sentence = ""
    if spreads:
        outlier = max(spreads, key=lambda t: spreads[t])
        sentence = (f"`{outlier}` shows the largest spread in correctness across arms "
                    f"({spreads[outlier]:.3f}); every other task varies far less by arm.")
    return (table + ("\n\n" + sentence if sentence else "")), agg


def render_intro(pooled_rows, run_meta):
    stamps = sorted(run_meta)
    n_stamps = len(stamps)
    lines = [f"Merged across {n_stamps} run{'s' if n_stamps != 1 else ''}:"]
    for stamp in stamps:
        m = run_meta[stamp]
        lines.append(f"- `evals/runs/{stamp}` — {len(m['tasks'])} tasks × {len(m['arms'])} arms × "
                      f"{len(m['models'])} models × {m['runs_per_cell']} runs = {m['cells']} cells")

    def n_for_task(t):
        counts = defaultdict(int)
        for r in pooled_rows:
            if r["task"] == t:
                counts[r["arm"]] += 1
        return max(counts.values()) if counts else 0

    task_stamp_count = defaultdict(int)
    for m in run_meta.values():
        for t in m["tasks"]:
            task_stamp_count[t] += 1

    total_cells = sum(m["cells"] for m in run_meta.values())
    groups = defaultdict(list)
    for t, cov in task_stamp_count.items():
        groups[(cov, n_for_task(t))].append(t)

    parts = []
    for (cov, n_val), tasks in sorted(groups.items(), key=lambda kv: -kv[0][0]):
        names = _join_names(sorted(tasks))
        verb = "are" if len(tasks) > 1 else "is"
        if cov == n_stamps:
            parts.append(f"{names} {verb} covered by all {n_stamps} runs (n={n_val}/arm each, pooled)")
        else:
            parts.append(f"{names} come from {cov} of the {n_stamps} runs only (n={n_val}/arm each)")

    return "\n".join(lines) + f"\n\nCombined: {total_cells} cells. " + "; ".join(parts) + "."


def render_readme_intro_sentence(run_meta):
    """Short 'Merged across N eval runs (...)' sentence for README.md's RESULTS_TABLE block body."""
    stamps = sorted(run_meta)
    total_cells = sum(m["cells"] for m in run_meta.values())
    n_tasks = len(set(t for m in run_meta.values() for t in m["tasks"]))
    n_arms = len(set(a for m in run_meta.values() for a in m["arms"]))
    n_models = len(set(md for m in run_meta.values() for md in m["models"]))
    runs_desc = ", ".join(str(run_meta[s]["runs_per_cell"]) for s in stamps)
    return (f"Merged across {len(stamps)} eval runs ({total_cells} cells total: {n_tasks} tasks × "
            f"{n_arms} arms × {n_models} models, {runs_desc} runs/cell across the runs):")


def render_evals_readme_intro(run_meta):
    """Inline comma-separated 'Merged across `stamp` (...), ...' sentence for evals/README.md."""
    stamps = sorted(run_meta)
    parts = [f"`{s}` ({len(run_meta[s]['tasks'])} tasks × {len(run_meta[s]['arms'])} arms × "
              f"{len(run_meta[s]['models'])} models × {run_meta[s]['runs_per_cell']} runs)" for s in stamps]
    joined = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + f", and {parts[-1]}"
    total_cells = sum(m["cells"] for m in run_meta.values())
    return (f"Merged across {joined} — {total_cells} cells total. Full breakdown, per-task tables, "
            f"and the full per-run appendix (tagged by source run): "
            f"[`docs/eval-findings.md`](../docs/eval-findings.md).")


def render_sample_size_note(pooled_rows):
    meta = compute_run_meta(pooled_rows)
    stamps = sorted(meta)
    runs_list = ", ".join(str(meta[s]["runs_per_cell"]) for s in stamps)
    tasks = sorted(set(r["task"] for r in pooled_rows))

    def n_for_task(t):
        counts = defaultdict(int)
        for r in pooled_rows:
            if r["task"] == t:
                counts[r["arm"]] += 1
        return max(counts.values()) if counts else 0

    task_ns = {t: n_for_task(t) for t in tasks}
    by_n = defaultdict(list)
    for t, n in task_ns.items():
        by_n[n].append(t)
    n_desc = "; ".join(f"{n} for {_join_names(sorted(ts))}"
                        for n, ts in sorted(by_n.items(), reverse=True))
    return (f"**Note on sample size:** run counts per cell vary across runs ({runs_list}), "
            f"so per-task n varies ({n_desc}). Treat single-cell and per-task numbers as directional, "
            f"especially for the lowest-n tasks.")


def render_missing_metrics_note(pooled_rows):
    missing = [r for r in pooled_rows if _num(r.get("turns")) is None or _num(r.get("cost")) is None]
    if not missing:
        return "**Note on missing per-cell metrics:** no cells are missing `turns`/`cost` in the current pooled dataset."
    cells_desc = "; ".join(
        f"`{r['task']}` / `{r['arm']}` / {r['model']} / run {r['run']} (run {r['run_stamp']})"
        for r in missing)
    return (f"**Note on missing per-cell metrics:** {len(missing)} cell(s) are missing `turns`/`cost` "
            f"in the raw eval output: {cells_desc}. They are included in all correctness/completeness/"
            f"overcorrection averages but excluded from turns/cost averages (shown as `N/A` in the appendix).")


def mechanical_leader_sentence(headline_rows, anchor_arm="baseline"):
    """argmax per quality metric (correct, auto_complete, judge_completeness);
    if all three agree on one arm, emit today's-style sentence with computed
    turn/cost premium vs anchor_arm; else emit a neutral per-metric-leader
    sentence. No causal/hook-version content."""
    metrics = ["correct", "auto_complete", "judge_completeness"]
    scored = [r for r in headline_rows if all(r.get(m) is not None for m in metrics)]
    leaders = {m: max(scored, key=lambda r: r[m])["arm"] for m in metrics} if scored else {}

    if leaders and len(set(leaders.values())) == 1:
        leader_arm = next(iter(set(leaders.values())))
        leader = next(r for r in headline_rows if r["arm"] == leader_arm)
        anchor = next((r for r in headline_rows if r["arm"] == anchor_arm), None)
        if anchor and anchor.get("turns") and anchor.get("cost") and leader.get("turns") and leader.get("cost"):
            turn_premium = (leader["turns"] - anchor["turns"]) / anchor["turns"] * 100
            cost_premium = (leader["cost"] - anchor["cost"]) / anchor["cost"] * 100
            premium = (turn_premium + cost_premium) / 2
            return (f"`{leader_arm}` leads on every quality metric — correctness, completion, and judged "
                    f"completeness — at a ~{premium:.0f}% turn/cost premium over `{anchor_arm}`.")
        return f"`{leader_arm}` leads on every quality metric — correctness, completion, and judged completeness."

    parts = ", ".join(f"{m.replace('_', ' ')}: `{a}`" for m, a in leaders.items())
    return f"No single arm leads on every quality metric — per-metric leaders are {parts}."


def mechanical_nudge_sentence(headline_rows, active_arms=("gaslighter-lite", "gaslighter-full")):
    """Mechanically derived nudge-prompt-vs-active-arms comparison for evals/README.md's
    RESULTS_PROSE — mirrors mechanical_leader_sentence's argmax/fallback style, no causal content."""
    by_arm = {r["arm"]: r for r in headline_rows}
    nudge = by_arm.get("nudge-prompt")
    actives = [by_arm[a] for a in active_arms if a in by_arm]
    if not nudge or not actives or nudge.get("correct") is None:
        return ""
    if all(a.get("correct") is not None and nudge["correct"] < a["correct"] for a in actives):
        active_desc = "/".join(f"{a['correct']:.3f}" for a in actives)
        return (f"The static `nudge-prompt` arm still underperforms both active gaslighter modes "
                f"on correctness ({nudge['correct']:.3f} vs {active_desc}).")
    return "The static `nudge-prompt` arm's correctness relative to the active gaslighter modes is mixed in the current pooled data."


def patch_block(text, name, new_body):
    pat = re.compile(
        rf"(<!-- RENDER:{re.escape(name)}:START.*?-->\n)(.*?)(\n<!-- RENDER:{re.escape(name)}:END -->)",
        re.DOTALL)
    if not pat.search(text):
        raise RenderError(f"missing sentinel block RENDER:{name}")
    return pat.sub(lambda m: m.group(1) + new_body + m.group(3), text, count=1)


def append_before_marker(text, name, new_lines):
    pat = re.compile(rf"<!-- RENDER:{re.escape(name)}:APPEND_HERE.*?-->")
    m = pat.search(text)
    if not m:
        raise RenderError(f"missing sentinel marker RENDER:{name}:APPEND_HERE")
    return text[:m.start()] + new_lines + "\n" + m.group(0) + text[m.end():]


def print_delta(prior_rows, pooled_rows):
    before = {r["arm"]: r for r in aggregate(prior_rows, ["arm"])} if prior_rows else {}
    after = {r["arm"]: r for r in aggregate(pooled_rows, ["arm"])}
    print("\n=== headline delta (before -> after) ===")
    for row in sorted(after.values(), key=lambda r: _arm_key(r["arm"])):
        arm = row["arm"]
        b = before.get(arm)
        b_n = b["n"] if b else 0
        b_correct = f"{b['correct']:.3f}" if b and b["correct"] is not None else "N/A"
        a_correct = f"{row['correct']:.3f}" if row["correct"] is not None else "N/A"
        print(f"  {arm:16} n={b_n:>4} -> {row['n']:>4}   correct {b_correct} -> {a_correct}")


def check():
    ok = True
    for path, names in BLOCK_MARKERS.items():
        text = path.read_text(encoding="utf-8")
        for name in names:
            n_start = text.count(f"<!-- RENDER:{name}:START")
            n_end = text.count(f"<!-- RENDER:{name}:END -->")
            good = n_start == 1 and n_end == 1
            print(f"{'ok ' if good else 'XX '} {path.relative_to(ROOT)}: RENDER:{name} (start={n_start}, end={n_end})")
            ok = ok and good
    for path, names in APPEND_MARKERS.items():
        text = path.read_text(encoding="utf-8")
        for name in names:
            n = text.count(f"<!-- RENDER:{name}:APPEND_HERE")
            good = n == 1
            print(f"{'ok ' if good else 'XX '} {path.relative_to(ROOT)}: RENDER:{name}:APPEND_HERE (count={n})")
            ok = ok and good
    return 0 if ok else 1


def render(run_dir, dry_run=False):
    run_dir = _resolve(run_dir)
    stamp = run_dir.name
    results_rows, judge_scores = load_run(run_dir)
    new_rows, warnings = join_run_rows(stamp, results_rows, judge_scores)
    if not new_rows:
        sys.exit(f"no usable rows produced for {stamp} after joining results.json + judge.json")

    findings_text = FINDINGS.read_text(encoding="utf-8")
    prior_rows = parse_appendix(findings_text)
    already_present = any(r["run_stamp"] == stamp for r in prior_rows)
    if already_present and not dry_run:
        print(f"run stamp {stamp} already present in the appendix — nothing to do", file=sys.stderr)
        sys.exit(2)

    pooled_prior = [r for r in prior_rows if r["run_stamp"] != stamp]
    pooled_rows = pooled_prior + new_rows
    for r in pooled_rows:
        r["hook_version"] = version_bucket(r["hook_sha"])
    current_version = version_bucket(_git_sha())
    current_rows = [r for r in pooled_rows if r["hook_version"] == current_version]
    if not current_rows:
        sys.exit(f"no cells found for current version {current_version!r} — "
                  f"run an eval at this commit first")

    print_delta(pooled_prior, pooled_rows)
    if warnings:
        print("\nJOIN WARNINGS:", file=sys.stderr)
        for w in warnings:
            print(f"  - {w}", file=sys.stderr)

    run_meta = compute_run_meta(pooled_rows)
    intro = render_intro(pooled_rows, run_meta)
    sample_size = render_sample_size_note(pooled_rows)
    missing_metrics = render_missing_metrics_note(pooled_rows)
    version_history_body = render_version_history_table(pooled_rows)
    current_run_meta = compute_run_meta(current_rows)
    headline_agg = render_headline_table(current_rows)
    n_tasks = len(set(r["task"] for r in current_rows))
    n_models = len(set(r["model"] for r in current_rows))
    headline_desc = (f"Scoped to {current_version} (current), n={headline_agg[0]['n']} per arm — "
                      f"{n_tasks} tasks, {n_models} models — see Version history below for trend "
                      f"across releases.")
    headline_body = headline_desc + "\n\n" + _render_table(
        headline_agg, ["arm", "n", "correct", "auto_complete", "judge_completeness", "judge_overcorrection", "turns", "cost"])
    per_task_body, _ = render_per_task_table(current_rows)
    leader_sentence = mechanical_leader_sentence(headline_agg)
    nudge_sentence = mechanical_nudge_sentence(headline_agg)
    evals_readme_prose = leader_sentence + ((" " + nudge_sentence) if nudge_sentence else "")

    readme_body = render_readme_intro_sentence(current_run_meta) + "\n\n" + _render_table(
        headline_agg, ["arm", "correct", "auto_complete", "judge_completeness", "judge_overcorrection"])
    evals_readme_intro = render_evals_readme_intro(current_run_meta)
    evals_readme_body = _render_table(
        headline_agg, ["arm", "correct", "auto_complete", "judge_completeness", "judge_overcorrection", "turns", "cost"])

    if dry_run:
        print("\n=== DRY RUN — computed content, nothing written ===")
        for name, body in (("INTRO", intro), ("SAMPLE_SIZE", sample_size),
                            ("MISSING_METRICS", missing_metrics), ("VERSION_HISTORY", version_history_body),
                            ("HEADLINE_TABLE", headline_body),
                            ("PERTASK_TABLE", per_task_body), ("README:RESULTS_PROSE", leader_sentence),
                            ("README:RESULTS_TABLE", readme_body),
                            ("EVALS_README:RESULTS_INTRO", evals_readme_intro),
                            ("EVALS_README:RESULTS_TABLE", evals_readme_body),
                            ("EVALS_README:RESULTS_PROSE", evals_readme_prose)):
            print(f"\n--- RENDER:{name} ---\n{body}")
        print(f"\n--- new appendix rows ({len(new_rows)}) ---\n{format_appendix_rows(new_rows)}")
        return

    try:
        findings_text = patch_block(findings_text, "INTRO", intro)
        findings_text = patch_block(findings_text, "SAMPLE_SIZE", sample_size)
        findings_text = patch_block(findings_text, "MISSING_METRICS", missing_metrics)
        findings_text = patch_block(findings_text, "VERSION_HISTORY", version_history_body)
        findings_text = patch_block(findings_text, "HEADLINE_TABLE", headline_body)
        findings_text = patch_block(findings_text, "PERTASK_TABLE", per_task_body)
        findings_text = append_before_marker(findings_text, "APPENDIX", format_appendix_rows(new_rows))

        readme_text = README.read_text(encoding="utf-8")
        readme_text = patch_block(readme_text, "RESULTS_TABLE", readme_body)
        readme_text = patch_block(readme_text, "RESULTS_PROSE", leader_sentence)

        evals_readme_text = EVALS_README.read_text(encoding="utf-8")
        evals_readme_text = patch_block(evals_readme_text, "RESULTS_INTRO", evals_readme_intro)
        evals_readme_text = patch_block(evals_readme_text, "RESULTS_TABLE", evals_readme_body)
        evals_readme_text = patch_block(evals_readme_text, "RESULTS_PROSE", evals_readme_prose)
    except RenderError as e:
        sys.exit(f"error: {e}")

    FINDINGS.write_text(findings_text, encoding="utf-8")
    README.write_text(readme_text, encoding="utf-8")
    EVALS_README.write_text(evals_readme_text, encoding="utf-8")
    charts = render_chart_svgs(headline_agg)
    print(f"\nwrote {FINDINGS}, {README}, {EVALS_README} ({len(new_rows)} new appendix rows)")
    print("wrote " + ", ".join(str(c) for c in charts))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir", nargs="?", help="run directory (required unless --check)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true", help="verify sentinel markers exist in the 3 docs")
    ap.add_argument("--chart", action="store_true", help="regenerate chart SVGs from the current appendix")
    args = ap.parse_args()

    if args.check:
        sys.exit(check())

    if args.chart:
        rows = parse_appendix(FINDINGS.read_text(encoding="utf-8"))
        for r in rows:
            r["hook_version"] = version_bucket(r["hook_sha"])
        current_version = version_bucket(_git_sha())
        current_rows = [r for r in rows if r["hook_version"] == current_version]
        if not current_rows:
            print(f"no cells for current version {current_version!r} — "
                  f"using full pooled appendix instead", file=sys.stderr)
            current_rows = rows
        charts = render_chart_svgs(render_headline_table(current_rows))
        print("wrote " + ", ".join(str(c) for c in charts))
        return

    if not args.run_dir:
        sys.exit("give a run_dir, --chart, or --check")

    try:
        render(args.run_dir, dry_run=args.dry_run)
    except RenderError as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
