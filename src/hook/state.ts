// src/hook/state.ts: the per-session event log.
//
// v0.1.4 kept one JSON object per project and had two hooks read-modify-write
// it with grep and sed. PostToolUse fires once per parallel tool call, so
// concurrent writers lost updates (PLAN-V2 debt D2). v0.2 appends one JSON line
// per event and derives everything else by reading the log back. Appends of a
// single short line are not interleaved in practice on the platforms Claude
// Code runs on; the one read-decide-write step that matters (firing) is
// additionally serialised by `withLock`.
//
// Layout: <project>/.reflect/sessions/<session_id>/events.jsonl
// `.reflect/` gets its own `.gitignore` of `*` on first write, so nothing here
// can be committed by accident. Session directories older than SESSION_TTL_DAYS
// are pruned on SessionStart.

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Label } from "../detect/types.js";
import type { Reflection2 } from "../reflect/schema.js";

export const STATE_DIR = ".reflect";
export const SESSION_TTL_DAYS = 7;

export type HookEvent =
  | { t: "prompt"; at: string; promptId: string; chars: number }
  | {
      t: "verdict";
      at: string;
      promptId: string;
      label: Label;
      confidence: "low" | "medium" | "high";
      evidence: string;
      rationale: string;
      /** Rendered prior turn, kept so a reflection can quote what the agent did. */
      priorSummary: string;
      prompt: string;
      model: string;
      costUSD: number;
      latencyMs: number;
    }
  | { t: "skip"; at: string; promptId: string; reason: string }
  | { t: "fire"; at: string; promptId: string; evidence: string[]; policyId: string }
  | {
      t: "guidance";
      at: string;
      id: string;
      promptId: string;
      reflection: Reflection2;
      model: string;
      costUSD: number;
      latencyMs: number;
      manual?: boolean;
    }
  | { t: "delivered"; at: string; id: string; via: "prompt" | "tool" | "session-start" | "command" }
  | { t: "error"; at: string; where: string; message: string };

export function now(): string {
  return new Date().toISOString();
}

export function stateRoot(projectDir: string): string {
  return join(projectDir, STATE_DIR);
}

/** Session ids come from Claude Code, but they become a path: keep them boring. */
export function safeSessionId(id: string): string {
  const s = id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  return s && s !== "." && s !== ".." ? s : "unknown";
}

export function sessionDir(projectDir: string, sessionId: string): string {
  return join(stateRoot(projectDir), "sessions", safeSessionId(sessionId));
}

function ensureRoot(projectDir: string): void {
  const root = stateRoot(projectDir);
  mkdirSync(root, { recursive: true });
  const gi = join(root, ".gitignore");
  if (!existsSync(gi)) {
    try {
      writeFileSync(gi, "# reflect session state: local only, never commit\n*\n", "utf8");
    } catch {
      /* best effort */
    }
  }
}

export function appendEvent(projectDir: string, sessionId: string, ev: HookEvent): void {
  ensureRoot(projectDir);
  const dir = sessionDir(projectDir, sessionId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "events.jsonl"), JSON.stringify(ev) + "\n", "utf8");
}

export function readEvents(projectDir: string, sessionId: string): HookEvent[] {
  let raw: string;
  try {
    raw = readFileSync(join(sessionDir(projectDir, sessionId), "events.jsonl"), "utf8");
  } catch {
    return [];
  }
  const out: HookEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as HookEvent);
    } catch {
      /* a torn line from a killed process: skip it, never fail the hook */
    }
  }
  return out;
}

/** Most recently modified session directory, for CLI commands run outside a hook. */
export function latestSession(projectDir: string): string | null {
  const root = join(stateRoot(projectDir), "sessions");
  let best: { id: string; m: number } | null = null;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  for (const id of entries) {
    try {
      const m = statSync(join(root, id, "events.jsonl")).mtimeMs;
      if (!best || m > best.m) best = { id, m };
    } catch {
      /* no log yet */
    }
  }
  return best?.id ?? null;
}

export function pruneSessions(projectDir: string, ttlDays = SESSION_TTL_DAYS): number {
  const root = join(stateRoot(projectDir), "sessions");
  const cutoff = Date.now() - ttlDays * 86_400_000;
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  for (const id of entries) {
    const dir = join(root, id);
    try {
      // The log's own mtime: appending to a file does not touch its directory's.
      const log = join(dir, "events.jsonl");
      const last = existsSync(log) ? statSync(log).mtimeMs : statSync(dir).mtimeMs;
      if (last < cutoff) {
        rmSync(dir, { recursive: true, force: true });
        removed++;
      }
    } catch {
      /* raced with another pruner */
    }
  }
  return removed;
}

export function isDisabled(projectDir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["REFLECT_DISABLED"] === "1") return true;
  return existsSync(join(stateRoot(projectDir), "disabled"));
}

export function setDisabled(projectDir: string, disabled: boolean): void {
  ensureRoot(projectDir);
  const flag = join(stateRoot(projectDir), "disabled");
  if (disabled) writeFileSync(flag, "reflect is off for this project. `reflect on` removes this file.\n");
  else if (existsSync(flag)) unlinkSync(flag);
}

// ─── Lock ─────────────────────────────────────────────────────────────

const LOCK_STALE_MS = 120_000;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Exclusive-create lock file. Two async judge hooks can finish within
 * milliseconds of each other when the developer sends prompts quickly; without
 * this both could see the same trigger and both pay for a reflection.
 */
export async function withLock<T>(
  projectDir: string,
  sessionId: string,
  fn: () => Promise<T>,
  waitMs = 15_000,
): Promise<T | null> {
  const dir = sessionDir(projectDir, sessionId);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "fire.lock");
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lock);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) return null;
      sleepSync(50);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}
