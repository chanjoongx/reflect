// src/entry.ts: the npm package's `reflect` command (dist/reflect.mjs). It runs
// the CLI, and the hooks when they are wired into settings.json by hand. The
// installed plugin is a mod that Claude Code loads itself (src/mod/reflect.ts).

import { runHookMode, start } from "./hook/main.js";
import { withProjectEnv } from "./hook/project-env.js";
import { runCli } from "./cli/cli.js";

start(async (argv) => (await runHookMode(argv, process.env, (dir) => withProjectEnv(dir, process.env))) ?? runCli(argv));
