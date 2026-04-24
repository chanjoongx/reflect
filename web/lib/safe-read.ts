/**
 * Safe filesystem reader for the reflect Viewer.
 *
 * Contract:
 *   - Reads ONLY from `.reflect/` directory relative to project root
 *     OR from `web/fixtures/example-session/` (demo mode)
 *   - Static filename allowlist — no `[id]` dynamic path traversal
 *   - PII redaction on every string read before returning
 *   - Graceful missing-file fallback (returns null, not throws)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { redactString, redactObject } from "./redact";
import type {
  ViewerSessionState,
  RecentCall,
  ActiveGuidance,
  LogEntry,
  Reflection,
  ViewerSnapshot,
} from "./types";

const ALLOWED_FILES = [
  "state.json",
  "recent-calls.jsonl",
  "session-guidance.md",
  "session-log.jsonl",
] as const;

export type AllowedFile = (typeof ALLOWED_FILES)[number];

function projectRoot(): string {
  // Viewer runs with cwd = /web/. Reflect root = parent of /web/.
  const cwd = process.cwd();
  if (path.basename(cwd) === "web") {
    return path.resolve(cwd, "..");
  }
  return cwd;
}

function liveReflectDir(): string {
  return path.join(projectRoot(), ".reflect");
}

function fixtureDir(): string {
  return path.join(process.cwd(), "fixtures", "example-session");
}

function safeFilePath(dir: string, filename: AllowedFile): string {
  // Defensive: reject any filename not in allowlist.
  if (!ALLOWED_FILES.includes(filename)) {
    throw new Error(`Disallowed filename: ${filename}`);
  }
  const joined = path.join(dir, filename);
  const resolved = path.resolve(joined);
  const resolvedDir = path.resolve(dir);
  if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
    throw new Error("Path traversal rejected");
  }
  return resolved;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function hasLiveData(): Promise<boolean> {
  const dir = liveReflectDir();
  if (!(await fileExists(dir))) return false;
  // Consider "live" if at least one of the key files exists.
  for (const f of ALLOWED_FILES) {
    const p = safeFilePath(dir, f);
    if (await fileExists(p)) return true;
  }
  return false;
}

async function readTextSafe(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return redactString(raw);
  } catch {
    return null;
  }
}

async function readState(dir: string): Promise<ViewerSessionState | null> {
  const p = safeFilePath(dir, "state.json");
  const text = await readTextSafe(p);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ViewerSessionState>;
    if (
      typeof parsed.session_id === "string" &&
      typeof parsed.turn_count === "number" &&
      typeof parsed.cum_x100 === "number" &&
      typeof parsed.cooldown_remaining === "number"
    ) {
      return redactObject(parsed as ViewerSessionState);
    }
    return null;
  } catch {
    return null;
  }
}

async function readRecentCalls(dir: string): Promise<RecentCall[]> {
  const p = safeFilePath(dir, "recent-calls.jsonl");
  const text = await readTextSafe(p);
  if (!text) return [];
  const lines = text.split("\n").filter(Boolean);
  const calls: RecentCall[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<RecentCall>;
      if (
        typeof parsed.turn === "number" &&
        typeof parsed.tool === "string" &&
        typeof parsed.tier === "number" &&
        typeof parsed.input_summary === "string" &&
        typeof parsed.timestamp === "string"
      ) {
        calls.push(redactObject(parsed as RecentCall));
      }
    } catch {
      // skip malformed
    }
  }
  return calls.slice(-50); // cap at 50 most recent
}

/**
 * Parse session-guidance.md. File is plain markdown written by
 * `src/guidance-injector.ts` — NO YAML frontmatter.
 *
 * Format:
 *   # Session reflection — last triggered <ISO>
 *   ## What I was doing (pattern)
 *   <body>
 *   ## Why the user pushed back (signal)
 *   <body>
 *   ## Adjustment for the rest of this session
 *   <body>
 *   > Confidence: <c> · Scope: <s> · FT-likelihood: <f>
 */
function parseGuidanceMarkdown(md: string): ActiveGuidance | null {
  const lastTriggeredMatch = md.match(/last triggered\s*([^\n]+)/i);
  const patternMatch = md.match(/## What I was doing[^\n]*\n([\s\S]*?)(?=\n## |\n> |$)/);
  const signalMatch = md.match(/## Why the user pushed back[^\n]*\n([\s\S]*?)(?=\n## |\n> |$)/);
  const adjustmentMatch = md.match(/## Adjustment[^\n]*\n([\s\S]*?)(?=\n## |\n> |$)/);
  const metaMatch = md.match(
    /Confidence:\s*(low|medium|high).*?Scope:\s*(this_session|wider_concern).*?FT-likelihood:\s*(low|medium|high)/i,
  );

  if (!patternMatch || !signalMatch || !adjustmentMatch || !metaMatch) return null;

  return {
    last_triggered: (lastTriggeredMatch?.[1] ?? "").trim(),
    reflection: {
      pattern: (patternMatch[1] ?? "").trim(),
      signal: (signalMatch[1] ?? "").trim(),
      adjustment: (adjustmentMatch[1] ?? "").trim(),
      confidence: (metaMatch[1] ?? "low").toLowerCase() as Reflection["confidence"],
      scope: (metaMatch[2] ?? "this_session") as Reflection["scope"],
      false_trigger_likelihood: (metaMatch[3] ?? "low").toLowerCase() as Reflection["false_trigger_likelihood"],
    },
  };
}

async function readGuidance(dir: string): Promise<ActiveGuidance | null> {
  const p = safeFilePath(dir, "session-guidance.md");
  const text = await readTextSafe(p);
  if (!text) return null;
  return redactObject(parseGuidanceMarkdown(text));
}

async function readLog(dir: string): Promise<LogEntry[]> {
  const p = safeFilePath(dir, "session-log.jsonl");
  const text = await readTextSafe(p);
  if (!text) return [];
  const lines = text.split("\n").filter(Boolean);
  const entries: LogEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as LogEntry;
      if (parsed.reflection && parsed.cost && typeof parsed.timestamp === "string") {
        entries.push(redactObject(parsed));
      }
    } catch {
      // skip
    }
  }
  return entries;
}

export async function loadSnapshot(): Promise<ViewerSnapshot> {
  const useFixtures = !(await hasLiveData());
  const dir = useFixtures ? fixtureDir() : liveReflectDir();
  const source: "live" | "fixture" = useFixtures ? "fixture" : "live";
  const source_label = useFixtures
    ? "Example session (fixture data)"
    : "Live session (.reflect/)";

  const [state, recent_calls, active_guidance, log] = await Promise.all([
    readState(dir),
    readRecentCalls(dir),
    readGuidance(dir),
    readLog(dir),
  ]);

  return {
    state,
    recent_calls,
    active_guidance,
    log,
    source,
    source_label,
  };
}

export async function loadLogEntry(indexParam: string): Promise<{
  entry: LogEntry;
  index: number;
  total: number;
} | null> {
  const idx = Number.parseInt(indexParam, 10);
  if (!Number.isFinite(idx) || idx < 0) return null;

  const snap = await loadSnapshot();
  if (idx >= snap.log.length) return null;

  const entry = snap.log[idx];
  if (!entry) return null;
  return { entry, index: idx, total: snap.log.length };
}
