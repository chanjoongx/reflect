// src/transcript/parse.ts — Claude Code transcript (.jsonl) → Pair[]
//
// Schema verified against local transcripts (CLI v2.1.232, Aug 2026):
//   type: user | assistant | attachment | system | mode | permission-mode
//       | last-prompt | ai-title | queue-operation | file-history-*
//
// A "real user prompt" is a `user` event that is not isMeta, whose message
// content carries user-authored text rather than tool results. Tool results
// also arrive as `user` events — distinguishing them is the single most
// error-prone part of this parser, so it is done explicitly and tested.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import type { Pair, PriorTurn, ToolCall } from "../detect/types.js";
import { isMutating, toolTarget, stripWrappers, MIN_PROMPT_CHARS, isBookkeeping } from "./text.js";
export { isMutating, toolTarget, stripWrappers, MIN_PROMPT_CHARS, isBookkeeping };

// ─── Raw event shapes (only the fields we rely on) ────────────────────

interface RawEvent {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  toolUseResult?: unknown;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
  };
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  is_error?: boolean;
  content?: unknown;
  tool_use_id?: string;
}

// ─── Content extraction ───────────────────────────────────────────────

function asBlocks(content: unknown): ContentBlock[] {
  if (Array.isArray(content)) return content as ContentBlock[];
  return [];
}

/**
 * User-authored text, or null when this `user` event is a tool-result carrier
 * / system injection rather than something the human typed.
 */
function userPromptText(ev: RawEvent): string | null {
  if (ev.isMeta === true) return null;
  const content = ev.message?.content;

  if (typeof content === "string") {
    return content.trim() ? content : null;
  }

  const blocks = asBlocks(content);
  if (blocks.length === 0) return null;

  // Any tool_result block ⇒ this event is the harness returning tool output.
  if (blocks.some((b) => b.type === "tool_result")) return null;

  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();

  return text || null;
}


function assistantParts(ev: RawEvent): { text: string; calls: ToolCall[] } {
  const blocks = asBlocks(ev.message?.content);
  let text = "";
  const calls: ToolCall[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") {
      text += (text ? "\n" : "") + b.text;
    } else if (b.type === "tool_use") {
      const name = String(b.name ?? "");
      const input = (b.input ?? {}) as Record<string, unknown>;
      const id = (b as { id?: string }).id;
      calls.push({
        ...(id ? { id } : {}),
        name,
        target: toolTarget(name, input),
        mutating: isMutating(name, input),
        errored: false,
      });
    }
  }
  return { text, calls };
}

/**
 * The `tool_use_id` a tool-result carrier is answering, when it says.
 *
 * Without this an error is pinned to whichever call happened to be last,
 * which is right for the strictly sequential case and wrong for a parallel
 * batch or an out-of-order result. Measured: 28 of 777 error results in the
 * corpus answer a call that is not the last one in flight — and the wrong
 * flag is not just a miscount, it prints `- Grep: foo [error]` into the
 * judge's prompt and tells Stage C the wrong tool failed.
 */
function erroredToolUseId(ev: RawEvent): string | null {
  const blocks = asBlocks(ev.message?.content);
  for (const b of blocks) {
    if (b.type === "tool_result" && b.is_error === true && b.tool_use_id) {
      return b.tool_use_id;
    }
  }
  const r = ev.toolUseResult;
  if (r && typeof r === "object") {
    const id = (r as Record<string, unknown>)["tool_use_id"];
    if (typeof id === "string") return id;
  }
  return null;
}

/** Detect a tool error inside a `user` tool-result carrier event. */
function toolResultErrored(ev: RawEvent): boolean {
  const blocks = asBlocks(ev.message?.content);
  if (blocks.some((b) => b.type === "tool_result" && b.is_error === true)) return true;
  const r = ev.toolUseResult;
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    if (o["is_error"] === true) return true;
    const s = typeof o["stderr"] === "string" ? o["stderr"] : "";
    if (s && /\berror\b|\bTraceback\b|command not found/i.test(s)) return true;
  }
  return false;
}

// ─── Target reference matching ────────────────────────────────────────

/**
 * Distinctive tokens from a target path, for prompt-mention matching.
 *
 * The bar is deliberately high. `referencesPriorTarget` is one of the stronger
 * structural features, so a token that fires on ordinary prose ("index", "app",
 * "main") would inflate the score on messages that never mentioned a file. Only
 * a filename of four or more characters counts, and a bare stem must be five or
 * more and not one of the generic names that recur in every repository.
 */
const GENERIC_STEMS = new Set([
  "index", "main", "types", "utils", "config", "test", "tests", "setup",
  "common", "shared", "helper", "helpers", "public", "assets", "styles",
  "readme", "package", "script", "scripts", "server", "client", "route",
  "routes", "model", "models", "component", "components", "output", "input",
]);

export function targetTokens(target: string): string[] {
  const out = new Set<string>();
  const base = basename(target.replace(/\\/g, "/"));
  if (!base || !/[A-Za-z0-9]/.test(base)) return [];
  if (base.length >= 4) out.add(base.toLowerCase());
  const stem = base.replace(/\.[A-Za-z0-9]+$/, "").toLowerCase();
  if (stem.length >= 5 && !GENERIC_STEMS.has(stem)) out.add(stem);
  return [...out];
}

// ─── Session parsing ──────────────────────────────────────────────────

export interface SessionPairs {
  sessionId: string;
  project: string;
  file: string;
  pairs: Pair[];
  /** Total real user prompts (== pairs.length). */
  promptCount: number;
  toolCallCount: number;
  /** `user` events that were pure harness injection and not user turns. */
  droppedHarness: number;
}

const RECENT_TURN_WINDOW = 3;

/**
 * Stable 6-hex digest of a string. Used only to break `pairId` collisions, so
 * it needs to be deterministic and cheap, not cryptographic.
 */
export function shortHash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}

export interface WalkOptions {
  sidechain?: boolean;
  idSuffix?: string;
  /** Session id to use when the transcript carries none. */
  fallbackId?: string;
  /** Pair-id stem when the transcript carries no sessionId (defaults to fallbackId). */
  pairIdFallback?: string;
  project?: string;
}

/** The assistant turn still open at the end of a transcript: what the next prompt answers. */
export interface PendingTurn {
  prior: PriorTurn | null;
  recentTargets: string[];
  promptIndex: number;
}

export interface WalkResult {
  sessionId: string;
  pairs: Pair[];
  toolCallCount: number;
  droppedHarness: number;
  pending: PendingTurn;
}

/**
 * The one transcript walker. `parseSessionFile` (the benchmark) and
 * `pairForPrompt` (the live hook) both go through it, so the hook judges
 * exactly the pair shape the benchmark measured.
 */
export function walkTranscript(raw: string, opts: WalkOptions = {}): WalkResult {
  const wantSidechain = opts.sidechain === true;
  // `sessionId:promptIndex` is NOT unique: a session that outlives a project
  // directory rename is written into two project folders under the same id, so
  // two entirely different prompts collide on `<session>:0`. Measured once in
  // 836 pairs, small, but it silently attaches one prompt's label to another,
  // which is the kind of error that stays invisible while it scales. The
  // caller passes a suffix for exactly the sessions where that happens; ids
  // for unambiguous sessions are left untouched so an existing label cache
  // stays valid.
  const suffix = opts.idSuffix ? `:${opts.idSuffix}` : "";
  const fallbackId = opts.fallbackId ?? "session";
  const pairIdFallback = opts.pairIdFallback ?? fallbackId;
  const project = opts.project ?? "";

  const pairs: Pair[] = [];
  let sessionId = "";
  let promptIndex = 0;
  let toolCallCount = 0;
  let droppedHarness = 0;

  // Accumulator for the assistant turn currently in flight.
  let curText = "";
  let curCalls: ToolCall[] = [];
  let curEndedAt: string | null = null;
  let sawAnyTurn = false;
  /** targets from the last N completed turns, most recent first */
  const turnTargets: string[][] = [];

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let ev: RawEvent;
    try {
      ev = JSON.parse(line) as RawEvent;
    } catch {
      continue;
    }

    if (ev.sessionId && !sessionId) sessionId = ev.sessionId;

    const side = ev.isSidechain === true;
    if (side !== wantSidechain) continue;

    if (ev.type === "assistant") {
      const { text, calls } = assistantParts(ev);
      if (text) curText += (curText ? "\n" : "") + text;
      if (calls.length) {
        curCalls.push(...calls);
        toolCallCount += calls.length;
      }
      // `endedAt` is the last time the ASSISTANT spoke, not the last event of
      // any kind. Letting dropped harness traffic (background-task
      // notifications, `!` command echoes) advance it made `gapSeconds`
      // measure the wrong interval in 26 of 573 real prompts: median 173 s
      // understated, worst case 17.8 hours, and 7 prompts flipped from
      // `staleGap` to `fastReply`, a 0.75-logit swing on a scored feature.
      if (ev.timestamp) curEndedAt = ev.timestamp;
      sawAnyTurn = true;
      continue;
    }

    if (ev.type !== "user") continue;

    const rawText = userPromptText(ev);

    if (rawText === null) {
      // tool-result carrier or meta: mark errors on the in-flight turn
      if (toolResultErrored(ev) && curCalls.length) {
        const id = erroredToolUseId(ev);
        const target = id ? curCalls.find((c) => c.id === id) : undefined;
        const fallback = curCalls[curCalls.length - 1];
        const hit = target ?? fallback;
        if (hit) hit.errored = true;
      }
      continue;
    }

    const prompt = stripWrappers(rawText);
    if (prompt.length < MIN_PROMPT_CHARS || isBookkeeping(prompt)) {
      // Pure harness traffic (task notification, `!` command echo, hook
      // preamble with no prose). Not a user turn: the assistant turn stays
      // open so the next real prompt sees everything done since the human
      // last spoke.
      droppedHarness++;
      continue;
    }

    const prior: PriorTurn | null = sawAnyTurn
      ? { text: curText, toolCalls: curCalls, endedAt: curEndedAt }
      : null;

    const recentTargets = turnTargets.flat();

    pairs.push({
      pairId: `${sessionId || pairIdFallback}${suffix}:${promptIndex}`,
      sessionId: sessionId || fallbackId,
      project,
      promptIndex,
      prompt,
      promptAt: ev.timestamp ?? null,
      prior,
      recentTargets,
      sidechain: wantSidechain,
    });

    // close the turn
    turnTargets.unshift(curCalls.map((c) => c.target).filter(Boolean));
    while (turnTargets.length > RECENT_TURN_WINDOW) turnTargets.pop();
    promptIndex++;
    curText = "";
    curCalls = [];
    curEndedAt = null;
    sawAnyTurn = false;
  }

  return {
    sessionId: sessionId || fallbackId,
    pairs,
    toolCallCount,
    droppedHarness,
    pending: {
      prior: sawAnyTurn ? { text: curText, toolCalls: curCalls, endedAt: curEndedAt } : null,
      recentTargets: turnTargets.flat(),
      promptIndex,
    },
  };
}

export function parseSessionFile(
  file: string,
  project: string,
  opts: { sidechain?: boolean; idSuffix?: string } = {},
): SessionPairs | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const w = walkTranscript(raw, {
    ...opts,
    project,
    fallbackId: basename(file, ".jsonl"),
    // Kept for label-cache stability: a transcript with no sessionId has
    // always had pairIds built from the file name WITH its extension.
    pairIdFallback: basename(file),
  });
  if (w.pairs.length === 0) return null;
  const pairs = w.pairs;
  return {
    sessionId: w.sessionId,
    project,
    file,
    pairs,
    promptCount: pairs.length,
    toolCallCount: w.toolCallCount,
    droppedHarness: w.droppedHarness,
  };
}

/**
 * The pair a live prompt forms with what the agent did just before it.
 *
 * Called from the UserPromptSubmit hook. Whether the transcript already holds
 * the prompt being submitted depends on when Claude Code flushes it, so both
 * orders are handled: if the last recorded user turn IS this prompt and nothing
 * has happened since, its recorded pair is the answer; otherwise the turn still
 * open at the end of the file is.
 */
export function pairForPrompt(
  raw: string,
  prompt: string,
  opts: { sessionId: string; promptAt?: string | null; project?: string },
): Pair {
  const w = walkTranscript(raw, {
    fallbackId: opts.sessionId,
    ...(opts.project !== undefined ? { project: opts.project } : {}),
  });
  const clean = stripWrappers(prompt);
  const last = w.pairs[w.pairs.length - 1];
  if (last && w.pending.prior === null && last.prompt === clean) return last;
  return {
    pairId: `${w.sessionId}:${w.pending.promptIndex}`,
    sessionId: w.sessionId,
    project: opts.project ?? "",
    promptIndex: w.pending.promptIndex,
    prompt: clean,
    promptAt: opts.promptAt ?? null,
    prior: w.pending.prior,
    recentTargets: w.pending.recentTargets,
    sidechain: false,
  };
}

// ─── Corpus walking ───────────────────────────────────────────────────

export function findTranscripts(root: string): Array<{ file: string; project: string }> {
  const out: Array<{ file: string; project: string }> = [];
  const walk = (dir: string, project: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, project);
      else if (e.name.endsWith(".jsonl")) out.push({ file: p, project });
    }
  };
  let top;
  try {
    top = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of top) {
    if (!e.isDirectory()) continue;
    walk(join(root, e.name), e.name);
  }
  return out;
}

export function corpusStats(root: string) {
  const files = findTranscripts(root);
  let bytes = 0;
  for (const f of files) {
    try {
      bytes += statSync(f.file).size;
    } catch {
      /* ignore */
    }
  }
  return { fileCount: files.length, bytes, projects: new Set(files.map((f) => f.project)).size };
}

export { relative, sep };
