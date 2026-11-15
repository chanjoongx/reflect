// scripts/smoke.mjs: run the built bundles the way Claude Code and npm do, with no API key.
// Checks what unit tests cannot: that plugin/hooks/reflect-hook.mjs and its chunks load
// under plain `node`, read JSON on stdin, exit 0, write only under .reflect/, and use no
// key but the plugin setting; and that the npm command in dist/ runs. `npm run smoke`
// builds dist/ first.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "plugin", "hooks", "reflect-hook.mjs");
const cli = join(root, "dist", "reflect.mjs");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail && !ok ? `: ${detail}` : ""}`);
  if (!ok) failed++;
}

// A clean environment: no key, no project dir, nothing inherited that could reach the API.
const baseEnv = { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "" };

function run(args, input, env = {}, file = bundle) {
  const r = spawnSync(process.execPath, [file, ...args], {
    input: input === undefined ? "" : JSON.stringify(input),
    env: { ...baseEnv, ...env },
    encoding: "utf8",
    timeout: 20_000,
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const v = run(["--version"]);
check("--version prints the package version", v.code === 0 && v.out.trim() === pkg.version, v.out + v.err);
const cv = run(["--version"], undefined, {}, cli);
check("the npm command prints the same version", cv.code === 0 && cv.out.trim() === pkg.version, cv.out + cv.err);
const notCli = run(["status"]);
check("the plugin's bundle has no CLI commands", notCli.code === 1 && notCli.out === "", notCli.out + notCli.err);

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

  // A second message, now that the agent has a recorded turn, goes to the judge.
  // The plugin has no key in its setting, so it records an auth error and calls
  // nothing, whatever key the environment or a project .env offers.
  const keyed = mkdtempSync(join(tmpdir(), "reflect-smoke-key-"));
  try {
    writeFileSync(join(keyed, ".env"), "ANTHROPIC_API_KEY=smoke-test-placeholder-not-a-key\n");
    const k = { ...hook, cwd: keyed };
    const offered = { ANTHROPIC_API_KEY: "smoke-test-placeholder-not-a-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:9", CLAUDE_PROJECT_DIR: keyed };
    run(["prompt"], k, offered);
    run(["stop"], { ...k, last_assistant_message: "Renamed the flag to --loud." }, offered);
    const second = { ...k, prompt_id: "p2", prompt: "no, keep the old flag name" };
    run(["prompt"], second, offered);
    const t0 = Date.now();
    const jk = run(["judge"], second, offered);
    const kev = readFileSync(join(keyed, ".reflect", "sessions", "smoke", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    check("the plugin uses no key but its setting: an auth error, no call",
      jk.code === 0 && Date.now() - t0 < 5_000 && kev.some((e) => e.t === "error" && e.where === "auth" && /plugin settings/.test(e.message)),
      JSON.stringify(kev.slice(-2)));
  } finally {
    rmSync(keyed, { recursive: true, force: true });
  }

  const man = run(["manual", "--agent"], undefined, { CLAUDE_PROJECT_DIR: dir }, cli);
  check("the npm command's manual mode runs and exits 0", man.code === 0 && /reflect:/.test(man.out), man.out + man.err);
  const init = run(["init"], undefined, {}, cli);
  const wired = /"args": \[\s*"([^"]+reflect\.mjs)"/.exec(init.out)?.[1];
  check("reflect init points the hooks at the npm command's bundle", init.code === 0 && !!wired && existsSync(wired), init.out.slice(0, 400));
  const cp = run(["prompt"], { ...hook, prompt_id: "p3" }, {}, cli);
  check("the npm command runs a hook too", cp.code === 0 && cp.out === "", cp.err);

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
