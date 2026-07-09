// gaslighter — shared decision orchestrator (the "adapter core").
//
// decide() encodes the entire nudge flow once, independent of any harness. It
// receives the current state plus a small set of injected I/O callbacks and
// returns an abstract plan; each adapter is responsible only for (a) producing
// those callbacks and (b) translating the returned plan into its own delivery
// mechanism:
//
//   Claude Code : plan.deliver.blocking -> decision:"block"
//                 otherwise             -> hookSpecificOutput.additionalContext
//   OpenCode    : plan.deliver          -> client.session.prompt(...) (soft:
//                                          noReply context, blocking: real reply)
//
// The caller handles anything genuinely harness-specific *before* calling
// decide(): mode==='off' short-circuits, and Claude's background_tasks/
// session_crons filter (fields OpenCode doesn't have). decide() assumes the
// session is really finishing and the mode is active.
//
// decide() mutates the passed `state` (turn_count/nudge_count/last_turn_uuid)
// and returns { action, ... }. The caller persists `state` for every action
// except 'noop'.

'use strict';

var engine = require('./engine');

// ctx contract:
//   mode              : resolved mode string (not 'off')
//   maxNudges         : resolved cap (number | Infinity)
//   state             : loaded, mutable session state
//   stopHookActive    : truthy when the harness signals a continuation
//   nudgeOnReadOnly   : bool
//   getQuiet(mode)    : -> bool
//   getTurn(staleUuid): async -> turn | null
//                       turn = { text, usedTools, editedFiles, complete, uuid }
//   runSmartCheck(state, turn) : async -> { status:'ok'|'gap'|'failed', reason?, error? }
//   log(event, extra) : optional debug sink
//
// Returns one of:
//   { action:'exit',   reason }                       caller: save state, stop
//   { action:'deliver', reason, deliver:{ blocking, text, quiet,
//                                          systemMessage?, isFirst, smart } }
async function decide(ctx) {
  var state = ctx.state;
  var log = ctx.log || function () {};

  state.turn_count = (state.turn_count || 0) + 1;

  if ((state.nudge_count || 0) >= ctx.maxNudges) {
    return { action: 'exit', reason: 'cap_reached' };
  }

  var isFirst = (state.nudge_count || 0) === 0;

  // A continuation flagged by the harness while our own state says "no nudges
  // yet" means the state file is missing/mismatched — don't re-fire the first
  // nudge, treat it as a subsequent turn.
  if (isFirst && ctx.stopHookActive === true) {
    log('state_mismatch', {});
    isFirst = false;
  }

  var turn = null;

  if (!isFirst) {
    turn = await ctx.getTurn(state.last_turn_uuid);
    if (!turn) return { action: 'exit', reason: 'flush_timeout' };
    state.last_turn_uuid = turn.uuid;
    if (engine.confidenceDeclared(turn.text)) return { action: 'exit', reason: 'confidence_declared' };
    // Answered a nudge with zero tool calls: it re-checked and changed nothing,
    // so another identical nudge is noise regardless of phrasing.
    if (!turn.usedTools) return { action: 'exit', reason: 'no_tool_activity' };
  } else if (!ctx.nudgeOnReadOnly) {
    // First nudge on a pure Q&A turn is noise — re-reading requirements only
    // matters once something changed on disk.
    turn = await ctx.getTurn(state.last_turn_uuid);
    if (!turn) return { action: 'exit', reason: 'flush_timeout' };
    state.last_turn_uuid = turn.uuid;
    if (!turn.editedFiles) return { action: 'exit', reason: 'no_edit_activity' };
  }

  // Smart mode always needs the turn text for its check prompt, even on a
  // first-nudge path that skipped the read-only gate above.
  if (ctx.mode === 'smart' && !turn) {
    turn = await ctx.getTurn(state.last_turn_uuid);
    if (!turn) return { action: 'exit', reason: 'flush_timeout' };
    state.last_turn_uuid = turn.uuid;
  }

  if (ctx.mode === 'smart') {
    var check = await ctx.runSmartCheck(state, turn);
    if (check && check.status === 'ok') return { action: 'exit', reason: 'smart_ok' };
    if (check && check.status === 'failed') log('smart_check_failed', { error: check.error });

    state.nudge_count = (state.nudge_count || 0) + 1;

    if (check && check.status === 'gap') {
      return {
        action: 'deliver',
        reason: 'smart_gap',
        deliver: {
          blocking: true,
          text: 'Requirement check flagged gaps: ' + (check.reason || 'unspecified') +
            '. Fix only these — do not add anything unrequested.',
          quiet: false,
          isFirst: isFirst,
          smart: true
        }
      };
    }

    // Check failed/unavailable: never block on it — fall back to a plain
    // lite-style nudge (soft, quiet per lite's quiet resolution).
    return {
      action: 'deliver',
      reason: 'smart_fallback',
      deliver: {
        blocking: false,
        text: isFirst ? engine.FIRST_NUDGE : engine.SUBSEQUENT_NUDGE,
        quiet: ctx.getQuiet('lite'),
        isFirst: isFirst,
        smart: true
      }
    };
  }

  state.nudge_count = (state.nudge_count || 0) + 1;

  var text = isFirst ? engine.FIRST_NUDGE : engine.SUBSEQUENT_NUDGE;
  var quiet = ctx.getQuiet(ctx.mode);

  if (ctx.mode === 'lite') {
    return {
      action: 'deliver',
      reason: 'nudge',
      deliver: { blocking: false, text: text, quiet: quiet, isFirst: isFirst, smart: false }
    };
  }

  // full (and any non-lite, non-smart, non-off mode): hard, user-visible.
  var cap = ctx.maxNudges;
  return {
    action: 'deliver',
    reason: 'nudge',
    deliver: {
      blocking: true,
      text: text,
      quiet: quiet,
      isFirst: isFirst,
      smart: false,
      systemMessage: 'gaslighter: verifying completeness (nudge ' + state.nudge_count +
        '/' + (cap === Infinity ? 'unlimited' : cap) + ')'
    }
  };
}

module.exports = { decide: decide };
