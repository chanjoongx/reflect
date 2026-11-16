// src/cli/cli.ts: `reflect <command>`, the npm package's command (dist/reflect.mjs).
// The installed plugin does not include it; it is a mod (src/mod/reflect.ts).

import { existsSync, readFileSync } from "node:fs";
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

function cmdInit(): number {
  const bundle = bundlePath().split("\\").join("/");
  console.log("As a plugin, reflect needs no setup. In Claude Code:");
  console.log("  /plugin install chanjoongx-reflect --marketplace chanjoongx/reflect");
  console.log("");
  console.log("Without the plugin, merge this into .claude/settings.local.json (personal, not committed).");
  console.log("The bundle path is absolute because hook arguments do not pass through a shell.");
  console.log("");
  console.log(JSON.stringify(hookSettings(bundle), null, 2));
  console.log("");
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
      return cmdInit();
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
