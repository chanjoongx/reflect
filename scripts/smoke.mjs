// scripts/smoke.mjs: run the built bundle the way Claude Code does, with no API key.
// Checks what unit tests cannot: that plugin/hooks/reflect-hook.mjs and its chunks load
// under plain `node`, read JSON on stdin, exit 0, and write only under .reflect/.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "plugin", "hooks", "reflect-hook.mjs");
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

  const t = run(["tool"], { ...hook, tool_name: "Edit", tool_input: { file_path: "src/a.ts" } });
  check("tool hook exits 0 with nothing to deliver", t.code === 0 && t.out === "", t.err);

  const tf = run(["tool-failed"], { ...hook, tool_name: "Bash", tool_input: { command: "npm test" } });
  check("tool-failed hook exits 0 and stays silent", tf.code === 0 && tf.out === "", tf.err);

  const st = run(["stop"], { ...hook, last_assistant_message: "Added the flag." });
  check("stop hook exits 0, stays silent and records the turn under .reflect/",
    st.code === 0 && st.out === "" && existsSync(join(dir, ".reflect", "sessions", "smoke", "agent", "p1.jsonl")), st.err);

  const wk = run(["reflect-worker", dir, "smoke", "no-such-fire"]);
  check("a worker with no matching fire exits 0 and writes nothing", wk.code === 0 && wk.out === "" && wk.err === "" &&
    !readdirSync(join(dir, ".reflect", "sessions", "smoke")).some((f) => f.startsWith("reflecting-")), wk.err);

  // The plugin's /brain-reflect makes no API call, whatever key is around.
  // (This verdict line is in the 0.2.1 format, so it also covers old logs.)
  const verdict = { t: "verdict", at: new Date().toISOString(), promptId: "p1", label: "correction", confidence: "high",
    evidence: "only the parser", rationale: "", priorSummary: "", prompt: "only the parser", model: "smoke", costUSD: 0, latencyMs: 0 };
  appendFileSync(log, `${JSON.stringify(verdict)}${String.fromCharCode(10)}`);
  const t0 = Date.now();
  const man = run(["manual", "--agent", "--plugin", "--session", "smoke"], undefined, { ANTHROPIC_API_KEY: "smoke-test-placeholder-not-a-key", CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY: "smoke-test-placeholder-not-a-key", CLAUDE_PROJECT_DIR: dir });
  check("the plugin's command ignores a key in the environment and makes no API call",
    man.code === 0 && /1 read as pushback/.test(man.out) && /No outside reflection/.test(man.out) && Date.now() - t0 < 5_000, man.out + man.err);

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
