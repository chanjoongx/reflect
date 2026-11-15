// src/hook/main.ts: the hook and worker modes, shared by the plugin's entry
// (src/plugin-entry.ts, bundled into plugin/hooks/reflect-hook.mjs) and the
// CLI's (src/entry.ts, bundled into dist/reflect.mjs for the npm package).
//
// v0.1.4 shipped one specification in five implementations (two bash hooks, two
// PowerShell hooks, a TypeScript reference that its own header called
// divergent). v0.2 has one, and each entry decides only where its settings
// come from: the plugin from the variables Claude Code passes a plugin, the
// CLI from its environment and the project .env.
//
//   <entry> <session-start|prompt|judge|tool|tool-failed|stop>  (from the hook wiring, JSON on stdin)
//   <entry> reflect-worker <dir> <session> <id>                 (started by the judge hook)

import { existsSync } from "node:fs";
import { appendEvent, isDisabled, now } from "./state.js";
import { redactString, safeTruncate } from "../redact.js";
import {
  HOOK_MODES,
  WORKER_MODE,
  defaultDeps,
  projectDirOf,
  reflectForFire,
  runHook,
  type HookInput,
  type HookMode,
} from "./run.js";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Resolves once the bytes are handed to the OS, so a following process.exit cannot cut them off. */
function writeOut(s: string): Promise<void> {
  return new Promise((resolve) => process.stdout.write(s, () => resolve()));
}

/**
 * Runs a hook or worker mode and returns its exit code, or null when argv names
 * neither. `base` holds CLAUDE_PROJECT_DIR; `envFor` gives the settings for the
 * project the hook resolved.
 */
export async function runHookMode(
  argv: string[],
  base: NodeJS.ProcessEnv,
  envFor: (projectDir: string) => NodeJS.ProcessEnv,
): Promise<number | null> {
  const mode = argv[0] ?? "";
  if ((HOOK_MODES as readonly string[]).includes(mode)) {
    // A hook never fails the developer's turn: every path below exits 0.
    let input: HookInput = {};
    try {
      const raw = await readStdin();
      input = raw.trim() ? (JSON.parse(raw) as HookInput) : {};
    } catch {
      return 0;
    }
    const projectDir = projectDirOf(input, base);
    const out = await runHook(mode as HookMode, input, projectDir, defaultDeps(envFor(projectDir)));
    if (out) await writeOut(out + "\n");
    return 0;
  }
  if (mode === WORKER_MODE) {
    const [, projectDir, sessionId, firePromptId] = argv;
    if (!projectDir || !sessionId || !firePromptId || !existsSync(projectDir)) return 0;
    const env = envFor(projectDir);
    if (isDisabled(projectDir, env)) return 0;
    try {
      await reflectForFire(projectDir, sessionId, firePromptId, defaultDeps(env));
    } catch (e) {
      try {
        appendEvent(projectDir, sessionId, {
          t: "error",
          at: now(),
          where: "reflection",
          message: safeTruncate(redactString(e instanceof Error ? e.message : String(e)), 400),
        });
      } catch {
        /* nowhere left to report it */
      }
    }
    return 0;
  }
  return null;
}

/**
 * Runs an entry's main function on this process's arguments and exits with its
 * code. A hook or worker mode never prints an error and always exits 0.
 *
 * No process.exit() on the normal path. On Windows, exiting while fetch's
 * sockets are still closing aborts Node with a libuv assertion
 * (`!(handle->flags & UV_HANDLE_CLOSING)`, measured on Node 24.13: 5 of 5 runs
 * after an API call). Setting the exit code and letting the loop drain exits
 * cleanly. The timer only matters if something keeps the loop alive.
 */
export function start(main: (argv: string[]) => Promise<number>): void {
  const argv = process.argv.slice(2);
  const quiet = [...HOOK_MODES, WORKER_MODE].includes(argv[0] as (typeof HOOK_MODES)[number]);
  const finish = (code: number): void => {
    process.exitCode = code;
    setTimeout(() => process.exit(code), 5_000).unref();
  };
  main(argv).then(finish, (e: unknown) => {
    if (!quiet) console.error(`reflect: ${e instanceof Error ? e.message : String(e)}`);
    finish(quiet ? 0 : 1);
  });
}
