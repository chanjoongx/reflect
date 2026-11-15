// src/entry.ts: what `node hooks/reflect-hook.mjs` and the npm `reflect` bin run.
// Kept apart from src/hook/main.ts so tests can import main() without running it.

import { HOOK_MODES } from "./hook/run.js";
import { main } from "./hook/main.js";

const argv = process.argv.slice(2);
const hookMode = (HOOK_MODES as readonly string[]).includes(argv[0] ?? "");

main(argv).then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (!hookMode) console.error(`reflect: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(hookMode ? 0 : 1);
  },
);
