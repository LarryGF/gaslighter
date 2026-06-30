#!/usr/bin/env python3
"""Orchestrator router for gaslighter."""

import sys
from pathlib import Path

ROUTES = {
    "eval": "eval",
    "evals": "eval",
    "benchmark": "eval",
    "judge": "judge",
    "score": "judge",
    "rate": "judge",
}

ASK = (
    "Execute exactly this tool call:\n\n"
    "```\n"
    "AskUserQuestion({\n"
    "  questions: [{\n"
    '    question: "What would you like to do?",\n'
    '    header: "Action",\n'
    "    multiSelect: false,\n"
    "    options: [\n"
    '      { label: "Run evals", description: "Run the gaslighter benchmark suite" },\n'
    '      { label: "Judge run", description: "Score a completed eval run for completeness and overcorrection" },\n'
    '      { label: "Help", description: "Show gaslighter usage and configuration" }\n'
    "    ]\n"
    "  }]\n"
    "})\n"
    "```\n\n"
    "Then, based on the user's selection:\n"
    "- Run evals → execute: `Skill({ skill: \"gaslighter:eval\" })`\n"
    "- Judge run → execute: `Skill({ skill: \"gaslighter:judge\" })`\n"
    "- Help → show the skill body instructions below.\n"
)


def main():
    user_request = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    t = user_request.lower().split()[0] if user_request else ""

    if t == "help":
        print("Show the skill body instructions below (switching modes, how it works).")
        return

    for kw, sub in ROUTES.items():
        if t == kw:
            plugin = Path(__file__).parent.parent.name
            # lkb: strip the routing keyword, only forward remaining args
            rest = user_request.strip()[len(t):].strip()
            args_part = f', args: "{rest}"' if rest else ""
            print(
                "Execute exactly this tool call:\n\n"
                f"```\nSkill({{ skill: \"{plugin}:{sub}\"{args_part} }})\n```"
            )
            return

    print(ASK)


main()
