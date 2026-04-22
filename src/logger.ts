// src/logger.ts — Opt-in session log (.reflect/session-log.jsonl)
//
// Per REFLECT.md and Cat Lab requirement:
//   - Opt-in via REFLECT_LOG_ENABLED=1
//   - Ephemeral: 168h (7 days) auto-deleted
//   - Source data for "reflection useful rate" — Phase 2 decision input

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Reflection, CallCost } from "./types.js";

export const LOG_DIR = ".reflect";
export const LOG_FILENAME = "session-log.jsonl";
export const LOG_TTL_HOURS = 168; // 7 days

export interface LogEntry {
  timestamp: string;
  session_id: string;
  reflection: Reflection;
  cost: CallCost;
  cache_hit_rate: number;
  latency_ms: number;
  trigger_meta: {
    sum_weight: number;
    signal_tiers: number[];
  };
  // Filled in next turn (correlation):
  next_turn_acted_on_adjustment?: boolean | undefined;
  next_turn_summary?: string | undefined;
}

export async function appendLog(
  projectDir: string,
  enabled: boolean,
  entry: LogEntry,
): Promise<void> {
  if (!enabled) return;

  const dir = path.join(projectDir, LOG_DIR);
  const filePath = path.join(dir, LOG_FILENAME);

  await fs.mkdir(dir, { recursive: true });

  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(filePath, line, "utf8");
}

/**
 * Auto-delete log entries older than LOG_TTL_HOURS.
 * Called on session start.
 */
export async function pruneOldEntries(projectDir: string): Promise<number> {
  const filePath = path.join(projectDir, LOG_DIR, LOG_FILENAME);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return 0;
  }

  const cutoff = Date.now() - LOG_TTL_HOURS * 60 * 60 * 1000;
  const lines = raw.split("\n").filter(Boolean);
  const kept: string[] = [];
  let pruned = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      const ts = new Date(entry.timestamp).getTime();
      if (ts >= cutoff) {
        kept.push(line);
      } else {
        pruned++;
      }
    } catch {
      // Malformed line — drop
      pruned++;
    }
  }

  if (pruned > 0) {
    await fs.writeFile(filePath, kept.join("\n") + "\n", "utf8");
  }

  return pruned;
}

export async function readAllEntries(projectDir: string): Promise<LogEntry[]> {
  const filePath = path.join(projectDir, LOG_DIR, LOG_FILENAME);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is LogEntry => e !== null);
}

/**
 * Compute "reflection useful rate" — Phase 2 decision metric.
 * Useful = next_turn_acted_on_adjustment === true.
 */
export async function computeUsefulRate(
  projectDir: string,
): Promise<{ total: number; useful: number; rate: number }> {
  const entries = await readAllEntries(projectDir);
  const total = entries.length;
  const useful = entries.filter((e) => e.next_turn_acted_on_adjustment === true).length;
  const rate = total === 0 ? 0 : useful / total;
  return { total, useful, rate };
}
