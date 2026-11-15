// src/hook/run.ts: what each hook does. Pure of process I/O so tests can drive it.
//
//   session-start  SessionStart        sync   prune old sessions; after a
//                                              compaction, re-deliver guidance
//                                              that is still in force
//   prompt         UserPromptSubmit    sync   record the turn; deliver pending
//                                              guidance
//   judge          UserPromptSubmit    async  pair -> gate -> judge -> trigger.
//                                              Never blocks the developer:
//                                              Claude Code does not wait for an
//                                              async hook. A fire starts the
//                                              reflection in a detached worker
//                                              (reflect-worker), which outlives
//                                              the hook process.
//   tool           PostToolUse         sync   record the call; deliver pending
//                                              guidance mid-turn, before the
//                                              agent's next edit
//   tool-failed    PostToolUseFailure  sync   record the call as failed
//   stop           Stop                sync   record the agent's final reply
//
// What the recording keeps, and for how long, is in ./turns.ts. reflect never
// reads the session transcript.
//
// Contract inherited from v0.1 and kept: a hook never blocks, never fails the
// prompt, and exits 0. Every error becomes an `error` event in the session log.

import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { structuralGate } from "../detect/structural.js";
import { renderPriorTurn } from "../detect/render.js";
import { DEFAULT_JUDGE_MODEL, DEFAULT_REFLECTION_MODEL } from "../models.js";
import type { JudgeOptions, JudgeResult, JudgeThinking } from "../detect/judge.js";
import { isPushback } from "../detect/types.js";
import type { Pair } from "../detect/types.js";
import { MIN_PROMPT_CHARS, isBookkeeping, shortHash, stripWrappers } from "../transcript/parse.js";
import { pruneAgentTurns, recordCall, recordSaid, saveTurnText, takeAgentTurn, turnTextFor } from "./turns.js";
import { Accumulator, policyById, type TriggerPolicy } from "../trigger/accumulator.js";
import type { EvidenceTurn, ReflectionOptions, ReflectionResult } from "../reflect/reflection.js";
import { formatForAgent, formatMarkdown } from "../reflect/format.js";
import { capCostUSD } from "../pricing.js";
import { pluginMode, resolveApiKey } from "../api/credentials.js";
import { safeTruncate, safeTruncateEnd, redactString } from "../redact.js";
import {
  appendEvent,
  readEvents,
  isDisabled,
  pruneSessions,
  sessionDir,
  stateRoot,
  withLock,
  now,
  type HookEvent,
} from "./state.js";

export type HookMode = "session-start" | "prompt" | "judge" | "tool" | "tool-failed" | "stop";
export const HOOK_MODES: readonly HookMode[] = ["session-start", "prompt", "judge", "tool", "tool-failed", "stop"];
/** Internal: `node reflect-hook.mjs reflect-worker <projectDir> <sessionId> <firePromptId>`. */
export const WORKER_MODE = "reflect-worker";

const EVENT_NAME: Record<HookMode, string> = {
  "session-start": "SessionStart",
  prompt: "UserPromptSubmit",
  judge: "UserPromptSubmit",
  tool: "PostToolUse",
  "tool-failed": "PostToolUseFailure",
  stop: "Stop",
};

export interface HookInput {
  session_id?: string;
  prompt_id?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** Stop: the text of the agent's final message in the turn. */
  last_assistant_message?: string;
  /** Set when the hook fires inside a subagent. */
  agent_id?: string;
}

export interface HookDeps {
  env: NodeJS.ProcessEnv;
  judge: (pair: Pair, opts: JudgeOptions) => Promise<JudgeResult>;
  reflect: (turns: EvidenceTurn[], window: number, opts: ReflectionOptions) => Promise<ReflectionResult>;
  /** Tests inject a client; otherwise each call builds one from the key in `env`. */
  makeClient?: () => import("../api/client.js").MessagesClient;
  /**
   * Start the reflection for a fire in a process that outlives this one, and
   * return true if it started. Without it, or when it returns false, the judge
   * hook runs the reflection itself.
   */
  detach?: (projectDir: string, sessionId: string, firePromptId: string) => boolean;
}

// The model calls load the SDK on first use. SessionStart, the sync prompt hook
// and the PostToolUse hook never call a model, and run on every tool call, so
// they should not pay for parsing it.
export const defaultDeps = (env: NodeJS.ProcessEnv = process.env): HookDeps => ({
  env,
  judge: async (pair, opts) => (await import("../detect/judge.js")).judgePair(pair, opts),
  reflect: async (turns, window, opts) => (await import("../reflect/reflection.js")).callReflection(turns, window, opts),
  detach: spawnWorker,
});

/**
 * The reflection takes about ten seconds. `claude -p` ends its process, and the
 * async hook with it, as soon as the agent answers, which in a short turn is
 * sooner than that. A detached worker is not killed with it.
 */
function spawnWorker(projectDir: string, sessionId: string, firePromptId: string): boolean {
  const script = process.argv[1];
  if (!script || !existsSync(script)) return false;
  try {
    const child = spawn(process.execPath, [script, WORKER_MODE, projectDir, sessionId, firePromptId], {
      cwd: projectDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
    return child.pid !== undefined;
  } catch {
    return false;
  }
}

/** 401 and 403 from the API: retrying with the same key cannot succeed. */
function isAuthFailure(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

// ─── Config ───────────────────────────────────────────────────────────

export interface HookConfig {
  judgeModel: string;
  judgeThinking: JudgeThinking;
  reflectionModel: string;
  reflectionEffort: "low" | "medium" | "high" | "xhigh" | "max";
  policy: TriggerPolicy;
  maxUsdPerSession: number;
}

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * The key from the hook's own environment (the plugin setting, or outside the
 * plugin the environment merged with the project .env), so the SDK client never
 * falls back to a different one.
 */
function apiKeyOpt(env: NodeJS.ProcessEnv): { apiKey?: string } {
  const key = resolveApiKey(env);
  return key ? { apiKey: key } : {};
}

export function loadConfig(env: NodeJS.ProcessEnv): HookConfig {
  const effort = env["REFLECT_EFFORT"] || "high";
  // As a plugin, a value set in the plugin's settings wins over the environment.
  const plugin = pluginMode(env);
  const pick = (setting: string, envVar: string) =>
    plugin ? env[setting] || env[envVar] : env[envVar] || env[setting];
  const cap = Number(pick("CLAUDE_PLUGIN_OPTION_MAX_USD_PER_SESSION", "REFLECT_MAX_USD_PER_SESSION") || "0.5");
  return {
    judgeModel: env["REFLECT_JUDGE_MODEL"] || DEFAULT_JUDGE_MODEL,
    judgeThinking: env["REFLECT_JUDGE_THINKING"] === "adaptive" ? "adaptive" : "off",
    reflectionModel: pick("CLAUDE_PLUGIN_OPTION_REFLECTION_MODEL", "REFLECT_MODEL") || DEFAULT_REFLECTION_MODEL,
    reflectionEffort: (EFFORTS.has(effort) ? effort : "high") as HookConfig["reflectionEffort"],
    policy: policyById(env["REFLECT_POLICY"]),
    maxUsdPerSession: Number.isFinite(cap) && cap >= 0 ? cap : 0.5,
  };
}

const ENV_KEYS = /^(ANTHROPIC_API_KEY|REFLECT_[A-Z_]+)$/;

/** `"quoted"` or `'quoted'` as written; otherwise trimmed, with a trailing ` # comment` dropped. */
function dotenvValue(raw: string): string {
  const v = raw.trim();
  const q = /^(["'])(.*)\1$/.exec(v);
  if (q) return q[2] ?? "";
  return v.replace(/\s+#.*$/, "").trim();
}

/**
 * v0.1 told users to put ANTHROPIC_API_KEY in the project's .env. Keep that
 * working for hooks wired by hand and the CLI, but read only reflect's own
 * keys from it, and never override what the environment already says. An
 * installed plugin does not read the file at all: its key and settings come
 * from the plugin's settings.
 */
export function withProjectEnv(projectDir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  if (pluginMode(env)) return out;
  let raw: string;
  try {
    raw = readFileSync(join(projectDir, ".env"), "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (!m || !m[1] || !ENV_KEYS.test(m[1])) continue;
    if (out[m[1]] !== undefined && out[m[1]] !== "") continue;
    out[m[1]] = dotenvValue(m[2] ?? "");
  }
  return out;
}

// ─── Small helpers ────────────────────────────────────────────────────

/** A command such as `/compact`, or a message too short to be one: the agent's turn stays open past it. */
function isHarnessPrompt(prompt: string): boolean {
  const clean = stripWrappers(prompt);
  return clean.length < MIN_PROMPT_CHARS || isBookkeeping(clean);
}

export function promptIdOf(input: HookInput): string {
  if (input.prompt_id) return input.prompt_id;
  // Older Claude Code builds do not send prompt_id. Both UserPromptSubmit
  // hooks see the same prompt text, so a hash of it is the one id they can
  // agree on without talking to each other.
  return `h${shortHash(input.prompt ?? "")}`;
}

// Every note the agent receives is also shown to the developer, word for word,
// so nothing reaches the agent's context that the developer cannot see.
function output(mode: HookMode, context: string, again = false): string {
  const head = again
    ? "reflect sent the agent its current note again, because the conversation was compacted or resumed:"
    : "reflect sent the agent this note:";
  return JSON.stringify({
    systemMessage: `${head}\n\n${context}`,
    hookSpecificOutput: { hookEventName: EVENT_NAME[mode], additionalContext: context },
  });
}

type GuidanceEvent = Extract<HookEvent, { t: "guidance" }>;

export function pendingGuidance(events: HookEvent[]): GuidanceEvent | null {
  let last: GuidanceEvent | null = null;
  for (const e of events) if (e.t === "guidance") last = e;
  if (!last) return null;
  const id = last.id;
  return events.some((e) => e.t === "delivered" && e.id === id) ? null : last;
}

/** Delivered guidance still inside its expiry window, counted in developer turns. */
export function activeGuidance(events: HookEvent[]): GuidanceEvent | null {
  let last: GuidanceEvent | null = null;
  let deliveredAt = -1;
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as HookEvent;
    if (e.t === "guidance") {
      last = e;
      deliveredAt = -1;
    } else if (e.t === "delivered" && last && e.id === last.id && deliveredAt < 0) {
      deliveredAt = i;
    }
  }
  if (!last || deliveredAt < 0) return null;
  const turnsSince = events.slice(deliveredAt + 1).filter((e) => e.t === "prompt").length;
  return turnsSince < last.reflection.expires_after_turns ? last : null;
}

export function promptOrder(events: HookEvent[], current?: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const e of events) {
    if (e.t === "prompt" && !seen.has(e.promptId)) {
      seen.add(e.promptId);
      order.push(e.promptId);
    }
  }
  if (current && !seen.has(current)) order.push(current);
  return order;
}

export function sessionSpend(events: HookEvent[]): number {
  let usd = 0;
  for (const e of events) if (e.t === "verdict" || e.t === "guidance") usd += e.costUSD;
  return usd;
}

function contextFor(g: GuidanceEvent, events: HookEvent[]): string {
  const fire = [...events].reverse().find((e) => e.t === "fire" && e.promptId === g.promptId);
  const order = promptOrder(events);
  const turns =
    fire && fire.t === "fire" ? fire.evidence.map((id) => order.indexOf(id) + 1).filter((n) => n > 0) : [];
  const window = fire && fire.t === "fire" ? policyById(fire.policyId).window : 0;
  return formatForAgent(g.reflection, {
    pushbacks: turns.length,
    window,
    turns,
    ...(g.manual ? { manual: true } : {}),
  });
}

// ─── Hooks ────────────────────────────────────────────────────────────

export async function runHook(
  mode: HookMode,
  input: HookInput,
  projectDir: string,
  deps: HookDeps,
): Promise<string | null> {
  if (deps.env["REFLECT_INNER"] === "1") return null;
  if (isDisabled(projectDir, deps.env)) return null;
  const sessionId = input.session_id;
  if (!sessionId) return null;

  try {
    switch (mode) {
      case "session-start": {
        if (input.source === "startup") {
          pruneSessions(projectDir);
          pruneAgentTurns(projectDir);
        }
        if (input.source !== "compact" && input.source !== "resume") return null;
        // Compaction rewrites the context the guidance was delivered into.
        // Re-deliver what is still in force so a long session keeps it.
        const events = readEvents(projectDir, sessionId);
        const g = activeGuidance(events) ?? pendingGuidance(events);
        if (!g) return null;
        appendEvent(projectDir, sessionId, { t: "delivered", at: now(), id: g.id, via: "session-start" });
        return output(mode, contextFor(g, events), true);
      }

      case "prompt": {
        const promptId = promptIdOf(input);
        appendEvent(projectDir, sessionId, {
          t: "prompt",
          at: now(),
          promptId,
          chars: (input.prompt ?? "").length,
          ...(isHarnessPrompt(input.prompt ?? "") ? { bookkeeping: true as const } : {}),
        });
        return deliver(mode, projectDir, sessionId);
      }

      case "tool":
      case "tool-failed":
        // A subagent's tool call: its context is thrown away when it returns,
        // so a note delivered there would never reach the main agent, and the
        // developer's next message answers the main agent, not the subagent.
        if (input.agent_id) return null;
        if (input.prompt_id && input.tool_name) {
          recordCall(projectDir, sessionId, input.prompt_id, input.tool_name, input.tool_input ?? {}, mode === "tool-failed");
        }
        return mode === "tool" ? deliver(mode, projectDir, sessionId) : null;

      case "stop":
        if (input.prompt_id && typeof input.last_assistant_message === "string") {
          recordSaid(projectDir, sessionId, input.prompt_id, input.last_assistant_message, now());
        }
        return null;

      case "judge":
        await judgeTurn(input, projectDir, sessionId, deps);
        return null;
    }
  } catch (e) {
    try {
      appendEvent(projectDir, sessionId, {
        t: "error",
        at: now(),
        where: mode,
        message: safeTruncate(redactString(e instanceof Error ? e.message : String(e)), 400),
      });
    } catch {
      /* the log itself is unwritable; stay silent rather than break the session */
    }
  }
  return null;
}

/**
 * True for exactly one caller per name in a session. Parallel tool calls run
 * their PostToolUse hooks at the same moment, and a worker could be started
 * twice for one fire; reading the log is not enough to stop either repeating.
 */
function claimOnce(projectDir: string, sessionId: string, name: string): boolean {
  try {
    closeSync(openSync(join(sessionDir(projectDir, sessionId), name.replace(/[^A-Za-z0-9_.-]/g, "_")), "wx"));
    return true;
  } catch {
    return false;
  }
}

function deliver(mode: HookMode, projectDir: string, sessionId: string): string | null {
  const events = readEvents(projectDir, sessionId);
  const g = pendingGuidance(events);
  if (!g) return null;
  if (!claimOnce(projectDir, sessionId, `delivered-${g.id}`)) return null;
  appendEvent(projectDir, sessionId, {
    t: "delivered",
    at: now(),
    id: g.id,
    via: mode === "tool" ? "tool" : "prompt",
  });
  return output(mode, contextFor(g, events));
}

export async function judgeTurn(
  input: HookInput,
  projectDir: string,
  sessionId: string,
  deps: HookDeps,
): Promise<void> {
  const cfg = loadConfig(deps.env);
  const promptId = promptIdOf(input);
  const log = (ev: HookEvent) => appendEvent(projectDir, sessionId, ev);

  // A bare `/compact` is not the developer answering the agent. The agent's
  // turn stays open, and the next real message is judged against all of it.
  if (isHarnessPrompt(input.prompt ?? "")) {
    log({ t: "skip", at: now(), promptId, reason: "bookkeeping" });
    return;
  }

  // 1. The pair: what the agent did since the developer last spoke, and this
  //    message. The agent's turn is read once and deleted, before anything
  //    below can return, so it is never kept longer than it is needed.
  const before = readEvents(projectDir, sessionId);
  const order = promptOrder(before, promptId);
  const idx = order.indexOf(promptId);
  const harness = new Set(
    before.filter((e) => e.t === "prompt" && e.bookkeeping).map((e) => (e as { promptId: string }).promptId),
  );
  const since: string[] = [];
  for (let i = idx - 1; i >= 0; i--) {
    const id = order[i] as string;
    since.unshift(id);
    if (!harness.has(id)) break;
  }
  const promptIndex = order.slice(0, idx).filter((id) => !harness.has(id)).length;
  const pair: Pair = {
    pairId: `${sessionId}:${promptIndex}`,
    sessionId,
    project: "",
    promptIndex,
    prompt: stripWrappers(input.prompt ?? ""),
    promptAt: now(),
    prior: takeAgentTurn(projectDir, sessionId, since),
    // Only Stage A's score reads this, and the hooks use Stage A as a gate alone.
    recentTargets: [],
    sidechain: false,
  };

  if (before.some((e) => e.t === "error" && e.where === "auth")) return;
  if (sessionSpend(before) >= cfg.maxUsdPerSession) {
    if (!before.some((e) => e.t === "skip" && e.reason === "budget")) {
      log({ t: "skip", at: now(), promptId, reason: "budget" });
    }
    return;
  }

  // 2. Stage A. Its one hard rule: no prior agent turn, nothing to push back on.
  const gate = structuralGate(pair);
  if (!gate.pass) {
    log({ t: "skip", at: now(), promptId, reason: gate.reason });
    return;
  }

  // 3. Stage C. One Claude Haiku 5.5 call, roughly $0.0005.
  let result: JudgeResult;
  try {
    result = await deps.judge(pair, {
      ...(deps.makeClient ? { client: deps.makeClient() } : apiKeyOpt(deps.env)),
      model: cfg.judgeModel,
      thinking: cfg.judgeThinking,
      effort: "low",
      maxRetries: 2,
      timeoutMs: 30_000,
    });
  } catch (e) {
    const auth = isAuthFailure(e);
    const noKey = e instanceof Error && /api[_ ]?key|credential|authentication/i.test(e.message) && typeof (e as { status?: unknown }).status !== "number";
    log({
      t: "error",
      at: now(),
      where: auth || noKey ? "auth" : "judge",
      message: safeTruncate(redactString(e instanceof Error ? e.message : String(e)), 400),
    });
    return;
  }
  const u = result.usage;
  const cost = capCostUSD(u.model, {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheCreation1hTokens: u.cacheCreationTokens,
  });
  const prior = renderPriorTurn(pair);
  log({
    t: "verdict",
    at: now(),
    promptId,
    label: result.verdict.label,
    confidence: result.verdict.confidence,
    model: u.model,
    costUSD: cost,
    latencyMs: u.latencyMs,
  });
  saveTurnText(
    projectDir,
    sessionId,
    promptId,
    {
      prompt: safeTruncate(redactString(pair.prompt), 1500),
      priorSummary: prior.length > 2000 ? "…" + safeTruncateEnd(prior, 2000) : prior,
      evidence: redactString(result.verdict.evidence),
      rationale: redactString(result.verdict.rationale),
    },
    promptOrder(readEvents(projectDir, sessionId), promptId),
  );

  // A verdict that is not pushback cannot complete a pattern.
  if (!isPushback(result.verdict.label)) return;

  // 4. The trigger, replayed over the whole session under a lock so two judges
  //    finishing together cannot both fire on the same pattern.
  const fired = await withLock(projectDir, sessionId, async () => {
    const events = readEvents(projectDir, sessionId);
    const order = promptOrder(events, promptId);
    const verdicts = new Map<string, Extract<HookEvent, { t: "verdict" }>>();
    for (const e of events) if (e.t === "verdict") verdicts.set(e.promptId, e);
    const recorded = events.filter((e): e is Extract<HookEvent, { t: "fire" }> => e.t === "fire");
    const alreadyFired = new Set(recorded.map((e) => e.promptId));
    // A late verdict can move where the replay fires. Turns that already took
    // part in a recorded fire never trip a second one.
    const spent = new Set(recorded.flatMap((e) => e.evidence));
    const acc = new Accumulator(cfg.policy);
    let hit: { promptId: string; evidence: string[] } | null = null;
    for (const pid of order) {
      const v = verdicts.get(pid);
      const sig = v && isPushback(v.label) ? { label: v.label, confidence: v.confidence } : null;
      const fire = acc.observe(pid, sig);
      // Only a fire this verdict takes part in is ours to act on; verdicts can
      // arrive out of order when prompts are sent in quick succession.
      if (fire && !alreadyFired.has(pid) && fire.evidence.includes(promptId) && !fire.evidence.some((id) => spent.has(id))) {
        hit = { promptId: pid, evidence: fire.evidence };
      }
    }
    if (!hit) return null;
    appendEvent(projectDir, sessionId, {
      t: "fire",
      at: now(),
      promptId: hit.promptId,
      evidence: hit.evidence,
      policyId: cfg.policy.id,
    });
    return hit;
  });
  if (!fired) return;

  // 5. The reflection, outside the lock and if possible outside this process.
  if (deps.detach?.(projectDir, sessionId, fired.promptId)) return;
  await reflectForFire(projectDir, sessionId, fired.promptId, deps);
}

/**
 * Write the note for a recorded fire. Runs in the worker, or in the judge hook
 * when the worker cannot start. A second call for the same fire does nothing.
 */
export async function reflectForFire(
  projectDir: string,
  sessionId: string,
  firePromptId: string,
  deps: HookDeps,
): Promise<void> {
  const cfg = loadConfig(deps.env);
  const events = readEvents(projectDir, sessionId);
  const fire = events.find((e): e is Extract<HookEvent, { t: "fire" }> => e.t === "fire" && e.promptId === firePromptId);
  if (!fire) return;
  if (!claimOnce(projectDir, sessionId, `reflecting-${firePromptId}`)) return;

  const order = promptOrder(events);
  const verdicts = new Map<string, Extract<HookEvent, { t: "verdict" }>>();
  for (const e of events) if (e.t === "verdict") verdicts.set(e.promptId, e);
  const turns = evidenceTurns(
    projectDir,
    sessionId,
    fire.evidence.map((pid) => verdicts.get(pid)).filter((v): v is Extract<HookEvent, { t: "verdict" }> => v !== undefined),
    order,
  );

  // The judge checked the cap before its call; the reflection costs far more, so check again.
  if (sessionSpend(events) >= cfg.maxUsdPerSession) {
    appendEvent(projectDir, sessionId, { t: "skip", at: now(), promptId: firePromptId, reason: "budget" });
    return;
  }
  await reflectAndRecord(turns, cfg, projectDir, sessionId, firePromptId, deps, false);
}

/** Judged messages as the reflection reads them. A message whose text was already dropped is left out. */
export function evidenceTurns(
  projectDir: string,
  sessionId: string,
  verdicts: Array<Extract<HookEvent, { t: "verdict" }>>,
  order: string[],
): EvidenceTurn[] {
  const out: EvidenceTurn[] = [];
  for (const v of verdicts) {
    const text = turnTextFor(projectDir, sessionId, v);
    if (!text) continue;
    out.push({
      turn: order.indexOf(v.promptId) + 1,
      label: v.label,
      confidence: v.confidence,
      priorSummary: text.priorSummary,
      prompt: text.prompt,
      evidence: text.evidence,
    });
  }
  return out;
}

export async function reflectAndRecord(
  turns: EvidenceTurn[],
  cfg: HookConfig,
  projectDir: string,
  sessionId: string,
  promptId: string,
  deps: HookDeps,
  manual: boolean,
): Promise<(ReflectionResult & { guidanceId: string }) | null> {
  let res: ReflectionResult;
  try {
    res = await deps.reflect(turns, manual ? turns.length : cfg.policy.window, {
      ...(deps.makeClient ? { client: deps.makeClient() } : apiKeyOpt(deps.env)),
      model: cfg.reflectionModel,
      effort: cfg.reflectionEffort,
      ...(manual
        ? {
            intro:
              `The developer asked for a reflection by hand. These are their last ${turns.length} turns ` +
              "that the classifier saw, oldest first; some may not be pushback at all. If nothing in them " +
              "needs adjusting, say so in the adjustment and set confidence low.",
          }
        : {}),
    });
  } catch (e) {
    appendEvent(projectDir, sessionId, {
      t: "error",
      at: now(),
      where: "reflection",
      message: safeTruncate(redactString(e instanceof Error ? e.message : String(e)), 400),
    });
    return null;
  }
  const at = now();
  const id = `g${shortHash(sessionId + promptId + at)}`;
  appendEvent(projectDir, sessionId, {
    t: "guidance",
    at,
    id,
    promptId,
    reflection: res.reflection,
    model: res.model,
    costUSD: res.costUSD,
    latencyMs: res.latencyMs,
    ...(manual ? { manual: true } : {}),
  });
  try {
    writeFileSync(
      join(stateRoot(projectDir), "session-guidance.md"),
      formatMarkdown(res.reflection, {
        pushbacks: turns.length,
        window: cfg.policy.window,
        turns: turns.map((t) => t.turn),
        at,
        model: res.model,
        costUSD: res.costUSD,
        ...(manual ? { manual: true } : {}),
      }),
      "utf8",
    );
  } catch {
    /* the event log is the record; the markdown file is a convenience */
  }
  return { ...res, guidanceId: id };
}

export function projectDirOf(input: HookInput, env: NodeJS.ProcessEnv): string {
  const fromEnv = env["CLAUDE_PROJECT_DIR"];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd();
}
