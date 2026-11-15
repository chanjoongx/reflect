// src/hook/turns.ts: what reflect keeps of the conversation, and for how long.
//
// reflect does not open the session transcript. Claude Code passes each hook
// what that hook needs, and reflect keeps only this:
//
//   agent/<promptId>.jsonl  The agent's turn after one of the developer's
//                           messages: the name and target of each tool call
//                           (PostToolUse, PostToolUseFailure) and the agent's
//                           final reply (Stop), redacted. The judge of the next
//                           message reads it once, to summarise the turn, and
//                           deletes it. A turn no judge reads (usually the last
//                           one of a session) is deleted after a day.
//   turns/<promptId>.json   For a judged message: the message, that summary,
//                           and the judge's quote and reason, redacted. Only
//                           the developer's last MAX_KEPT_TURNS messages keep
//                           theirs, the most that a reflection, `reflect
//                           manual` or /brain-reflect reads back.
//
// events.jsonl holds the rest: labels, counts, costs, notes and errors.

import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PriorTurn, ToolCall } from "../detect/types.js";
import { redactString, safeTruncate, safeTruncateEnd } from "../redact.js";
import { isMutating, toolTarget } from "../transcript/parse.js";
import { ensureRoot, sessionDir, stateRoot, type HookEvent } from "./state.js";

export const MAX_KEPT_TURNS = 12;
export const AGENT_TURN_TTL_MS = 24 * 3_600_000;
/** More than the judge shows (1,400 characters), so the tail it shows is complete. */
const SAID_CHARS = 4000;
const TARGET_CHARS = 200;

type AgentRecord =
  | { k: "call"; name: string; target: string; mutating: boolean; errored: boolean }
  | { k: "said"; at: string; text: string };

export interface TurnText {
  prompt: string;
  priorSummary: string;
  evidence: string;
  rationale: string;
}

const fileId = (id: string) => id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
const agentDir = (projectDir: string, sessionId: string) => join(sessionDir(projectDir, sessionId), "agent");
const turnsDir = (projectDir: string, sessionId: string) => join(sessionDir(projectDir, sessionId), "turns");

function appendRecord(projectDir: string, sessionId: string, promptId: string, rec: AgentRecord): void {
  ensureRoot(projectDir);
  const dir = agentDir(projectDir, sessionId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${fileId(promptId)}.jsonl`), JSON.stringify(rec) + "\n", "utf8");
}

/** One tool call of the main agent, from PostToolUse or PostToolUseFailure. */
export function recordCall(
  projectDir: string,
  sessionId: string,
  promptId: string,
  name: string,
  input: Record<string, unknown>,
  errored: boolean,
): void {
  appendRecord(projectDir, sessionId, promptId, {
    k: "call",
    name: safeTruncate(name, 80),
    target: safeTruncate(redactString(toolTarget(name, input)), TARGET_CHARS),
    mutating: isMutating(name, input),
    errored,
  });
}

/** The agent's final reply for the turn, from Stop's `last_assistant_message`. */
export function recordSaid(projectDir: string, sessionId: string, promptId: string, text: string, at: string): void {
  const clean = redactString(text).trim();
  if (!clean) return;
  appendRecord(projectDir, sessionId, promptId, { k: "said", at, text: safeTruncateEnd(clean, SAID_CHARS) });
}

/**
 * The agent's turn that the developer's next message answers, read once and
 * deleted. `promptIds` are the prompts whose turns it spans: the developer's
 * previous message and any bookkeeping commands after it. Null when nothing
 * was recorded: the session's first message, or the agent never got to act.
 */
export function takeAgentTurn(projectDir: string, sessionId: string, promptIds: string[]): PriorTurn | null {
  const toolCalls: ToolCall[] = [];
  const said: string[] = [];
  let endedAt: string | null = null;
  let any = false;
  for (const id of promptIds) {
    const file = join(agentDir(projectDir, sessionId), `${fileId(id)}.jsonl`);
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    any = true;
    rmSync(file, { force: true });
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let r: AgentRecord;
      try {
        r = JSON.parse(line) as AgentRecord;
      } catch {
        continue;
      }
      if (r.k === "call") {
        toolCalls.push({ name: r.name, target: r.target, mutating: r.mutating, errored: r.errored });
      } else if (r.k === "said") {
        said.push(r.text);
        endedAt = r.at;
      }
    }
  }
  return any ? { text: said.join("\n"), toolCalls, endedAt } : null;
}

/** Agent turns nobody judged within AGENT_TURN_TTL_MS, in every session of the project. */
export function pruneAgentTurns(projectDir: string, ttlMs = AGENT_TURN_TTL_MS): number {
  const root = join(stateRoot(projectDir), "sessions");
  const cutoff = Date.now() - ttlMs;
  let removed = 0;
  let sessions: string[];
  try {
    sessions = readdirSync(root);
  } catch {
    return 0;
  }
  for (const s of sessions) {
    const dir = join(root, s, "agent");
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        if (statSync(join(dir, f)).mtimeMs < cutoff) {
          rmSync(join(dir, f), { force: true });
          removed++;
        }
      } catch {
        /* raced with the judge that read it */
      }
    }
  }
  return removed;
}

/**
 * Store a judged message's text, then delete the text of any message that is
 * no longer among the developer's last MAX_KEPT_TURNS. `order` is the session's
 * prompt order as the caller read it; a file for a prompt it does not list yet
 * is newer than that read and is left alone.
 */
export function saveTurnText(
  projectDir: string,
  sessionId: string,
  promptId: string,
  text: TurnText,
  order: string[],
): void {
  const dir = turnsDir(projectDir, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${fileId(promptId)}.json`), JSON.stringify(text), "utf8");
  const keep = new Set(order.slice(-MAX_KEPT_TURNS).map(fileId));
  const known = new Set(order.map(fileId));
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    if (known.has(id) && !keep.has(id)) rmSync(join(dir, f), { force: true });
  }
}

/**
 * The text of a judged message, or null once it has been dropped. Falls back
 * to the verdict itself for logs written before 0.2.2.
 */
export function turnTextFor(
  projectDir: string,
  sessionId: string,
  v: Extract<HookEvent, { t: "verdict" }>,
): TurnText | null {
  try {
    const raw = readFileSync(join(turnsDir(projectDir, sessionId), `${fileId(v.promptId)}.json`), "utf8");
    const t = JSON.parse(raw) as Partial<TurnText>;
    return {
      prompt: String(t.prompt ?? ""),
      priorSummary: String(t.priorSummary ?? ""),
      evidence: String(t.evidence ?? ""),
      rationale: String(t.rationale ?? ""),
    };
  } catch {
    /* dropped, or a log from before 0.2.2 */
  }
  if (v.prompt === undefined) return null;
  return {
    prompt: v.prompt,
    priorSummary: v.priorSummary ?? "",
    evidence: v.evidence ?? "",
    rationale: v.rationale ?? "",
  };
}
