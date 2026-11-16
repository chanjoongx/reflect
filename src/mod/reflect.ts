// src/mod/reflect.ts: reflect as a Claude Code mod (function hooks).
//
// For each message the developer sends, reflect pairs it with what the agent
// did just before and asks Claude Haiku 5.5 whether the message pushes back on
// the agent. When two messages within six turns do, Claude Opus 5.5 reads those
// turns and writes a short note on what the agent keeps missing. The note goes
// to the agent once, with its next tool result or the developer's next message,
// and the developer sees the same note word for word in the transcript.
//
// Everything goes through Claude Code. The model calls use the session's own
// model client ($.model.complete), billed like the session's other requests,
// so the plugin has no API key, no network access of its own, no shell command
// and no file access, and it never reads the transcript. What it keeps lives
// in memory for the session and is gone when the session ends.
//
// The plugin's plugin/hooks/reflect.ts is generated from this file and the
// src/ modules it imports (scripts/build-hook.mjs), so the plugin ships one
// code file and judges and reflects with the same prompts as the npm package.

import type { Register } from "claude-code";
import { answerAsJson, parseLoose } from "../detect/answer-format.js";
import { JUDGE_SYSTEM, VERDICT_SCHEMA, buildUserMessage, parseVerdict } from "../detect/judge-prompt.js";
import { renderPriorTurn } from "../detect/render.js";
import { isPushback, type JudgeVerdict, type Label, type Pair, type ToolCall } from "../detect/types.js";
import { DEFAULT_JUDGE_MODEL, DEFAULT_REFLECTION_EFFORT, DEFAULT_REFLECTION_MODEL } from "../models.js";
import { capCostUSD } from "../pricing.js";
import { redactString, safeTruncate, safeTruncateEnd } from "../redact.js";
import { formatForAgent } from "../reflect/format.js";
import { REFLECTION_SYSTEM, buildReflectionInput, type EvidenceTurn } from "../reflect/reflection-prompt.js";
import { REFLECTION_SCHEMA, parseReflection2, type Reflection2 } from "../reflect/schema.js";
import { MIN_PROMPT_CHARS, isBookkeeping, isMutating, stripWrappers, toolTarget } from "../transcript/text.js";
import { Accumulator, defaultPolicy } from "../trigger/accumulator.js";

const POLICY = defaultPolicy();
const DEFAULT_MAX_USD = 0.5;
/** Judged messages whose text is kept for a reflection, as in the npm package. */
const KEPT_TEXTS = 12;
const MAX_CALLS_PER_TURN = 50;
const MAX_AGENT_TEXT = 4000;
/** A context under half its size at the last look means the conversation was compacted. */
const COMPACTED_BELOW = 0.5;
const COMPACTION_FLOOR_TOKENS = 20_000;

/** Where a developer's own message comes from: typed, sent from a phone or web client, or a `claude -p` turn. */
const DEVELOPER_ORIGINS = new Set(["composer", "bridge", "sdk"]);
/** What an alias costs, for the spend cap, if the engine had to fall back to one. */
const ALIAS_PRICED_AS: Record<string, string> = {
  haiku: DEFAULT_JUDGE_MODEL,
  opus: DEFAULT_REFLECTION_MODEL,
  sonnet: "claude-sonnet-5-5",
};

const SHOWN_HEAD = "reflect sent the agent this note:";
const STATUS_COMMAND = "reflect-status";
const SHOWN_AGAIN = "reflect sent the agent its current note again, because the conversation was compacted:";

interface Verdict {
  label: Label;
  confidence: JudgeVerdict["confidence"];
}

interface TurnText {
  prompt: string;
  priorSummary: string;
  evidence: string;
}

interface Note {
  context: string;
  reflection: Reflection2;
  /** How many developer messages there had been when the agent received it. */
  deliveredAt: number;
}

interface Job {
  promptId: string;
  pair: Pair;
}

interface Settings {
  maxUSD: number;
  reflectionModel: string;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ModelRequest {
  model: string;
  system: readonly { text: string; cache?: true }[];
  prompt: string;
  maxTokens: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs: number;
}

type Completion =
  | { isAnswered: true; text: string; usage?: Usage }
  | { isAnswered: false; reason: string; status?: number | null; usage?: Usage };

/**
 * What the judge and the reflection need from Claude Code. They run on a timer
 * after the hook that queued them has returned, and a hook may name the engine
 * only in a call written out where it is made, so session.start binds these
 * four calls once and the background work goes through them.
 */
interface Engine {
  complete(request: ModelRequest): Promise<Completion>;
  log(text: string): void;
  debug(text: string): void;
  soon(fn: () => void): void;
}

/** What reflect knows about the current session. Nothing here is written anywhere. */
class Session {
  /** Developer messages in order, by id: the turns the trigger counts. */
  prompts: string[] = [];
  /** What the agent has done since the developer last spoke. */
  calls: ToolCall[] = [];
  said = "";
  hasAgentTurn = false;
  verdicts = new Map<string, Verdict>();
  texts = new Map<string, TurnText>();
  fires: Array<{ promptId: string; evidence: string[] }> = [];
  spentUSD = 0;
  /** Set when the model calls stop for the rest of the session. */
  stopped: string | null = null;
  pending: Omit<Note, "deliveredAt"> | null = null;
  active: Note | null = null;
  /** Input tokens of the session's last response, when a note in force was last checked. */
  lastTokens: number | undefined = undefined;
  jobs: Job[] = [];
  draining: Promise<void> | null = null;
  judgeModel = DEFAULT_JUDGE_MODEL;
}

let session = new Session();
let engine: Engine | null = null;

export const register: Register = (on, options) => {
  const maxUSD = options["max_usd_per_session"];
  const model = options["reflection_model"];
  const settings: Settings = {
    maxUSD: typeof maxUSD === "number" && maxUSD > 0 ? maxUSD : DEFAULT_MAX_USD,
    reflectionModel: typeof model === "string" && model.trim() ? model.trim() : DEFAULT_REFLECTION_MODEL,
  };

  on("session.start", async ($, e, next) => {
    engine = {
      complete: (request) => $.model.complete(request),
      log: (text) => $.ui.log(text),
      debug: (text) => $.ui.log(text, { to: "debug" }),
      soon: (fn) => {
        $.clock.after(0, fn);
      },
    };
    try {
      await $.command.register({
        name: STATUS_COMMAND,
        description: "Show what reflect has judged, written and spent in this session",
        immediate: true,
      });
    } catch {
      // The command is a convenience; judging goes on without it.
    }
    return next(e);
  });

  // It only reads what is in memory, so it can answer while a turn is running.
  on("command.run", { command: STATUS_COMMAND }, async () => ({ text: statusText(settings) })).catch(() => ({
    text: "reflect could not show its status.",
  }));

  on("session.end", async ($, e, next) => {
    session = new Session();
    return next(e);
  });

  on("prompt.submit", async ($, e, next) => {
    // The same four calls, for a plugin turned on after its session started.
    engine ??= {
      complete: (request) => $.model.complete(request),
      log: (text) => $.ui.log(text),
      debug: (text) => $.ui.log(text, { to: "debug" }),
      soon: (fn) => {
        $.clock.after(0, fn);
      },
    };
    // Only the developer's own messages are judged. A background task's
    // notification, a scheduled prompt, another session's or a plugin's
    // message is passed on unread.
    if (e.isMeta) return next(e);
    const origin = (e as { origin?: { kind?: string } }).origin?.kind;
    if (origin !== undefined && !DEVELOPER_ORIGINS.has(origin)) return next(e);
    // A slash command with nothing after it is not the developer answering
    // the agent, and reflect's own command never is.
    const command = (e as { command?: { command?: string; args?: string } }).command;
    if (command && (command.command === STATUS_COMMAND || (command.args ?? "").trim().length < MIN_PROMPT_CHARS)) return next(e);
    const text = stripWrappers(e.text ?? "");
    // A bare `/compact` or `/clear` is not the developer answering the agent:
    // the agent's turn stays open and the next real message is judged against it.
    if (text.length < MIN_PROMPT_CHARS || isBookkeeping(text)) return next(e);

    queueJudgement(text, settings);

    let tokens: number | undefined;
    if (noteInPlay()) {
      try {
        tokens = tokensOf(await $.session.usage());
      } catch {
        // The figure only helps notice a compaction.
      }
    }
    const note = takeNote(tokens);
    if (!note) return next(e);
    $.ui.log(note.shown);
    return next({ ...e, context: [...(e.context ?? []), note.context] });
  }).catch(($, e, next) => next(e));

  // What the agent did: each main-loop tool call's name, target and whether it failed.
  on("tool.call", async ($, e, next) => {
    const r = await next(e);
    if (e.agentId !== undefined) return r;
    try {
      recordCall(String(e.tool), e as unknown as Record<string, unknown>, r.deny !== undefined || r.isError === true);
    } catch {
      // Recording is best effort; the tool's result goes back unchanged.
    }
    if (r.deny !== undefined || !noteInPlay()) return r;
    let tokens: number | undefined;
    try {
      tokens = tokensOf(await $.session.usage());
    } catch {
      // The figure only helps notice a compaction.
    }
    const note = takeNote(tokens);
    if (!note) return r;
    $.ui.log(note.shown);
    return { ...r, context: [...(r.context ?? []), note.context] };
  }).catch(($, e, next) => next(e));

  // What the agent said as it ended its turn.
  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    const { agentId, answer } = e as { agentId?: string; answer?: unknown };
    if (agentId === undefined && typeof answer === "string") {
      const s = session;
      const clean = redactString(answer).trim();
      if (clean) s.said = safeTruncateEnd(s.said ? `${s.said}\n\n${clean}` : clean, MAX_AGENT_TEXT);
      s.hasAgentTurn = true;
    }
    return r;
  });
};

// ─── The session's record ─────────────────────────────────────────────

/** Number the message, pair it with the agent's turn before it, and queue the judge. */
function queueJudgement(text: string, settings: Settings): void {
  const s = session;
  const promptId = `p${s.prompts.length + 1}`;
  s.prompts.push(promptId);
  const pair: Pair = {
    pairId: promptId,
    sessionId: "",
    project: "",
    promptIndex: s.prompts.length - 1,
    prompt: text,
    promptAt: null,
    prior: s.hasAgentTurn ? { text: s.said, toolCalls: s.calls, endedAt: null } : null,
    recentTargets: [],
    sidechain: false,
  };
  s.calls = [];
  s.said = "";
  s.hasAgentTurn = false;
  s.jobs.push({ promptId, pair });
  startWork(settings);
}

function recordCall(name: string, args: Record<string, unknown>, errored: boolean): void {
  const s = session;
  s.calls.push({
    name: safeTruncate(name, 80),
    target: safeTruncate(redactString(toolTarget(name, args)), 200),
    mutating: isMutating(name, args),
    errored,
  });
  if (s.calls.length > MAX_CALLS_PER_TURN) s.calls.splice(0, s.calls.length - MAX_CALLS_PER_TURN);
  s.hasAgentTurn = true;
}

// ─── Status ───────────────────────────────────────────────────────────

/** What `/reflect-status` prints. The agent reads it too, so it stays short. */
function statusText(settings: Settings): string {
  const s = session;
  const byLabel = new Map<string, number>();
  for (const v of s.verdicts.values()) if (isPushback(v.label)) byLabel.set(v.label, (byLabel.get(v.label) ?? 0) + 1);
  const pushbacks = [...byLabel.values()].reduce((a, b) => a + b, 0);
  const detail = pushbacks ? ` (${[...byLabel].map(([label, n]) => `${label} ${n}`).join(", ")})` : "";
  const lines = [
    "reflect in this session (kept in memory, gone when the session ends):",
    `- messages: ${s.prompts.length}, judged ${s.verdicts.size}${s.jobs.length ? `, ${s.jobs.length} waiting` : ""}`,
    `- pushback: ${pushbacks}${detail}`,
    `- notes written: ${s.fires.length}`,
    `- spent: $${s.spentUSD.toFixed(4)} of the $${settings.maxUSD.toFixed(2)} cap`,
  ];
  const left = s.active ? s.active.reflection.expires_after_turns - (s.prompts.length - s.active.deliveredAt) : 0;
  if (s.pending) lines.push("- a note is ready and goes to the agent with its next step");
  else if (s.active && left > 0) {
    const adj = s.active.reflection.adjustment;
    const shown = adj.length > 300 ? `${safeTruncate(adj, 300)}…` : adj;
    lines.push(`- note in force for ${left} more message${left === 1 ? "" : "s"}: ${shown}`);
  }
  else lines.push("- no note in force");
  if (s.stopped) lines.push(`- stopped: ${s.stopped}`);
  return lines.join("\n");
}

// ─── Delivery ─────────────────────────────────────────────────────────

/** Whether a note is waiting to go or still in force. */
function noteInPlay(): boolean {
  return session.pending !== null || session.active !== null;
}

/** Input tokens of the session's last response, from the figures the status line shows. */
function tokensOf(usage: unknown): number | undefined {
  const t = (usage as { context?: { tokens?: unknown } } | undefined)?.context?.tokens;
  return typeof t === "number" ? t : undefined;
}

/**
 * The note the agent should receive now, if any, and the line that shows it to
 * the developer. `tokens` is the session's context size, when Claude Code says.
 */
function takeNote(tokens: number | undefined): { context: string; shown: string } | null {
  const s = session;
  if (s.active && s.prompts.length - s.active.deliveredAt >= s.active.reflection.expires_after_turns) s.active = null;
  if (s.pending) {
    s.active = { ...s.pending, deliveredAt: s.prompts.length };
    s.pending = null;
    s.lastTokens = tokens;
    return { context: s.active.context, shown: `${SHOWN_HEAD}\n\n${s.active.context}` };
  }
  if (!s.active || tokens === undefined) return null;
  // A compaction drops the note from what the agent reads. reflect does not
  // read the conversation to see one: the context falling below half its size
  // says it, and the note goes again while it is in force.
  const before = s.lastTokens;
  s.lastTokens = tokens;
  if (before === undefined || before < COMPACTION_FLOOR_TOKENS || tokens >= before * COMPACTED_BELOW) return null;
  return { context: s.active.context, shown: `${SHOWN_AGAIN}\n\n${s.active.context}` };
}

// ─── Model calls ──────────────────────────────────────────────────────

/**
 * Judge the queued messages one at a time on a timer, after the hook that
 * queued them, so the developer's message is never held up by a model call.
 */
function startWork(settings: Settings): void {
  const s = session;
  const eng = engine;
  if (s.draining || !eng) return;
  const run = async () => {
    try {
      while (s.jobs.length && s === session) await judgeJob(eng, s, s.jobs.shift() as Job, settings);
    } finally {
      s.draining = null;
      if (s.jobs.length && s === session) startWork(settings);
    }
  };
  s.draining = new Promise<void>((resolve) => {
    eng.soon(() => {
      void run().then(resolve, resolve);
    });
  });
}

// @plugin-omit-start: test helpers, left out of the plugin's copy
/** Resolves once the queued work is done. Tests use it; the engine does not. */
export async function idle(): Promise<void> {
  while (session.draining) await session.draining;
}

/** Drop everything this session knows. Tests use it; the engine does not. */
export function resetForTest(): void {
  session = new Session();
  engine = null;
}
// @plugin-omit-end

function costOf(model: string, u: Usage | undefined): number {
  if (!u) return 0;
  return capCostUSD(ALIAS_PRICED_AS[model] ?? model, {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreation5mTokens: u.cache_creation_input_tokens ?? 0,
  });
}

const errorText = (e: unknown): string => safeTruncate(redactString(String(e instanceof Error ? e.message : e)), 160);

/** Stop calling models for the rest of the session and say why, once. */
function stop(eng: Engine, s: Session, why: string): void {
  if (s.stopped) return;
  s.stopped = why;
  eng.log(`reflect stopped for this session: ${why}`);
}

/**
 * One completion. A model the engine will not send to (not allowed here, or an
 * id this provider does not know) is tried once more under its alias.
 */
async function complete(eng: Engine, request: ModelRequest, alias: string): Promise<{ r: Completion; model: string }> {
  try {
    return { r: await eng.complete(request), model: request.model };
  } catch (first) {
    if (request.model === alias) throw first;
    return { r: await eng.complete({ ...request, model: alias }), model: alias };
  }
}

function failed(eng: Engine, s: Session, what: string, r: Completion): void {
  if (r.isAnswered) return;
  if (r.reason === "api-error" && (r.status === 401 || r.status === 403)) {
    stop(eng, s, `the ${what} call was refused (HTTP ${r.status}).`);
    return;
  }
  eng.debug(`reflect: the ${what} call returned no answer (${r.reason}${r.status ? ` ${r.status}` : ""}).`);
}

async function judgeJob(eng: Engine, s: Session, job: Job, settings: Settings): Promise<void> {
  const { promptId, pair } = job;
  // No agent turn before this message (the session's first, or two messages in
  // a row): nothing to push back on, and no model call.
  if (!pair.prior || s.stopped) return;
  if (s.spentUSD >= settings.maxUSD) return stop(eng, s, `it reached its spend cap of $${settings.maxUSD.toFixed(2)}.`);

  let call: { r: Completion; model: string };
  try {
    call = await complete(
      eng,
      {
        model: s.judgeModel,
        system: [{ text: JUDGE_SYSTEM, cache: true }],
        prompt: `${buildUserMessage(pair, false)}\n\n${answerAsJson(VERDICT_SCHEMA)}`,
        maxTokens: 2000,
        // The measured judge runs at low effort with thinking off. Left unset,
        // the engine would use the model's own default effort.
        effort: "low",
        timeoutMs: 30_000,
      },
      "haiku",
    );
  } catch (e) {
    return stop(eng, s, `the judge model could not be called (${errorText(e)}).`);
  }
  const { r, model } = call;
  s.judgeModel = model;
  s.spentUSD += costOf(model, r.usage);
  if (!r.isAnswered) return failed(eng, s, "judge", r);
  let verdict: JudgeVerdict;
  try {
    verdict = parseLoose(r.text, parseVerdict);
  } catch (e) {
    // One unreadable answer skips this message. It does not stop the session.
    eng.debug(`reflect: the judge's answer could not be read (${errorText(e)}); this message was not judged.`);
    return;
  }

  s.verdicts.set(promptId, { label: verdict.label, confidence: verdict.confidence });
  const prior = renderPriorTurn(pair);
  s.texts.set(promptId, {
    prompt: safeTruncate(redactString(pair.prompt), 1500),
    priorSummary: prior.length > 2000 ? "…" + safeTruncateEnd(prior, 2000) : prior,
    evidence: redactString(verdict.evidence),
  });
  for (const id of [...s.texts.keys()].slice(0, Math.max(0, s.texts.size - KEPT_TEXTS))) s.texts.delete(id);

  // A verdict that is not pushback cannot complete a pattern.
  if (!isPushback(verdict.label)) return;

  // Replay the trigger over the session. Turns that already took part in a
  // fire never trip a second one.
  const fired = new Set(s.fires.map((f) => f.promptId));
  const used = new Set(s.fires.flatMap((f) => f.evidence));
  const acc = new Accumulator(POLICY);
  let hit: { promptId: string; evidence: string[] } | null = null;
  for (const id of s.prompts) {
    const v = s.verdicts.get(id);
    const fire = acc.observe(id, v && isPushback(v.label) ? { label: v.label, confidence: v.confidence } : null);
    if (fire && !fired.has(id) && fire.evidence.includes(promptId) && !fire.evidence.some((x) => used.has(x))) {
      hit = { promptId: id, evidence: fire.evidence };
    }
  }
  if (!hit) return;
  s.fires.push(hit);
  await reflectOn(eng, s, hit.evidence, settings);
}

async function reflectOn(eng: Engine, s: Session, evidence: string[], settings: Settings): Promise<void> {
  if (s.stopped) return;
  // The reflection costs far more than a judgement, so check the cap again.
  if (s.spentUSD >= settings.maxUSD) return stop(eng, s, `it reached its spend cap of $${settings.maxUSD.toFixed(2)}.`);
  const turns: EvidenceTurn[] = [];
  for (const id of evidence) {
    const v = s.verdicts.get(id);
    const t = s.texts.get(id);
    if (!v || !t) continue;
    turns.push({ turn: s.prompts.indexOf(id) + 1, label: v.label, confidence: v.confidence, ...t });
  }
  if (turns.length === 0) return;

  let reflection: Reflection2;
  try {
    const { r, model } = await complete(
      eng,
      {
        model: settings.reflectionModel,
        system: [{ text: REFLECTION_SYSTEM, cache: true }],
        prompt: `${buildReflectionInput(turns, POLICY.window)}\n\n${answerAsJson(REFLECTION_SCHEMA)}`,
        maxTokens: 8000,
        effort: DEFAULT_REFLECTION_EFFORT,
        timeoutMs: 180_000,
      },
      "opus",
    );
    s.spentUSD += costOf(model, r.usage);
    if (!r.isAnswered) return failed(eng, s, "reflection", r);
    reflection = parseLoose(r.text, parseReflection2);
  } catch (e) {
    eng.debug(`reflect: no reflection (${errorText(e)}).`);
    return;
  }
  if (s !== session) return;
  s.pending = {
    reflection,
    context: formatForAgent(reflection, { pushbacks: turns.length, window: POLICY.window, turns: turns.map((t) => t.turn) }),
  };
}
