// src/cli/cli.ts: `reflect <command>`, the npm package's command (dist/reflect.mjs).
// The installed plugin does not include it; it is a mod (src/mod/reflect.ts).

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasCredentials, pluginMode, resolveApiKey } from "../api/credentials.js";
import { isPushback } from "../detect/types.js";
import { formatForAgent } from "../reflect/format.js";
import {
  activeGuidance,
  defaultDeps,
  evidenceTurns,
  loadConfig,
  pendingGuidance,
  promptOrder,
  reflectAndRecord,
  sessionSpend,
} from "../hook/run.js";
import { withProjectEnv } from "../hook/project-env.js";
import { appendEvent, isDisabled, latestSession, now, readEvents, setDisabled, stateRoot, type HookEvent } from "../hook/state.js";
import { VERSION } from "../version.js";

const HELP = `reflect ${VERSION}: notices when you keep correcting Claude Code, and tells it why.

USAGE
  reflect status [--session ID]   What reflect has seen in the latest (or given) session
  reflect manual [--turns N]      Reflect on the last N judged turns now (default 6)
                  [--agent]       Output meant for an agent's context: always exits 0
  reflect doctor                  Check node, credentials and the hook bundle
  reflect init                    Print the hook settings for a project that does not use the plugin
               [--write]          Merge them into .claude/settings.local.json (old file kept as .bak)
               [--remove]         Take reflect's hooks out of that file, leaving the rest
  reflect off | on                Disable or re-enable reflect for this project

ENVIRONMENT (all optional)
  ANTHROPIC_API_KEY               Or \`ant auth login\`. The installed plugin does not run this
                                  command; it calls models through the Claude Code session
  REFLECT_JUDGE_MODEL             Default claude-haiku-5-5
  REFLECT_MODEL                   Reflection model. Default claude-opus-5-5
  REFLECT_EFFORT                  low|medium|high|xhigh|max. Default high
  REFLECT_POLICY                  Trigger policy id. Default k2w6 (2 pushbacks in 6 turns)
  REFLECT_MAX_USD_PER_SESSION     Spend cap per session. Default 0.5
  REFLECT_DISABLED=1              Turn every hook into a no-op

DOCS  https://github.com/chanjoongx/reflect
`;

const env0 = () => withProjectEnv(projectDir(), process.env);

/**
 * The project the hooks write to. Inside Claude Code that is CLAUDE_PROJECT_DIR;
 * from a terminal, walk up from the current directory to the nearest folder that
 * holds .reflect, .claude or .git, so `reflect off` in a subfolder still works.
 */
function projectDir(): string {
  const d = process.env["CLAUDE_PROJECT_DIR"];
  if (d && existsSync(d)) return d;
  let dir = resolve(process.cwd());
  for (;;) {
    if ([".reflect", ".claude", ".git"].some((m) => existsSync(join(dir, m)))) return dir;
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

/** The value after `name`, unless it is missing, empty, another flag, or an unexpanded `${...}`. */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith("-") && !v.includes("${") ? v : undefined;
}

const usd = (v: number) => `$${v.toFixed(v < 0.01 ? 5 : 4)}`;

function summarize(events: HookEvent[]) {
  const prompts = promptOrder(events).length;
  const verdicts = events.filter((e): e is Verdict => e.t === "verdict");
  const pushbacks = verdicts.filter((v) => isPushback(v.label));
  const skips = events.filter((e) => e.t === "skip").length;
  const fires = events.filter((e) => e.t === "fire").length;
  const guidance = events.filter((e) => e.t === "guidance").length;
  const errors = events.filter((e): e is Extract<HookEvent, { t: "error" }> => e.t === "error");
  return { prompts, verdicts, pushbacks, skips, fires, guidance, errors };
}

function cmdStatus(argv: string[]): number {
  const dir = projectDir();
  const sid = flag(argv, "--session") ?? latestSession(dir);
  if (isDisabled(dir, env0())) console.log("reflect is OFF for this project (`reflect on` to re-enable).");
  if (!sid) {
    console.log("reflect: no session recorded in this project yet.");
    return 0;
  }
  const events = readEvents(dir, sid);
  const s = summarize(events);
  const cfg = loadConfig(withProjectEnv(dir, process.env));
  console.log(`reflect ${VERSION} · session ${sid}`);
  console.log(`  developer turns   ${s.prompts}`);
  console.log(`  judged            ${s.verdicts.length} (skipped ${s.skips}: no prior agent turn, budget, or similar)`);
  console.log(`  pushback          ${s.pushbacks.length}` +
    (s.pushbacks.length ? `  [${s.pushbacks.map((v) => v.label).join(", ")}]` : ""));
  console.log(`  reflections       ${s.guidance} (fires ${s.fires}, policy ${cfg.policy.id})`);
  console.log(`  spent             ${usd(sessionSpend(events))} of ${usd(cfg.maxUsdPerSession)} cap`);
  if (s.errors.length) {
    const last = s.errors[s.errors.length - 1] as Extract<HookEvent, { t: "error" }>;
    console.log(`  errors            ${s.errors.length} (last, in ${last.where}: ${last.message})`);
  }
  const g = activeGuidance(events) ?? pendingGuidance(events);
  if (g) {
    console.log("");
    console.log(activeGuidance(events) ? "Guidance in force:" : "Guidance waiting to be delivered:");
    console.log("  " + formatForAgent(g.reflection, { pushbacks: 0, window: 0, turns: [], manual: true })
      .split("\n").slice(2, 6).join("\n  "));
  }
  return 0;
}

type Verdict = Extract<HookEvent, { t: "verdict" }>;

const NO_REFLECTION_FOR_AGENT =
  "No outside reflection is available, so write one yourself from this conversation instead (see below).";

async function cmdManual(argv: string[]): Promise<number> {
  const dir = projectDir();
  const forAgent = argv.includes("--agent");
  const sid = flag(argv, "--session") ?? latestSession(dir);
  if (!sid) {
    console.log("reflect: no session recorded in this project yet, so there is nothing to reflect on.");
    if (forAgent) console.log(NO_REFLECTION_FOR_AGENT);
    return 0;
  }
  const n = Math.max(1, Math.min(12, Number(flag(argv, "--turns") ?? "6") || 6));
  const events = readEvents(dir, sid);
  const order = promptOrder(events);
  const verdicts = events.filter((e): e is Verdict => e.t === "verdict");
  if (verdicts.length === 0) {
    console.log(
      isDisabled(dir, env0())
        ? "reflect: off in this project (`reflect on` to turn it back on), so no turns were judged."
        : "reflect: no judged turns in this session yet. Each prompt after the agent's first reply is judged.",
    );
    if (forAgent) console.log(NO_REFLECTION_FOR_AGENT);
    return 0;
  }
  const recent = verdicts.slice(-n);
  const env = withProjectEnv(dir, process.env);
  const turns = evidenceTurns(dir, sid, recent, order);
  if (turns.length === 0) {
    console.log("reflect: the text of those messages is no longer kept (only the last 12 are), so there is nothing to send.");
    if (forAgent) console.log(NO_REFLECTION_FOR_AGENT);
    return 0;
  }
  const cfg = loadConfig(env);
  const last = verdicts[verdicts.length - 1] as Verdict;
  const res = await reflectAndRecord(turns, cfg, dir, sid, last.promptId, defaultDeps(env), true);
  if (!res) {
    const err = [...readEvents(dir, sid)].reverse().find((e) => e.t === "error");
    console.log(`reflect: the reflection failed${err && err.t === "error" ? `: ${err.message}` : "."}`);
    if (forAgent) console.log(NO_REFLECTION_FOR_AGENT);
    return forAgent ? 0 : 1;
  }
  // The command's output already puts the note in the agent's context; do not deliver it twice.
  if (forAgent) appendEvent(dir, sid, { t: "delivered", at: now(), id: res.guidanceId, via: "command" });
  console.log(formatForAgent(res.reflection, { pushbacks: 0, window: 0, turns: [], manual: true }));
  console.log("");
  console.log(`(${res.model}, ${usd(res.costUSD)}, ${(res.latencyMs / 1000).toFixed(1)} s. ` +
    `Written to ${join(stateRoot(dir), "session-guidance.md")}` +
    (forAgent ? ".)" : "; the agent receives it on its next tool call or prompt.)"));
  return 0;
}

function cmdDoctor(): number {
  const dir = projectDir();
  const env = withProjectEnv(dir, process.env);
  const rows: Array<[string, boolean, string]> = [];
  const major = Number(process.versions.node.split(".")[0]);
  rows.push(["node >= 20", major >= 20, process.versions.node]);
  const key = resolveApiKey(env);
  rows.push([
    "credentials",
    hasCredentials(env),
    pluginMode(env)
      ? key ? "API key from the plugin setting" : "no API key in the plugin setting"
      : key ? "API key found (environment or .env)"
        : "none in the environment; the SDK may still find an `ant auth login` profile",
  ]);
  const bundle = bundlePath();
  rows.push(["hook bundle", existsSync(bundle), bundle]);
  rows.push(["enabled here", !isDisabled(dir, env), isDisabled(dir, env) ? "`reflect on` to re-enable" : dir]);
  const sid = latestSession(dir);
  rows.push(["sessions recorded", sid !== null, sid ? `latest ${sid}` : "none yet (normal before the first prompt)"]);
  const gi = join(stateRoot(dir), ".gitignore");
  if (existsSync(stateRoot(dir))) {
    const ok = existsSync(gi) && readFileSync(gi, "utf8").includes("*");
    rows.push([".reflect ignored by git", ok, gi]);
  }
  for (const [name, ok, note] of rows) console.log(`${ok ? "ok  " : "warn"}  ${name.padEnd(24)} ${note}`);
  return rows.every(([n, ok]) => ok || n === "sessions recorded" || n === "credentials") ? 0 : 1;
}

/** This file inside the bundle; the built bundle in dist/ when run from source. */
function bundlePath(): string {
  const here = fileURLToPath(import.meta.url);
  return here.endsWith(".mjs") ? here : resolve(dirname(here), "..", "..", "dist", "reflect.mjs");
}

/** The hook wiring for settings.local.json, for a project that runs the npm command instead of the plugin. */
export function hookSettings(bundle: string): unknown {
  const hook = (mode: string, extra: Record<string, unknown>) => ({ type: "command", command: "node", args: [bundle, mode], ...extra });
  return {
    hooks: {
      SessionStart: [{ hooks: [hook("session-start", { timeout: 10 })] }],
      UserPromptSubmit: [{ hooks: [hook("prompt", { timeout: 10 }), hook("judge", { async: true })] }],
      PostToolUse: [{ hooks: [hook("tool", { timeout: 10 })] }],
      PostToolUseFailure: [{ hooks: [hook("tool-failed", { timeout: 10 })] }],
      Stop: [{ hooks: [hook("stop", { timeout: 10 })] }],
    },
  };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** A settings file reflect will not change, with the reason. */
export class SettingsError extends Error {}

/**
 * True for a hook entry that runs a reflect bundle: a command hook whose args[0]
 * or command string is a path to reflect.mjs, from this install or an older one.
 */
export function isReflectHook(h: unknown): boolean {
  if (!isObject(h) || h["type"] !== "command") return false;
  const isBundle = (s: unknown) => typeof s === "string" && /(?:^|[\\/])reflect\.mjs$/.test(s.trim().replace(/^["']|["']$/g, ""));
  const args = h["args"];
  return isBundle(Array.isArray(args) ? args[0] : undefined) || isBundle(h["command"]);
}

/** A copy of the settings without reflect's hook entries; the `hooks` key stays even when empty. */
function stripReflect(settings: unknown): { settings: Json; removed: number } {
  if (!isObject(settings)) throw new SettingsError("is not a JSON object");
  const hooks = settings["hooks"];
  if (hooks !== undefined && !isObject(hooks)) throw new SettingsError('has a "hooks" value that is not an object');
  const out = JSON.parse(JSON.stringify(settings)) as Json;
  if (!isObject(out["hooks"])) return { settings: out, removed: 0 };
  let removed = 0;
  const next: Json = {};
  for (const [event, groups] of Object.entries(out["hooks"])) {
    if (!Array.isArray(groups)) {
      next[event] = groups;
      continue;
    }
    const kept: unknown[] = [];
    let lost = false;
    for (const g of groups) {
      const entries = isObject(g) ? g["hooks"] : undefined;
      if (!isObject(g) || !Array.isArray(entries)) {
        kept.push(g);
        continue;
      }
      const left = entries.filter((h) => !isReflectHook(h));
      const n = entries.length - left.length;
      if (n === 0) {
        kept.push(g);
        continue;
      }
      removed += n;
      lost = true;
      if (left.length > 0) kept.push({ ...g, hooks: left });
    }
    if (lost && kept.length === 0) continue;
    next[event] = kept;
  }
  out["hooks"] = next;
  return { settings: out, removed };
}

/** The settings with reflect's entries taken out, and the `hooks` key deleted if that leaves it empty. */
export function removeReflectHooks(settings: unknown): { settings: Json; removed: number } {
  const r = stripReflect(settings);
  const hooks = r.settings["hooks"];
  if (r.removed > 0 && isObject(hooks) && Object.keys(hooks).length === 0) delete r.settings["hooks"];
  return r;
}

/** The settings with any old reflect entries replaced by the groups from hookSettings(bundle), appended per event. */
export function mergeReflectHooks(settings: unknown, bundle: string): { settings: Json; added: number; removed: number } {
  const { settings: out, removed } = stripReflect(settings);
  const hooks: Json = isObject(out["hooks"]) ? out["hooks"] : (out["hooks"] = {});
  let added = 0;
  const wanted = (hookSettings(bundle) as { hooks: Record<string, Array<{ hooks: unknown[] }>> }).hooks;
  for (const [event, groups] of Object.entries(wanted)) {
    const cur = hooks[event];
    if (cur !== undefined && !Array.isArray(cur)) throw new SettingsError(`has a "hooks.${event}" value that is not a list`);
    hooks[event] = [...(cur ?? []), ...groups];
    added += groups.reduce((n, g) => n + g.hooks.length, 0);
  }
  return { settings: out, added, removed };
}

/** True when git ignores the file; undefined when git cannot tell (no git, not a repository). */
function gitIgnores(dir: string, rel: string): boolean | undefined {
  try {
    execFileSync("git", ["check-ignore", "-q", rel], { cwd: dir, stdio: "ignore", timeout: 5000 });
    return true;
  } catch (e) {
    return (e as { status?: unknown }).status === 1 ? false : undefined;
  }
}

export interface InitResult {
  code: number;
  out: string[];
  err: string[];
}

/** `reflect init --write` or `--remove` on <dir>/.claude/settings.local.json. Writes only when the content changes. */
export function applyInit(dir: string, bundle: string, mode: "write" | "remove"): InitResult {
  const rel = ".claude/settings.local.json";
  const file = join(dir, ".claude", "settings.local.json");
  const out: string[] = [];
  const fail = (why: string): InitResult => ({ code: 1, out, err: [`reflect: ${file} ${why}. Nothing was written.`] });
  const exists = existsSync(file);
  let before: unknown = {};
  if (exists) {
    const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    if (text.trim() !== "") {
      try {
        before = JSON.parse(text);
      } catch (e) {
        return fail(`is not valid JSON (${(e as Error).message})`);
      }
    }
  }
  let after: Json;
  let summary: string;
  try {
    if (mode === "write") {
      const r = mergeReflectHooks(before, bundle);
      after = r.settings;
      summary = `Added ${r.added} reflect hook entries to ${file}${r.removed > 0 ? `, replacing ${r.removed} it had before` : ""}.`;
    } else {
      const r = removeReflectHooks(before);
      if (r.removed === 0) {
        out.push(exists ? `${file} has no reflect hook entries. Nothing to remove.` : `${file} does not exist. Nothing to remove.`);
        return { code: 0, out, err: [] };
      }
      after = r.settings;
      summary = `Removed ${r.removed} reflect hook entries from ${file}. Other settings and hooks are unchanged.`;
    }
  } catch (e) {
    if (e instanceof SettingsError) return fail(e.message);
    throw e;
  }
  const text = `${JSON.stringify(after, null, 2)}\n`;
  if (exists && JSON.stringify(before, null, 2) === JSON.stringify(after, null, 2)) {
    out.push(`${file} already has these hooks. Nothing to change.`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    if (exists) copyFileSync(file, `${file}.bak`);
    writeFileSync(file, text);
    out.push(summary);
    if (exists) out.push(`The previous file is in ${file}.bak.`);
    out.push(mode === "write" ? "Restart Claude Code so it loads the hooks." : "Restart Claude Code so it stops running them.");
  }
  if (mode === "write" && bundle.split("\\").join("/").includes("/_npx/")) {
    out.push(
      `Warning: the hooks point into npx's temporary cache (${bundle}), which npm may clean up.`,
      "Install the package with `npm i -g @chanjoongx/reflect`, then run `reflect init --write` again.",
    );
  }
  if (mode === "write" && gitIgnores(dir, rel) === false) {
    out.push(`Note: git does not ignore ${rel}. It holds an absolute local path; keep it out of git.`);
  }
  return { code: 0, out, err: [] };
}

function cmdInit(argv: string[]): number {
  const bundle = bundlePath().split("\\").join("/");
  const write = argv.includes("--write");
  const remove = argv.includes("--remove");
  if (argv.some((a) => a !== "--write" && a !== "--remove") || (write && remove)) {
    console.error(`reflect: init takes --write or --remove, not '${argv.join(" ")}'. Try \`reflect help\`.`);
    return 2;
  }
  if (write || remove) {
    const r = applyInit(projectDir(), bundle, write ? "write" : "remove");
    for (const l of r.out) console.log(l);
    for (const l of r.err) console.error(l);
    return r.code;
  }
  console.log("As a plugin, reflect needs no setup. In Claude Code:");
  console.log("  /plugin install chanjoongx-reflect --marketplace chanjoongx/reflect");
  console.log("");
  console.log("Without the plugin, merge this into .claude/settings.local.json (personal, not committed).");
  console.log("The bundle path is absolute because hook arguments do not pass through a shell.");
  console.log("");
  console.log(JSON.stringify(hookSettings(bundle), null, 2));
  console.log("");
  console.log("Or run `reflect init --write` to merge it for you (`reflect init --remove` takes it out again).");
  console.log("Then run `reflect doctor` in the project and restart Claude Code so it loads the hooks.");
  return 0;
}

export async function runCli(argv: string[]): Promise<number> {
  const cmd = argv[0];
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    case "--version":
    case "-v":
    case "version":
      console.log(VERSION);
      return 0;
    case "status":
    case "s":
      return cmdStatus(argv.slice(1));
    case "manual":
    case "m":
      return cmdManual(argv.slice(1));
    case "doctor":
      return cmdDoctor();
    case "init":
      return cmdInit(argv.slice(1));
    case "off":
      setDisabled(projectDir(), true);
      console.log("reflect is off for this project. `reflect on` turns it back on.");
      return 0;
    case "on":
      setDisabled(projectDir(), false);
      console.log("reflect is on for this project.");
      return 0;
    default:
      console.error(`reflect: unknown command '${cmd}'. Try \`reflect help\`.`);
      return 2;
  }
}
