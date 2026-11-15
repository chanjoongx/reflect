/**
 * Safe filesystem reader for the reflect Viewer.
 *
 * Reads reflect 0.2's session state:
 *   <project>/.reflect/sessions/<session_id>/events.jsonl   one log per session
 *   <project>/.reflect/disabled                             present when reflect is off
 * where <project> is REFLECT_PROJECT_DIR, or the parent of web/ when unset.
 * Falls back to web/fixtures/example-session/ (same layout) when the project
 * has no sessions.
 *
 * Contract:
 *   - Session ids come from a directory listing and must match the hook's own
 *     id alphabet; a requested id is only used if the listing contains it.
 *     No path is ever built from request input.
 *   - Real directories and regular files only; symlinks are skipped.
 *   - Bounded reads: the last MAX_LOG_BYTES of each log, at most MAX_SESSIONS
 *     sessions, MAX_ENV_BYTES of the project's .env.
 *   - Every event passes through the PII redactor before it leaves this module.
 *   - Missing or unreadable files yield empty results, never a thrown error.
 */

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { redactObject, redactString } from "./redact";
import { asEvent, buildSession, type ViewerConfig } from "./session";
import type { HookEvent, SessionView, ViewerSnapshot } from "./types";

const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_SESSIONS = 40;
const MAX_ENV_BYTES = 64 * 1024;

/** The alphabet `safeSessionId` in src/hook/state.ts produces. */
const SESSION_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

/** 0.1 files. Their presence next to an empty sessions/ folder gets a hint on the dashboard. */
const LEGACY_FILES = ["state.json", "session-log.jsonl", "recent-calls.jsonl"] as const;

function viewerRoot(): string {
  return process.cwd();
}

function projectRoot(): string {
  const fromEnv = process.env.REFLECT_PROJECT_DIR;
  if (fromEnv && path.isAbsolute(fromEnv)) return path.resolve(fromEnv);
  // Viewer runs with cwd = web/. Default project = the repository around it.
  const cwd = viewerRoot();
  return path.basename(cwd) === "web" ? path.resolve(cwd, "..") : cwd;
}

function fixtureReflectDir(): string {
  return path.join(viewerRoot(), "fixtures", "example-session");
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function isRegularFile(p: string): Promise<boolean> {
  try {
    return (await fs.lstat(p)).isFile();
  } catch {
    return false;
  }
}

/** Last `max` bytes of a file, starting at a line boundary. */
async function readTail(p: string, max: number): Promise<{ text: string; truncated: boolean } | null> {
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    fh = await fs.open(p, "r");
    const { size } = await fh.stat();
    const start = Math.max(0, size - max);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    if (start > 0) {
      const nl = text.indexOf("\n");
      text = nl >= 0 ? text.slice(nl + 1) : "";
    }
    return { text, truncated: start > 0 };
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

interface SessionEntry {
  id: string;
  log: string;
  mtimeMs: number;
}

async function listSessions(reflectDir: string): Promise<SessionEntry[]> {
  const root = path.join(reflectDir, "sessions");
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: SessionEntry[] = [];
  for (const d of dirents) {
    if (!d.isDirectory() || !SESSION_ID_RE.test(d.name) || d.name === "." || d.name === "..") continue;
    const log = path.join(root, d.name, "events.jsonl");
    if (!isInside(log, root)) continue;
    try {
      const st = await fs.lstat(log);
      if (st.isFile()) out.push({ id: d.name, log, mtimeMs: st.mtimeMs });
    } catch {
      /* no log yet */
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_SESSIONS);
}

async function readSession(entry: SessionEntry, cfg: ViewerConfig): Promise<SessionView | null> {
  const raw = await readTail(entry.log, MAX_LOG_BYTES);
  if (!raw) return null;
  const events: HookEvent[] = [];
  let badLines = 0;
  for (const line of raw.text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = asEvent(redactObject(JSON.parse(line) as unknown));
      if (ev) events.push(ev);
      else badLines++;
    } catch {
      badLines++; // a torn line from a killed hook process
    }
  }
  return buildSession(entry.id, events, cfg, { truncated: raw.truncated, badLines });
}

const ENV_KEYS = new Set(["REFLECT_POLICY", "REFLECT_MAX_USD_PER_SESSION", "REFLECT_DISABLED"]);

/**
 * The few REFLECT_* settings the Viewer needs, from its own environment first
 * and then the project's .env, the same precedence the hook uses. Nothing else
 * is read out of .env, and nothing from it is returned to a page.
 */
async function readSettings(project: string): Promise<Record<string, { value: string; source: "env" | ".env" }>> {
  const out: Record<string, { value: string; source: "env" | ".env" }> = {};
  for (const k of ENV_KEYS) {
    const v = process.env[k];
    if (v) out[k] = { value: v, source: "env" };
  }
  const envFile = path.join(project, ".env");
  if (!(await isRegularFile(envFile))) return out;
  const raw = await readTail(envFile, MAX_ENV_BYTES);
  if (!raw || raw.truncated) return out;
  for (const line of raw.text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (!key || !ENV_KEYS.has(key) || out[key]) continue;
    const v = (m[2] ?? "").trim();
    const q = /^(["'])(.*)\1$/.exec(v);
    const value = q ? (q[2] ?? "") : v.replace(/\s+#.*$/, "").trim();
    if (value) out[key] = { value, source: ".env" };
  }
  return out;
}

function toConfig(s: Awaited<ReturnType<typeof readSettings>>): ViewerConfig {
  const cfg: ViewerConfig = {};
  const policy = s.REFLECT_POLICY;
  if (policy) cfg.policyId = { value: policy.value, source: policy.source };
  const cap = s.REFLECT_MAX_USD_PER_SESSION;
  const capN = cap ? Number(cap.value) : NaN;
  if (cap && Number.isFinite(capN) && capN >= 0) cfg.capUSD = { value: capN, source: cap.source };
  return cfg;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadSnapshot(): Promise<ViewerSnapshot> {
  const project = projectRoot();
  const liveDir = path.join(project, ".reflect");
  const live = await listSessions(liveDir);
  const settings = await readSettings(project);

  const disabled =
    (await exists(path.join(liveDir, "disabled"))) || settings.REFLECT_DISABLED?.value === "1";

  if (live.length > 0) {
    const cfg = toConfig(settings);
    const sessions = (await Promise.all(live.map((e) => readSession(e, cfg)))).filter(
      (s): s is SessionView => s !== null,
    );
    return {
      source: "live",
      source_label: `${redactString(path.basename(project))}/.reflect`,
      disabled,
      legacyFiles: false,
      sessions: sortNewestFirst(sessions),
    };
  }

  let legacyFiles = false;
  for (const f of LEGACY_FILES) if (await isRegularFile(path.join(liveDir, f))) legacyFiles = true;

  const fixtures = await listSessions(fixtureReflectDir());
  // Example data renders with the defaults, whatever this machine's settings are.
  const sessions = (await Promise.all(fixtures.map((e) => readSession(e, {})))).filter(
    (s): s is SessionView => s !== null,
  );
  return {
    source: "fixture",
    source_label: "example data (fixtures/example-session)",
    disabled,
    legacyFiles,
    sessions: sortNewestFirst(sessions),
  };
}

function sortNewestFirst(sessions: SessionView[]): SessionView[] {
  const t = (s: SessionView) => (s.lastAt ? new Date(s.lastAt).getTime() : 0) || 0;
  return [...sessions].sort((a, b) => t(b) - t(a));
}

/** The session a page asked for, if the listing has it; otherwise the newest. */
export function pickSession(snap: ViewerSnapshot, requested: string | string[] | undefined): SessionView | null {
  const id = typeof requested === "string" ? requested : undefined;
  if (id && SESSION_ID_RE.test(id)) {
    const hit = snap.sessions.find((s) => s.id === id);
    if (hit) return hit;
  }
  return snap.sessions[0] ?? null;
}
