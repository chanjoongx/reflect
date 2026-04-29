#!/usr/bin/env node
// bin/reflect.ts — reflect CLI entry
//
// Subcommands:
//   reflect init                   — wire hooks + path-scoped rule + .env.example
//   reflect status                 — show trigger count, last reflection, cache hit rate
//   reflect manual [--scope ...]   — bypass threshold, fire reflection now
//   reflect trigger --session ID   — invoked by hook (internal)
//   reflect log [--prune]          — read session-log.jsonl
//   reflect off / on               — disable / enable for current session

// Load .env from cwd before anything else (cross-platform: bash, PowerShell, cmd).
// Shell-set env vars take precedence (dotenv default: override=false).
import "dotenv/config";

import { parseArgs } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  assemblePrompt,
  getActiveRules,
  getRecentToolCalls,
  getRolledBackDiff,
  summarizeTask,
} from "../src/context-assembler.js";
import { callOpusReflection } from "../src/opus-reflection.js";
import { writeGuidance, readGuidance } from "../src/guidance-injector.js";
import { appendLog, pruneOldEntries, computeUsefulRate } from "../src/logger.js";
import type { ReflectConfig, TriggerScope } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

// ─── Config ───────────────────────────────────────────────────────

function loadConfig(): ReflectConfig {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill in your key.",
    );
  }

  return {
    apiKey,
    model: process.env["REFLECT_MODEL"] ?? "claude-opus-4-7",
    effort: (process.env["REFLECT_EFFORT"] as ReflectConfig["effort"]) ?? "high",
    triggerThreshold: parseFloat(process.env["REFLECT_TRIGGER_THRESHOLD"] ?? "2.4"),
    cooldownTurns: parseInt(process.env["REFLECT_COOLDOWN_TURNS"] ?? "5", 10),
    windowSize: parseInt(process.env["REFLECT_WINDOW_SIZE"] ?? "10", 10),
    logEnabled: process.env["REFLECT_LOG_ENABLED"] === "1",
    debug: process.env["REFLECT_DEBUG"] === "1",
    disabled: process.env["REFLECT_DISABLED"] === "1",
    maxOutputTokens: 800,
  };
}

// ─── Subcommands ──────────────────────────────────────────────────

async function cmdInit(_projectDir: string): Promise<void> {
  console.log("reflect init — wiring PostToolUse hook + path-scoped rule + .env.example");
  console.log("");
  console.log("Steps:");
  console.log("  1. Copy .claude/settings.example.json to .claude/settings.json");
  console.log("  2. Copy .env.example to .env and fill in ANTHROPIC_API_KEY");
  console.log("  3. Restart Claude Code to load the hook");
  console.log("  4. Manual test: npx reflect status");
  console.log("");
  console.log("(Auto-wiring TODO for v1.1 — currently manual setup)");
}

async function cmdStatus(projectDir: string): Promise<void> {
  const stateFile = path.join(projectDir, ".reflect", "state.json");
  // Shell hook writes flat cum_x100 (not the SessionState.signals array — that
  // shape is reference-impl only). Type for the actual on-disk shape:
  type ShellState = {
    session_id?: string;
    turn_count?: number;
    cum_x100?: number;
    cooldown_remaining?: number;
  };
  let state: ShellState | null = null;
  try {
    state = JSON.parse(await fs.readFile(stateFile, "utf8")) as ShellState;
  } catch {
    console.log("reflect: no active session state (no triggers fired yet)");
    return;
  }

  console.log(`reflect status`);
  console.log(`  session_id:         ${state.session_id || "(none)"}`);
  console.log(`  turn_count:         ${state.turn_count ?? 0}`);
  console.log(`  cum_x100:           ${state.cum_x100 ?? 0} / 240 threshold`);
  console.log(`  cooldown_remaining: ${state.cooldown_remaining ?? 0}`);

  const guidance = await readGuidance(projectDir);
  if (guidance) {
    console.log("");
    console.log("Last reflection:");
    console.log("  " + guidance.split("\n").slice(0, 10).join("\n  "));
  }

  if (loadConfig().logEnabled) {
    const stats = await computeUsefulRate(projectDir);
    console.log("");
    console.log(`Useful rate (opt-in log): ${stats.useful}/${stats.total} = ${(stats.rate * 100).toFixed(1)}%`);
  }
}

async function cmdManual(projectDir: string, scope: TriggerScope): Promise<void> {
  const config = loadConfig();
  if (config.disabled) {
    console.log("reflect: REFLECT_DISABLED=1 — skipping");
    return;
  }

  // Auto-prune session-log entries older than LOG_TTL_HOURS (168h) on every
  // trigger entry. Cheap (file read + filter); ensures the documented TTL
  // contract is enforced automatically rather than waiting for the user to
  // run `reflect log --prune` manually.
  if (config.logEnabled) {
    await pruneOldEntries(projectDir);
  }

  console.error(`[reflect] manual trigger — scope: ${scope}`);

  const [activeRules, sessionTaskSummary, recentToolCalls, rolledBackDiff] =
    await Promise.all([
      getActiveRules(projectDir),
      summarizeTask(projectDir),
      getRecentToolCalls(projectDir, 20),
      getRolledBackDiff(projectDir),
    ]);

  if (config.debug) {
    console.error(
      `[reflect] context: rules=${activeRules.length}b task=${sessionTaskSummary.length}b calls=${recentToolCalls.length} diff=${rolledBackDiff.length}b`,
    );
  }

  const layers = assemblePrompt(
    {
      activeRules,
      sessionTaskSummary,
    },
    {
      recentToolCalls,
      rolledBackDiff,
      triggerMeta: {
        signals: [{ tier: 1, weight: 1.0, source: "manual:bypass" }],
        sumWeight: 1.0,
        timestamp: new Date().toISOString(),
      },
    },
  );

  const result = await callOpusReflection(layers, config);

  await writeGuidance(projectDir, result.reflection, {
    triggeredAt: new Date().toISOString(),
    cost: result.cost.totalUSD,
    cacheHitRate: result.cacheHitRate,
  });

  await appendLog(projectDir, config.logEnabled, {
    timestamp: new Date().toISOString(),
    session_id: process.env["CLAUDE_SESSION_ID"] ?? "manual",
    reflection: result.reflection,
    cost: result.cost,
    cache_hit_rate: result.cacheHitRate,
    latency_ms: result.latencyMs,
    trigger_meta: { sum_weight: 1.0, signal_tiers: [1] },
  });

  console.log("");
  console.log("## Reflection");
  console.log("");
  console.log(`pattern:    ${result.reflection.pattern}`);
  console.log(`signal:     ${result.reflection.signal}`);
  console.log(`adjustment: ${result.reflection.adjustment}`);
  console.log("");
  console.log(`confidence: ${result.reflection.confidence} | scope: ${result.reflection.scope} | FT: ${result.reflection.false_trigger_likelihood}`);
  console.log(`cost:       $${result.cost.totalUSD.toFixed(4)} | cache hit: ${(result.cacheHitRate * 100).toFixed(1)}% | ${result.latencyMs}ms`);
}

async function cmdTrigger(projectDir: string, sessionId: string): Promise<void> {
  // Invoked by hook (background). Same as manual but with session-id from hook.
  process.env["CLAUDE_SESSION_ID"] = sessionId;
  await cmdManual(projectDir, "session");
}

async function cmdLog(projectDir: string, prune: boolean): Promise<void> {
  if (prune) {
    const pruned = await pruneOldEntries(projectDir);
    console.log(`reflect: pruned ${pruned} entries older than 168h`);
  }

  const stats = await computeUsefulRate(projectDir);
  console.log(`reflect log — total: ${stats.total}, useful: ${stats.useful}, rate: ${(stats.rate * 100).toFixed(1)}%`);
}

async function cmdToggle(_projectDir: string, enable: boolean): Promise<void> {
  // Note: this only sets env for current process. Persistent disable = .env or shell rc.
  console.log(
    enable
      ? "reflect on (set REFLECT_DISABLED=0 in .env for persistent)"
      : "reflect off (set REFLECT_DISABLED=1 in .env for persistent)",
  );
}

// ─── Main ─────────────────────────────────────────────────────────

const HELP = `reflect — session-local metacognition harness for Claude Code

USAGE
  reflect init                              Setup hook + rule + .env.example
  reflect status                            Show current session state
  reflect manual [--scope session|recent]   Bypass threshold, fire now
  reflect log [--prune]                     Show session log stats
  reflect off / reflect on                  Disable / enable

ENVIRONMENT
  ANTHROPIC_API_KEY        Required
  REFLECT_MODEL            Default: claude-opus-4-7
  REFLECT_EFFORT           low|medium|high|xhigh — default: high
  REFLECT_TRIGGER_THRESHOLD  Default: 2.4
  REFLECT_COOLDOWN_TURNS   Default: 5
  REFLECT_LOG_ENABLED      Default: 0 (opt-in to .reflect/session-log.jsonl)
  REFLECT_DEBUG            Default: 0
  REFLECT_DISABLED         Default: 0

DOCS    https://github.com/chanjoongx/reflect
ISSUES  https://github.com/chanjoongx/reflect/issues
`;

async function main(): Promise<void> {
  const command = process.argv[2];
  const rest = process.argv.slice(3);

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    console.log("0.1.4");
    process.exit(0);
  }

  const projectDir = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

  let values: Record<string, string | boolean | undefined> = {};
  try {
    const parsed = parseArgs({
      args: rest,
      options: {
        scope: { type: "string", default: "session" },
        session: { type: "string" },
        prune: { type: "boolean", default: false },
        debug: { type: "boolean", default: false },
      },
      allowPositionals: true,
      strict: false,
    });
    values = parsed.values;
  } catch (e) {
    console.error(`Argument error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  if (values["debug"]) process.env["REFLECT_DEBUG"] = "1";

  switch (command) {
    case "init":
      await cmdInit(projectDir);
      break;
    case "status":
    case "s":
      await cmdStatus(projectDir);
      break;
    case "manual":
    case "m":
      await cmdManual(projectDir, (values["scope"] as TriggerScope) ?? "session");
      break;
    case "trigger":
      await cmdTrigger(projectDir, (values["session"] as string) ?? "unknown");
      break;
    case "log":
      await cmdLog(projectDir, !!values["prune"]);
      break;
    case "off":
      await cmdToggle(projectDir, false);
      break;
    case "on":
      await cmdToggle(projectDir, true);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run `reflect --help` for usage.");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`reflect: ${err instanceof Error ? err.message : String(err)}`);
  if (process.env["DEBUG"] || process.env["REFLECT_DEBUG"]) {
    console.error(err);
  }
  process.exit(1);
});
