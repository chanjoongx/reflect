// scripts/smoke.mjs: run the built bundle the way Claude Code does, with no API key.
// Checks what unit tests cannot: that hooks/reflect-hook.mjs and its chunks load
// under plain `node`, read JSON on stdin, exit 0, and write only under .reflect/.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "hooks", "reflect-hook.mjs");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail && !ok ? `: ${detail}` : ""}`);
  if (!ok) failed++;
}

// A clean environment: no key, no project dir, nothing inherited that could reach the API.
const baseEnv = { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "" };

function run(args, input, env = {}) {
  const r = spawnSync(process.execPath, [bundle, ...args], {
    input: input === undefined ? "" : JSON.stringify(input),
    env: { ...baseEnv, ...env },
    encoding: "utf8",
    timeout: 20_000,
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const v = run(["--version"]);
check("--version prints the package version", v.code === 0 && v.out.trim() === pkg.version, v.out + v.err);

const dir = mkdtempSync(join(tmpdir(), "reflect-smoke-"));
try {
  const hook = { session_id: "smoke", prompt_id: "p1", prompt: "add a --verbose flag", cwd: dir };

  const s = run(["session-start"], { ...hook, source: "startup" });
  check("session-start exits 0 and stays silent", s.code === 0 && s.out === "", s.err);

  const p = run(["prompt"], hook);
  check("prompt hook exits 0 and stays silent", p.code === 0 && p.out === "", p.err);

  const j = run(["judge"], hook);
  const log = join(dir, ".reflect", "sessions", "smoke", "events.jsonl");
  const events = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  check("judge hook exits 0", j.code === 0, j.err);
  check("a session opener is skipped without a model call", events.some((e) => e.t === "skip" && e.reason === "session_opener"),
    JSON.stringify(events));

  const t = run(["tool"], { ...hook, tool_name: "Edit" });
  check("tool hook exits 0 with nothing to deliver", t.code === 0 && t.out === "", t.err);

  const wk = run(["reflect-worker", dir, "smoke", "no-such-fire"]);
  check("a worker with no matching fire exits 0 and writes nothing", wk.code === 0 && wk.out === "" && wk.err === "" &&
    !readdirSync(join(dir, ".reflect", "sessions", "smoke")).some((f) => f.startsWith("reflecting-")), wk.err);

  const bad = spawnSync(process.execPath, [bundle, "prompt"], { input: "{not json", env: baseEnv, encoding: "utf8" });
  check("malformed stdin still exits 0", bad.status === 0, bad.stderr);

  const top = readdirSync(dir).sort().join(",");
  check("nothing is written outside .reflect/", top === ".reflect", top);
  check(".reflect/ ignores itself in git", readFileSync(join(dir, ".reflect", ".gitignore"), "utf8").includes("*"));

  const off = mkdtempSync(join(tmpdir(), "reflect-smoke-off-"));
  try {
    const d = run(["prompt"], { ...hook, cwd: off }, { REFLECT_DISABLED: "1" });
    check("REFLECT_DISABLED=1 is a no-op that writes nothing", d.code === 0 && readdirSync(off).length === 0);
  } finally {
    rmSync(off, { recursive: true, force: true });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.error(`${failed} smoke check(s) failed`);
  process.exit(1);
}
