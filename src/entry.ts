// src/entry.ts: what `node plugin/hooks/reflect-hook.mjs` and the npm `reflect` bin run.
// Kept apart from src/hook/main.ts so tests can import main() without running it.

import { HOOK_MODES, WORKER_MODE } from "./hook/run.js";
import { main } from "./hook/main.js";

const argv = process.argv.slice(2);
const quiet = [...HOOK_MODES, WORKER_MODE].includes(argv[0] as (typeof HOOK_MODES)[number]);

// No process.exit() on the normal path. On Windows, exiting while fetch's
// sockets are still closing aborts Node with a libuv assertion
// (`!(handle->flags & UV_HANDLE_CLOSING)`, measured on Node 24.13: 5 of 5 runs
// after an API call). Setting the exit code and letting the loop drain exits
// cleanly. The timer only matters if something keeps the loop alive.
function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 5_000).unref();
}

main(argv).then(finish, (e: unknown) => {
  if (!quiet) console.error(`reflect: ${e instanceof Error ? e.message : String(e)}`);
  finish(quiet ? 0 : 1);
});
