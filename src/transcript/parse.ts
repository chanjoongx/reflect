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

// ─── Mutation classification ──────────────────────────────────────────

const MUTATING_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "str_replace_based_edit_tool",
]);

/**
 * Bash commands that change user-visible state. Deliberately broader than the
 * shipped Tier 1/2 regexes — this feeds Stage A's structural prior, not the
 * shipped weighted accumulator.
 */
const MUTATING_BASH =
  /(^|[;&|]\s*)(rm|unlink|mv|cp|mkdir|touch|git\s+(revert|restore|checkout|reset|apply|commit|add|rm|mv)|sed\s+-i|npm\s+(i|install|uninstall|publish)|pnpm\s+(add|remove)|yarn\s+(add|remove)|pip\s+install|dd|truncate|chmod|chown)\b|>\s*[^|&\s]/;

function isMutating(name: string, input: Record<string, unknown>): boolean {
  if (MUTATING_TOOLS.has(name)) return true;
  if (name === "Bash" || name === "PowerShell") {
    const cmd = String(input["command"] ?? "");
    return MUTATING_BASH.test(cmd);
  }
  return false;
}

function toolTarget(name: string, input: Record<string, unknown>): string {
  const fp = input["file_path"] ?? input["path"] ?? input["notebook_path"];
  if (typeof fp === "string" && fp) return fp;
  if (name === "Bash" || name === "PowerShell") {
    return String(input["command"] ?? "").slice(0, 200);
  }
  const pat = input["pattern"] ?? input["query"] ?? input["description"] ?? input["url"];
  if (typeof pat === "string" && pat) return pat.slice(0, 200);
  return "";
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

/**
 * Strip harness-injected wrappers that are not user prose.
 *
 * Measured on 1,166 raw prompts from 226 local sessions: 233 of them (20%) are
 * ENTIRELY harness injection — `<task-notification>` background-task events
 * (219), `<bash-input>`/`<bash-stdout>` from `!` commands (10), and others.
 * A further 106 are a hook-injected context preamble (`<november-context>`)
 * followed by real user prose, so the block must be stripped without dropping
 * the prompt.
 *
 * The discriminator is structural, not a hand-maintained denylist: every
 * harness channel Claude Code emits uses a HYPHENATED tag name
 * (`task-notification`, `system-reminder`, `local-command-caveat`,
 * `bash-input`), while ordinary HTML a user might quote does not (`div`, `p`,
 * `code`). The HTML spec reserves hyphenated names for custom elements, so
 * this stays true for quoted markup as well. Fenced code is masked first so a
 * user pasting `<my-widget>` inside a fence survives.
 */
const EXTRA_WRAPPER_TAGS = [
  "command-name",
  "command-message",
  "command-args",
  "ide_opened_file",
  "ide_selection",
];

const HYPHENATED_BLOCK = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
/** Truncated / unclosed injection: a hyphenated open tag with no partner. */
const HYPHENATED_OPEN_TAIL = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:\s[^>]*)?>[\s\S]*$/;
const FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;

/**
 * Channels Claude Code is known to inject. Used ONLY for the destructive
 * unclosed-tag path; the balanced-block strip above stays structural.
 */
const KNOWN_HARNESS_TAGS = new Set([
  "task-notification", "system-reminder", "local-command-caveat",
  "local-command-stdout", "local-command-stderr", "bash-input",
  "bash-stdout", "bash-stderr", "user-prompt-submit-hook",
  "command-name", "command-message", "command-args",
]);

export function stripWrappers(s: string): string {
  // 1. Mask fenced code so quoted markup is never touched. The sentinel is a
  //    Private Use Area codepoint: it cannot collide with anything a developer
  //    types, and unlike the NUL that was here before it does not turn this
  //    source file into something `grep` reports as binary.
  const fences: string[] = [];
  let out = s.replace(FENCE, (m) => {
    fences.push(m);
    return `\uE000FENCE${fences.length - 1}\uE000`;
  });

  // 2. balanced hyphenated blocks, repeatedly (they nest in practice)
  for (let i = 0; i < 4; i++) {
    const next = out.replace(HYPHENATED_BLOCK, " ");
    if (next === out) break;
    out = next;
  }

  // 3. explicit non-hyphenated harness tags
  for (const tag of EXTRA_WRAPPER_TAGS) {
    // In a template literal "\s" is just "s": the backslashes must be doubled
    // (until 2026-11-16 they were not, and IDE blocks reached the judge).
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), " ");
    out = out.replace(new RegExp(`<${tag}\\s*/>`, "g"), " ");
  }

  // 4. A leading UNCLOSED injection block (transcript truncation). This deletes
  //    everything after the tag, so it fires only on channels known to be
  //    harness output — matching any hyphenated name would silently erase the
  //    whole prompt of anyone opening with `<my-widget>` or `<x-foo>`, which is
  //    ordinary vocabulary for a front-end developer.
  const lead = /^\s*<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/.exec(out);
  if (lead && KNOWN_HARNESS_TAGS.has(lead[1] as string)) {
    out = out.replace(HYPHENATED_OPEN_TAIL, " ");
  }

  // 5. Normalise whitespace BEFORE unmasking. Doing it afterwards undid the
  //    entire point of masking: it collapsed the indentation of every fenced
  //    code block the user pasted, changing both `promptChars` — a scored
  //    feature — and the text the judge reads.
  out = out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // 6. unmask
  out = out.replace(/\uE000FENCE(\d+)\uE000/g, (_m, i) => fences[Number(i)] ?? "");

  return out;
}


/**
 * Minimum residual prose for a stripped prompt to count as user-authored.
 * Below this the event was pure harness traffic and the pair is dropped.
 */
export const MIN_PROMPT_CHARS = 3;

/**
 * Auto-compaction writes its summary into the transcript as a `user` message.
 * Measured at 87 of 933 prompts (9.3%) in the local corpus — and they are the
 * longest messages present, so leaving them in would poison every
 * length-derived feature as well as the label distribution.
 */
const COMPACTION_CONTINUATION =
  /^\s*This session is being continued from a previous conversation/i;

/**
 * Bookkeeping slash commands. These are UI operations, not task interaction.
 * Task-bearing slash commands (`/undo`, `/rewind`, `/brain-reflect`, project
 * commands) are deliberately NOT listed — `/undo` in particular is a rejection
 * signal reflect should learn to read.
 */
const BOOKKEEPING_COMMANDS = new Set([
  "compact", "clear", "cost", "status", "resume", "exit", "quit", "help",
  "model", "config", "doctor", "login", "logout", "usage", "context",
  "export", "init", "terminal-setup", "vim", "statusline", "privacy-settings",
  "release-notes", "upgrade", "migrate-installer", "install-github-app",
]);

/** True when the event is harness bookkeeping rather than a user turn. */
export function isBookkeeping(prompt: string): boolean {
  const t = prompt.trim();
  if (COMPACTION_CONTINUATION.test(t)) return true;
  const m = /^\/([a-zA-Z0-9:_-]+)\s*(.*)$/s.exec(t);
  if (m && BOOKKEEPING_COMMANDS.has((m[1] as string).toLowerCase())) {
    // `/compact some instructions` still carries user intent; bare does not.
    return (m[2] ?? "").trim().length < MIN_PROMPT_CHARS;
  }
  return false;
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
