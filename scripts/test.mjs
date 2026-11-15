// Runs every *.test.ts under src/ and bench/ with node's test runner.
// `node --test "src/**/*.test.ts"` needs Node 21 or later to expand the glob,
// and the hooks support Node 20, so the files are listed here instead.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const files = ["src", "bench"]
  .flatMap((dir) => readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f))))
  .filter((f) => f.endsWith(".test.ts") && !f.includes("node_modules"))
  .sort();

if (files.length === 0) {
  console.error("scripts/test.mjs: no test files found");
  process.exit(1);
}

const r = spawnSync(process.execPath, ["--test", "--import", "tsx", ...process.argv.slice(2), ...files], {
  stdio: "inherit",
});
process.exitCode = r.status ?? 1;
