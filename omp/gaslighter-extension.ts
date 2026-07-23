// gaslighter — omp extension adapter.
//
// This is the omp counterpart to the Claude Code Stop hook and the OpenCode
// plugin. It shares the exact same decision engine
// (../hooks/lib/{core,engine,store,env,omp}.js); only the I/O is omp-specific:
//
//   detect finish  : the `session_stop` extension event (Claude's Stop,
//                     OpenCode's `session.idle`)
//   read last turn : event.messages / event.last_assistant_message
//                     (Claude's JSONL transcript, OpenCode's
//                     client.session.messages())
//   deliver nudge  : the event handler's return value — { decision: "block",
//                     reason } (blocking) or { continue: true,
//                     additionalContext } (soft) — both understood natively
//                     by session_stop's Claude/Codex-compatible result shape
//   smart check    : a throwaway `omp -p ... --mode json --no-session`
//                     subprocess at the configured cheap model
//
// Semantic note: unlike Claude's additionalContext (which keeps the *same*
// turn open) and unlike OpenCode (no soft continuation at all, so every mode
// sends a real follow-up prompt), omp's session_stop result has both: native
// `continue: true` + `additionalContext` for a genuine soft continuation, and
// the Claude-compatible `decision: "block"` + `reason` for the hard path. So
// `lite` and `full` map onto session_stop almost exactly as they do for
// Claude: lite returns { continue, additionalContext }, full returns
// { decision: "block", reason }.
//
// Install: this repo's root package.json's `omp.extensions` field points
// npm/local-plugin installs at this file directly, no symlinking needed. Set
// GASLIGHTER_ROOT if this file is copied outside the repo; otherwise the
// shared lib resolves relative to here (mirrors the OpenCode adapter's
// opencode/README.md convention).

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);

const pluginRoot = process.env.GASLIGHTER_ROOT
  ? path.resolve(process.env.GASLIGHTER_ROOT)
  : fileURLToPath(new URL("../", import.meta.url));

const libDir = process.env.GASLIGHTER_ROOT
  ? path.join(process.env.GASLIGHTER_ROOT, "hooks", "lib")
  : fileURLToPath(new URL("../hooks/lib/", import.meta.url));

const engine = require(path.join(libDir, "engine.js"));
const core = require(path.join(libDir, "core.js"));
const env = require(path.join(libDir, "env.js"));
const { createStore } = require(path.join(libDir, "store.js"));
const ompLib = require(path.join(libDir, "omp.js"));

// Bare shape of the pieces of ExtensionAPI/ExtensionContext this module
// touches — kept minimal and structural (not imported from the SDK) so this
// file has no hard compile-time dependency on @oh-my-pi/pi-coding-agent
// being resolvable at authoring time; the real shape is enforced at runtime
// by the host.
interface Logger {
  warn(message: string, extra?: unknown): void;
  debug(message: string, extra?: unknown): void;
}
interface AgentContentBlock {
  type: string;
  text?: string;
  name?: string;
}
interface AgentMessage {
  role: string;
  content: string | AgentContentBlock[];
}
interface SessionStopEvent {
  type: "session_stop";
  messages: AgentMessage[];
  turn_id: number;
  last_assistant_message?: AgentMessage;
  session_id: string;
  session_file?: string;
  stop_hook_active: boolean;
}
interface SessionStopResult {
  continue?: boolean;
  additionalContext?: string;
  decision?: "block";
  reason?: string;
}
interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
}
interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
interface ResourcesDiscoverResult {
  skillPaths: string[];
}
interface ExtensionAPI {
  logger: Logger;
  on(event: "resources_discover", handler: () => ResourcesDiscoverResult): void;
  on(event: "session_stop", handler: (event: SessionStopEvent) => Promise<SessionStopResult | void>): void;
  on(event: "session_shutdown", handler: () => void): void;
  on(event: "before_agent_start", handler: (event: BeforeAgentStartEvent) => void): void;
  exec(command: string, args: string[], options?: { timeout?: number }): Promise<ExecResult>;
}

// Persisted session state, matching hooks/lib/store.js's shape plus the
// fields core.decide() reads/writes.
interface GaslighterState {
  nudge_count?: number;
  turn_count?: number;
  last_turn_uuid?: string;
  last_request?: { prompt: string; ts: number };
}
type GaslighterConfig = Record<string, unknown>;
interface GaslighterStore {
  getDataDir(): string;
  getStatePath(sessionId: string): string;
  loadState(sessionId: string): GaslighterState;
  saveState(state: GaslighterState, sessionId: string): void;
  getConfigPath(): string;
  loadConfig(): GaslighterConfig;
  saveConfig(cfg: GaslighterConfig): void;
}
type SmartCheckResult = { status: "ok" } | { status: "gap"; reason: string } | { status: "failed"; error: string };

const SMART_CHECK_TIMEOUT_MS = 20000;
const TRIVIAL_MIN_LENGTH = 80;
const CAPTURE_MAX_LENGTH = 2000;
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function log(pi: ExtensionAPI, level: "warn" | "debug", event: string, extra?: Record<string, unknown>) {
  if (!process.env.GASLIGHTER_DEBUG) return;
  if (level === "warn") pi.logger.warn(`gaslighter: ${event}`, extra);
  else pi.logger.debug(`gaslighter: ${event}`, extra);
}

function isTrivialPrompt(prompt: string): boolean {
  const trimmed = (prompt || "").trim();
  return trimmed.length < TRIVIAL_MIN_LENGTH || trimmed.charAt(0) === "/";
}

async function runSmartCheck(
  pi: ExtensionAPI,
  cfg: GaslighterConfig,
  originalRequest: string,
  turn: { text: string } | null
): Promise<SmartCheckResult> {
  const prompt = engine.buildSmartCheckPrompt(originalRequest, (turn && turn.text) || "");
  const model = engine.resolveSmartModel(cfg);
  try {
    const result = await pi.exec(
      "omp",
      [
        "-p", prompt,
        "--model", model,
        "--mode", "json",
        "--no-tools", "--no-extensions", "--no-skills", "--no-session", "--no-title"
      ],
      { timeout: SMART_CHECK_TIMEOUT_MS }
    );
    if (result.code !== 0) return { status: "failed", error: result.stderr || `omp exited ${result.code}` };
    const text = ompLib.parseSmartStreamOutput(result.stdout);
    const parsed = engine.extractSmartJson(text);
    if (parsed && parsed.ok === true) return { status: "ok" };
    if (parsed && parsed.ok === false) return { status: "gap", reason: parsed.reason || "unspecified" };
    return { status: "failed", error: "unexpected response shape" };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

function cleanupSession(store: GaslighterStore, sessionId: string) {
  try { fs.unlinkSync(store.getStatePath(sessionId)); } catch (e) {}
  const dir = store.getDataDir();
  let files: string[] = [];
  try { files = fs.readdirSync(dir); } catch (e) {}
  const now = Date.now();
  for (const name of files) {
    if (!/^state-.*\.json$/.test(name)) continue;
    const p = path.join(dir, name);
    try {
      if (now - fs.statSync(p).mtimeMs > STATE_MAX_AGE_MS) fs.unlinkSync(p);
    } catch (e) {}
  }
}

function discoverSkillPaths(root: string): string[] {
  const skillsDir = path.join(root, "skills");
  try {
    return fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, "SKILL.md")))
      .map((entry) => path.join(skillsDir, entry.name, "SKILL.md"))
      .sort();
  } catch (e) {
    return [];
  }
}

export default function GaslighterExtension(pi: ExtensionAPI) {
  const store: GaslighterStore = createStore(env.resolveDataDir());
  let sessionId = env.resolveSessionId();

  pi.on("resources_discover", () => ({
    skillPaths: discoverSkillPaths(pluginRoot)
  }));

  pi.on("before_agent_start", (event) => {
    try {
      if (isTrivialPrompt(event.prompt)) return;
      const state: GaslighterState = store.loadState(sessionId);
      state.last_request = { prompt: event.prompt.slice(0, CAPTURE_MAX_LENGTH), ts: Date.now() };
      store.saveState(state, sessionId);
    } catch (e) {
      // never block the turn on capture failure
    }
  });

  pi.on("session_shutdown", () => {
    try { cleanupSession(store, sessionId); } catch (e) {}
  });

  pi.on("session_stop", async (event: SessionStopEvent): Promise<SessionStopResult | void> => {
    sessionId = event.session_id;
    const cfg: GaslighterConfig = store.loadConfig();
    const mode = engine.resolveMode(cfg);
    log(pi, "debug", "hook_invoked", { mode, session: sessionId });

    if (mode === "off") return;

    const state: GaslighterState = store.loadState(sessionId);

    const plan = await core.decide({
      mode,
      maxNudges: engine.resolveMaxNudges(mode, cfg),
      state,
      stopHookActive: event.stop_hook_active === true,
      nudgeOnReadOnly: engine.resolveNudgeOnReadOnly(cfg),
      getQuiet: (m: string) => engine.resolveQuiet(m, cfg),
      getTurn: async (staleUuid: string | null) =>
        ompLib.extractTurn(event.messages, ompLib.parseStaleIndex(staleUuid)),
      runSmartCheck: (st: GaslighterState, turn: { text: string } | null) => {
        const originalRequest =
          st.last_request?.prompt || ompLib.firstUserText(event.messages) || "(original request unavailable)";
        return runSmartCheck(pi, cfg, originalRequest, turn);
      },
      log: (evt: string, extra?: Record<string, unknown>) => log(pi, "debug", evt, extra)
    });

    if (plan.action === "exit") {
      store.saveState(state, sessionId);
      log(pi, "debug", `exit_${plan.reason}`, { nudge_count: state.nudge_count, session: sessionId });
      return;
    }

    store.saveState(state, sessionId);
    const d = plan.deliver;
    log(pi, "warn", "nudge_fired", { nudge_count: state.nudge_count, mode, session: sessionId });

    if (d.blocking) return { decision: "block", reason: d.text };
    return { continue: true, additionalContext: d.text };
  });
}
