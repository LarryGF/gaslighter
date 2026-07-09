// gaslighter — OpenCode plugin (adapter).
//
// This is the OpenCode counterpart to the Claude Code Stop hook. It shares the
// exact same decision engine (../hooks/lib/{core,engine,store,env,opencode}.js);
// only the I/O is OpenCode-specific:
//
//   detect finish  : the `session.idle` event  (Claude's Stop)
//   read last turn : client.session.messages()  (Claude's JSONL transcript)
//   deliver nudge  : client.session.prompt()     (Claude's decision:"block" /
//                    additionalContext)
//   smart check    : a throwaway session prompted at the configured cheap model
//
// Semantic note: OpenCode has no "soft, non-blocking" continuation the way
// Claude's additionalContext does — once `session.idle` fires the turn is over,
// so to make the model actually re-verify we send a real follow-up prompt in
// every mode. `lite` vs `full` therefore differ mainly by cap and by whether a
// toast is shown; both cause a re-check. `quiet` suppresses the toast.
//
// Install: see opencode/README.md. Set GASLIGHTER_ROOT to this repo if you copy
// this file outside it; otherwise the shared lib is resolved relative to here.

import { createRequire } from "module"
import { fileURLToPath } from "url"
import path from "path"

const require = createRequire(import.meta.url)

const libDir = process.env.GASLIGHTER_ROOT
  ? path.join(process.env.GASLIGHTER_ROOT, "hooks", "lib")
  : fileURLToPath(new URL("../hooks/lib/", import.meta.url))

const engine = require(path.join(libDir, "engine.js"))
const core = require(path.join(libDir, "core.js"))
const env = require(path.join(libDir, "env.js"))
const { createStore } = require(path.join(libDir, "store.js"))
const oc = require(path.join(libDir, "opencode.js"))

export const GaslighterPlugin = async ({ client, directory }) => {
  const store = createStore(env.resolveDataDir())

  // Sessions we created for smart checks — never nudge those.
  const ignoredSessions = new Set()
  // Sessions currently being processed — avoid overlapping handling.
  const busy = new Set()

  function log(level, message, extra) {
    try {
      client.app.log({ body: { service: "gaslighter", level, message, extra: extra || {} } })
    } catch (e) {}
  }

  async function fetchMessages(sessionID) {
    const res = await client.session.messages({ path: { id: sessionID } })
    // SDK responseStyle may return { data } or the array directly.
    if (Array.isArray(res)) return res
    if (res && Array.isArray(res.data)) return res.data
    return []
  }

  // Smart-mode check via a throwaway session at the configured model.
  async function runSmartCheck(sessionID, cfg, state, turn) {
    const modelId = engine.resolveSmartModel(cfg)
    const coords = oc.parseModelId(modelId)
    if (!coords) return { status: "failed", error: "smartModel must be 'provider/model' in OpenCode" }

    let originalRequest = (state.last_request && state.last_request.prompt)
    if (!originalRequest) {
      try { originalRequest = oc.firstUserText(await fetchMessages(sessionID)) } catch (e) {}
    }
    originalRequest = originalRequest || "(original request unavailable)"
    const prompt = engine.buildSmartCheckPrompt(originalRequest, (turn && turn.text) || "")

    let checkSession
    try {
      checkSession = await unwrap(client.session.create({ body: { title: "gaslighter-check" } }))
      if (checkSession && checkSession.id) ignoredSessions.add(checkSession.id)
      const res = await unwrap(client.session.prompt({
        path: { id: checkSession.id },
        body: {
          model: coords,
          parts: [{ type: "text", text: prompt }],
        },
      }))
      const replyText = extractReplyText(res)
      const parsed = engine.extractSmartJson(replyText)
      if (parsed && parsed.ok === true) return { status: "ok" }
      if (parsed && parsed.ok === false) return { status: "gap", reason: parsed.reason || "unspecified" }
      return { status: "failed", error: "unexpected response shape" }
    } catch (e) {
      return { status: "failed", error: e && e.message }
    } finally {
      if (checkSession && checkSession.id) {
        ignoredSessions.delete(checkSession.id)
        try { await client.session.delete({ path: { id: checkSession.id } }) } catch (e) {}
      }
    }
  }

  async function deliver(sessionID, d) {
    // Always send a real prompt so the model actually re-verifies (see header).
    try {
      await client.session.prompt({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: d.text }] },
      })
    } catch (e) {
      log("error", "failed to deliver nudge", { error: e && e.message })
      return
    }
    if (!d.quiet) {
      try {
        await client.tui.showToast({
          body: { message: d.systemMessage || "gaslighter: verifying completeness", variant: "info" },
        })
      } catch (e) {}
    }
  }

  async function handleIdle(sessionID) {
    if (!sessionID || ignoredSessions.has(sessionID) || busy.has(sessionID)) return
    busy.add(sessionID)
    try {
      const cfg = store.loadConfig()
      const mode = engine.resolveMode(cfg)
      if (mode === "off") return

      const state = store.loadState(sessionID)

      const plan = await core.decide({
        mode,
        maxNudges: engine.resolveMaxNudges(mode, cfg),
        state,
        stopHookActive: false,
        nudgeOnReadOnly: engine.resolveNudgeOnReadOnly(cfg),
        getQuiet: (m) => engine.resolveQuiet(m, cfg),
        getTurn: async (staleUuid) => oc.extractTurn(await fetchMessages(sessionID), staleUuid),
        runSmartCheck: (st, turn) => runSmartCheck(sessionID, cfg, st, turn),
        log: (event, extra) => log("debug", event, extra),
      })

      if (plan.action === "exit") {
        store.saveState(state, sessionID)
        return
      }
      if (plan.action === "deliver") {
        store.saveState(state, sessionID)
        await deliver(sessionID, plan.deliver)
      }
    } catch (e) {
      log("error", "handler failed", { error: e && e.message })
    } finally {
      busy.delete(sessionID)
    }
  }

  return {
    event: async ({ event }) => {
      if (!event || event.type !== "session.idle") return
      const props = event.properties || {}
      const sessionID = props.sessionID || props.sessionId || props.id
      await handleIdle(sessionID)
    },
  }
}

// SDK calls may return { data } (responseStyle 'fields') or the value directly.
function unwrap(promiseOrValue) {
  return Promise.resolve(promiseOrValue).then((res) => {
    if (res && typeof res === "object" && "data" in res && res.data !== undefined) return res.data
    return res
  })
}

// Pull assistant reply text out of a session.prompt result across shapes.
function extractReplyText(res) {
  if (!res) return ""
  if (typeof res === "string") return res
  const parts = res.parts || (res.info && res.info.parts) || []
  if (Array.isArray(parts)) {
    const text = parts.filter((p) => p && p.type === "text" && p.text).map((p) => p.text).join("\n")
    if (text) return text
  }
  if (res.info && typeof res.info.text === "string") return res.info.text
  if (typeof res.text === "string") return res.text
  return JSON.stringify(res)
}

export default GaslighterPlugin
