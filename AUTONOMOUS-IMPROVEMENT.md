# Autonomous Improvement Quick Reference

This file is a quick reference for Claude sessions working on gaslighter improvements.

## TL;DR

1. **Run evals:** `cd evals && python3 run.py --task hard-* --models haiku,sonnet --runs 4`
2. **Judge results:** `/gaslighter:judge runs/<timestamp>`
3. **Classify failures** from `judge.json` (see failure types below)
4. **Fix the code** (see file map below)
5. **Re-run evals** and repeat until gaslighter ≥ baseline

## Failure Classification → Fix Mapping

| Failure Type | Check | Fix |
|---|---|---|
| **Threshold miss** | No "GASLIGHTER CHECK" in stderr | Lower thresholds in `hooks/gaslighter-config.js` or add signals to `analyzeTranscript()` in `hooks/gaslighter-nudge.js` |
| **Ineffective deterministic nudge** | Stderr has `GASLIGHTER CHECK: <type>` (not LLM Judge) | Update `NUDGES` object in `hooks/gaslighter-nudge.js` |
| **Ineffective LLM judge** | Stderr has `GASLIGHTER CHECK (LLM Judge):` | Update `buildLLMJudgePrompt()` in `hooks/gaslighter-nudge.js` |
| **Overcorrection** | Workspace has wrong file structure vs. task | Add constraint to nudge prompts in `NUDGES` |
| **Late firing** | Nudge fired after work done | Can't fix with Stop hook (future: PreWrite/TaskCreate hooks) |

## Critical Files

### Decision Logic
- `hooks/gaslighter-nudge.js` — Core hook: threshold checks, nudge selection, LLM judge
- `hooks/gaslighter-config.js` — Thresholds (lite/full/ultra), caps, defaults

### State & Runtime
- `hooks/gaslighter-runtime.js` — State persistence, flag file ops
- State file: `$CLAUDE_PLUGIN_DATA/state-{session_id}.json`

### Tests
- `tests/test-nudge-decision.js` — Deterministic threshold tests (26 cases)
- `tests/test-llm-judge.js` — LLM judge hybrid escalation tests

### Eval Infrastructure
- `evals/run.py` — Eval runner (tasks.py defines tasks)
- `skills/gaslighter:judge/SKILL.md` — Completeness judging skill

## Success Criteria

Ship when:
- ✅ Gaslighter complete_rate ≥ baseline on all hard-* tasks
- ✅ No regressions on tasks that were already passing
- ✅ Tests still pass: `node tests/test-nudge-decision.js && node tests/test-llm-judge.js`
- ✅ Cost overhead acceptable (~$0.0005/run with LLM judge)

## Version History

- **v0.2.0:** Deterministic thresholds + cumulative tracking
  - Problem: Threshold misses (webhook 0.0), false negatives (service-refactor 0.62)
- **v0.2.1:** Hybrid nudge (deterministic → LLM judge → let through)
  - Fix: Semantic understanding of completeness, progressive escalation
  - Cost: ~$0.0005/run average (negligible overhead)

## Full Documentation

See `CLAUDE.md` "Autonomous Eval-Driven Improvement Workflow" section for detailed step-by-step instructions.
