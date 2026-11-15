// src/hook/main.ts: argument dispatch shared by the hooks and the CLI.
//
// v0.1.4 shipped one specification in five implementations (two bash hooks, two
// PowerShell hooks, a TypeScript reference that its own header called
// divergent). v0.2 has one: src/entry.ts calls this, and scripts/build-hook.mjs
// bundles it with its dependencies into hooks/reflect-hook.mjs, so a plugin
// install needs nothing but `node`, and the npm `reflect` bin is the same file.
//
//   node reflect-hook.mjs <session-start|prompt|judge|tool>   (from hooks.json, JSON on stdin)
//   node reflect-hook.mjs <status|manual|doctor|init|on|off>  (the CLI, same code)

import { HOOK_MODES, defaultDeps, projectDirOf, runHook, withProjectEnv, type HookInput, type HookMode } from "./run.js";
import { runCli } from "../cli/cli.js";

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

export async function main(argv: string[]): Promise<number> {
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
    const projectDir = projectDirOf(input, process.env);
    const env = withProjectEnv(projectDir, process.env);
    const out = await runHook(mode as HookMode, input, projectDir, defaultDeps(env));
    if (out) await writeOut(out + "\n");
    return 0;
  }
  return runCli(argv);
}
