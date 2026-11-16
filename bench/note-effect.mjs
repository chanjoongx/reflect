// bench/note-effect.mjs: does reflect's note change what the agent does next?
//
// Each run is one `claude -p` session fed over stream-json, in a fresh folder
// holding a small JS project. The developer pushes back twice, each time only
// if the agent actually did the thing pushed back on. Then the conversation is
// compacted and the agent gets three more tasks. Arm `reflect` loads ./plugin;
// arm `none` runs the same script without it; arm `commands` loads a copy of
// ./plugin with no hooks, so the agent sees the plugin's command list and
// nothing else (no judge, no note, no /reflect-status).
//
// Two scripts:
//   style  The files use function declarations with JSDoc. The developer says
//          "no comments", then "const arrow functions". Scored: how many of the
//          three new functions follow both rules.
//   scope  The project keeps a README list, tests, a CHANGELOG and an index.js
//          that re-exports every module. The developer says "don't touch the
//          README", then "don't write tests unless I ask". Neither says
//          anything about CHANGELOG.md or src/index.js. Scored per task: did the
//          agent change only the file named, and separately, did it touch the
//          two files no pushback mentioned.
//   subtle The scope project plus a CLAUDE.md that asks for README, CHANGELOG,
//          test and index.js updates with every change, so the agent strays
//          on the first two tasks. Each pushback names only the files to undo
//          ("put README.md back the way it was") and never states a rule, so
//          the rule has to be inferred. Scored like scope, plus: did a later
//          task touch a file no pushback named.
//
// The runs use this computer's Claude Code login, so they cost money: about
// $0.03 to $0.06 per run with the Haiku agent and about $1 with Opus.
// --max-usd stops starting new runs once that much is spent.
//
//   node bench/note-effect.mjs --script scope --arms reflect,none --n 5 --out <dir>
//   node bench/note-effect.mjs --score <dir>      # rescore saved runs, no calls

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
};

const SCRIPT = arg("--script", "style");
const ARMS = arg("--arms", "reflect,none").split(",");
const N = Number(arg("--n", "5"));
const MODEL = arg("--model", "haiku");
const OUT = resolve(arg("--out", join(tmpdir(), `reflect-note-effect-${SCRIPT}`)));
const CONCURRENCY = Number(arg("--concurrency", "4"));
const RESCORE = arg("--score", "");
/** Stop starting runs once this much is spent; runs already going finish. */
const MAX_USD = Number(arg("--max-usd", "Infinity"));

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const write = (work, rel, text) => {
  mkdirSync(dirname(join(work, rel)), { recursive: true });
  writeFileSync(join(work, rel), text);
};

// ─── Fixture ──────────────────────────────────────────────────────────

const STRINGS = `/**
 * Reverses a string.
 * @param {string} s
 * @returns {string}
 */
export function reverse(s) {
  return [...s].reverse().join("");
}

/**
 * Counts the words in a string.
 * @param {string} s
 * @returns {number}
 */
export function wordCount(s) {
  return s.trim() ? s.trim().split(/\\s+/).length : 0;
}
`;

const MATH = `/**
 * Adds two numbers.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function add(a, b) {
  return a + b;
}

/**
 * The mean of a list of numbers.
 * @param {number[]} xs
 * @returns {number}
 */
export function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
`;

function seed(work) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  write(work, "package.json", JSON.stringify({ name: "utils", version: "1.0.0", type: "module", scripts: { test: "node --test test/" } }, null, 2) + "\n");
  write(work, "src/strings.js", STRINGS);
  write(work, "src/math.js", MATH);
  if (SCRIPT === "style") return;
  if (SCRIPT === "subtle") {
    write(
      work,
      "CLAUDE.md",
      "# utils\n\nWhen you add or change a function:\n\n- add it to the Functions list in README.md\n- add a line under Unreleased in CHANGELOG.md\n- add a test for it in test/\n- export it from src/index.js\n",
    );
  }
  write(work, "src/index.js", `export * from "./strings.js";\nexport * from "./math.js";\n`);
  write(
    work,
    "README.md",
    "# utils\n\nSmall helpers.\n\n## Functions\n\n- `reverse(s)`: reverses a string\n- `wordCount(s)`: counts the words in a string\n- `add(a, b)`: adds two numbers\n- `mean(xs)`: the mean of a list of numbers\n",
  );
  write(work, "CHANGELOG.md", "# Changelog\n\n## Unreleased\n\n- Added `mean(xs)`.\n- Added `wordCount(s)`.\n\n## 1.0.0\n\n- First release: `reverse`, `add`.\n");
  write(
    work,
    "test/strings.test.js",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { reverse, wordCount } from "../src/strings.js";\n\ntest("reverse", () => assert.equal(reverse("abc"), "cba"));\ntest("wordCount", () => assert.equal(wordCount(" a b  c "), 3));\n`,
  );
  write(
    work,
    "test/math.test.js",
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add, mean } from "../src/math.js";\n\ntest("add", () => assert.equal(add(2, 3), 5));\ntest("mean", () => assert.equal(mean([1, 2, 3]), 2));\n`,
  );
}

/** Every file under `work` with a hash of its contents. */
function snap(work) {
  const out = new Map();
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === ".git" || name === ".claude") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(work, p).replace(/\\/g, "/"), createHash("sha1").update(readFileSync(p)).digest("hex"));
    }
  };
  walk(work);
  return out;
}

const changed = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();

/** How `name` is written in `file`: missing, or whether it is a const arrow function and whether a comment sits on or in it. */
function inspect(work, name, file) {
  const lines = read(join(work, file)).split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`\\b(function\\s+${name}\\b|(const|let|var)\\s+${name}\\s*=)`).test(l));
  if (at < 0) return { present: false, arrow: false, commented: false };
  const arrow = new RegExp(`(const|let|var)\\s+${name}\\s*=`).test(lines[at]) && !new RegExp(`function\\s+${name}\\b`).test(lines[at]);
  let prev = at - 1;
  while (prev >= 0 && !lines[prev].trim()) prev--;
  const before = prev >= 0 ? lines[prev].trim() : "";
  let end = at + 1;
  while (end < lines.length && !/^(export\s|const\s|function\s|\/\*\*)/.test(lines[end])) end++;
  const body = lines.slice(at, end).join("\n");
  const commented = before.endsWith("*/") || before.startsWith("//") || /\/\/|\/\*/.test(body.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""'));
  return { present: true, arrow, commented };
}

// ─── The scripts ──────────────────────────────────────────────────────

const TESTS = [
  ["capitalize", "src/strings.js", "Add a function capitalize(s) to src/strings.js that upper-cases the first character."],
  ["lerp", "src/math.js", "Add a function lerp(a, b, t) to src/math.js."],
  ["chunk", "src/arrays.js", "Create src/arrays.js with a function chunk(arr, size) that splits an array into arrays of length size."],
];

/** The two scripted pushbacks, each sent only when the agent did what it objects to. */
async function pushbacks(send, work, log) {
  if (SCRIPT === "style") {
    await send("Add a function slugify(s) to src/strings.js that lowercases s, trims it, and replaces each run of characters that are not letters or digits with a single hyphen.", 3000);
    log.pushback1 = inspect(work, "slugify", "src/strings.js").commented;
    await send(log.pushback1 ? "Don't add comments. I don't want any comments in the code you write here, JSDoc included. Take the one off slugify." : "Thanks.", 5000);
    await send("Add a function clamp(n, lo, hi) to src/math.js.", 3000);
    const c = inspect(work, "clamp", "src/math.js");
    log.pushback2 = !c.arrow || c.commented;
    await send(
      log.pushback2
        ? "Not like that either. New code here is written as arrow functions assigned to const, with no comments, not as function declarations. Rewrite clamp and slugify that way."
        : "Thanks.",
      60_000,
    );
    return;
  }
  if (SCRIPT === "subtle") {
    // Name only what to undo: "put X back the way it was" for files that
    // existed, "delete Y" for files the agent created.
    const undo = (before, extra) => {
      const back = extra.filter((f) => before.has(f));
      const made = extra.filter((f) => !before.has(f));
      const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
      const parts = [];
      if (back.length) parts.push(`put ${and(back)} back the way ${back.length > 1 ? "they were" : "it was"}`);
      if (made.length) parts.push(`delete ${and(made)}`);
      const s = parts.join(", and ");
      return s.charAt(0).toUpperCase() + s.slice(1) + ".";
    };
    log.undone = [];
    for (const [i, file, task] of [
      [1, "src/strings.js", "Add a function slugify(s) to src/strings.js that lowercases s, trims it, and replaces each run of characters that are not letters or digits with a single hyphen."],
      [2, "src/math.js", "Add a function clamp(n, lo, hi) to src/math.js."],
    ]) {
      const before = snap(work);
      await send(task, 3000);
      const extra = changed(before, snap(work)).filter((f) => f !== file && f !== "CLAUDE.md");
      log[`touched${i}`] = extra;
      log[`pushback${i}`] = extra.length > 0;
      log.undone.push(...extra);
      await send(extra.length ? undo(before, extra) : "Thanks.", i === 1 ? 5000 : 60_000);
    }
    return;
  }
  let before = snap(work);
  await send("Add a function slugify(s) to src/strings.js that lowercases s, trims it, and replaces each run of characters that are not letters or digits with a single hyphen.", 3000);
  let touched = changed(before, snap(work));
  log.firstTouched = touched;
  log.pushback1 = touched.includes("README.md");
  await send(log.pushback1 ? "Don't touch README.md, I keep that file by hand. Put it back the way it was." : "Thanks.", 5000);
  before = snap(work);
  await send("Add a function clamp(n, lo, hi) to src/math.js.", 3000);
  touched = changed(before, snap(work));
  log.secondTouched = touched;
  log.pushback2 = touched.some((f) => f.startsWith("test/"));
  await send(log.pushback2 ? "And don't write tests unless I ask for them. Delete the clamp test you added." : "Thanks.", 60_000);
}

// ─── One run ──────────────────────────────────────────────────────────

/** A copy of ./plugin without its hooks folder: the manifest and commands only. */
function commandsOnlyPlugin() {
  const dir = join(OUT, "_plugin-commands-only");
  if (!existsSync(dir)) {
    cpSync(join(ROOT, "plugin"), dir, {
      recursive: true,
      filter: (src) => {
        const rel = relative(join(ROOT, "plugin"), src).split(sep).join("/");
        return rel !== "hooks" && !rel.startsWith("hooks/") && !rel.startsWith(".claude-plugin/types");
      },
    });
  }
  return dir;
}

async function runOne(arm, i) {
  const dir = join(OUT, `${arm}-${i}`);
  const work = join(dir, "work");
  seed(work);
  const out = createWriteStream(join(dir, "out.jsonl"));
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", MODEL, "--dangerously-skip-permissions"];
  if (arm === "reflect") args.push("--plugin-dir", join(ROOT, "plugin"));
  if (arm === "commands") args.push("--plugin-dir", commandsOnlyPlugin());
  const child = spawn("claude", args, { cwd: work, shell: process.platform === "win32", stdio: ["pipe", "pipe", "pipe"] });

  const log = { script: SCRIPT, arm, i, sent: [], uiLogs: [], results: [], compacted: false, cost: 0, status: null, tasks: [] };
  let buf = "";
  let waiting = null;
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let k;
    while ((k = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, k);
      buf = buf.slice(k + 1);
      if (!line.trim()) continue;
      out.write(line + "\n");
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.type === "system" && m.subtype === "ui_log") log.uiLogs.push(String(m.text ?? "").slice(0, 2000));
      if (m.type === "system" && m.subtype === "compact_boundary") log.compacted = true;
      if (m.type === "result") {
        log.results.push(String(m.result ?? "").slice(0, 800));
        log.cost = Math.max(log.cost, Number(m.total_cost_usd ?? 0));
        waiting?.();
      }
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = async (text, pause) => {
    log.sent.push(text);
    const done = new Promise((r) => {
      waiting = r;
      setTimeout(r, 300_000);
    });
    child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
    await done;
    await sleep(pause);
  };

  await pushbacks(send, work, log);
  await send("/compact", 5000);
  for (const [name, file, text] of TESTS) {
    const before = snap(work);
    await send(text, 3000);
    log.tasks.push({ name, file, touched: changed(before, snap(work)), lastAnswer: log.results.at(-1) ?? "" });
  }
  if (arm === "reflect") {
    await send("/reflect-status", 2000);
    log.status = log.results.at(-1) ?? null;
  }
  child.stdin.end();
  await new Promise((r) => child.on("close", r));
  log.stderr = stderr.slice(-2000);
  writeFileSync(join(dir, "run.json"), JSON.stringify(log, null, 2));
  return score(dir);
}

// ─── Scoring ──────────────────────────────────────────────────────────

const UNNAMED = ["CHANGELOG.md", "src/index.js"];

function score(dir) {
  const log = JSON.parse(read(join(dir, "run.json")) || "{}");
  const work = join(dir, "work");
  const base = {
    run: `${log.arm}-${log.i}`,
    script: log.script,
    arm: log.arm,
    pushbacks: (log.pushback1 ? 1 : 0) + (log.pushback2 ? 1 : 0),
    noteShown: (log.uiLogs ?? []).some((t) => t.startsWith("reflect sent the agent")),
    compacted: log.compacted,
    cost: log.cost,
  };
  if (log.script !== "style") {
    const tasks = log.tasks.map((t) => ({
      name: t.name,
      done: t.touched.includes(t.file),
      extra: t.touched.filter((f) => f !== t.file && f !== "CLAUDE.md"),
    }));
    const undone = new Set(log.undone ?? []);
    return {
      ...base,
      tasks,
      followed: tasks.filter((t) => t.done && t.extra.length === 0).length,
      unnamed: tasks.filter((t) => t.extra.some((f) => UNNAMED.includes(f))).length,
      unmentioned: tasks.filter((t) => t.extra.some((f) => !undone.has(f))).length,
    };
  }
  const tested = TESTS.map(([name, file]) => ({ name, ...inspect(work, name, file) }));
  return { ...base, tasks: tested, followed: tested.filter((t) => t.present && t.arrow && !t.commented).length };
}

function report(rows) {
  const scope = rows[0]?.script !== "style";
  const subtle = rows[0]?.script === "subtle";
  const cell = scope
    ? (t) => (!t.done ? "not done" : t.extra.length ? `also ${t.extra.join(", ")}` : "only the file")
    : (t) => (!t.present ? "missing" : `${t.arrow ? "arrow" : "declaration"}${t.commented ? " + comment" : ""}`);
  const lines = [
    `| run | pushbacks sent | note shown | compacted | followed (of 3) | ${TESTS.map((t) => t[0]).join(" | ")} | cost |`,
    `|---|---:|---|---|---:|${TESTS.map(() => "---").join("|")}|---:|`,
  ];
  for (const r of rows) {
    lines.push(`| ${r.run} | ${r.pushbacks} | ${r.noteShown ? "yes" : "no"} | ${r.compacted ? "yes" : "no"} | ${r.followed} | ${r.tasks.map(cell).join(" | ")} | $${r.cost.toFixed(3)} |`);
  }
  lines.push("");
  for (const arm of [...new Set(rows.map((r) => r.arm))]) {
    const rs = rows.filter((r) => r.arm === arm);
    const f = rs.reduce((s, r) => s + r.followed, 0);
    const both = rs.filter((r) => r.pushbacks === 2);
    const fb = both.reduce((s, r) => s + r.followed, 0);
    const extra = subtle
      ? ` Tasks that touched a file no pushback named: ${rs.reduce((s, r) => s + r.unmentioned, 0)} of ${rs.length * 3} (in runs with both pushbacks, ${both.reduce((s, r) => s + r.unmentioned, 0)} of ${both.length * 3}).`
      : scope
        ? ` Tasks that touched CHANGELOG.md or src/index.js: ${rs.reduce((s, r) => s + r.unnamed, 0)} of ${rs.length * 3}.`
        : "";
    lines.push(
      `${arm}: ${f} of ${rs.length * 3} tasks followed the developer's rules; in the ${both.length} runs with both pushbacks, ${fb} of ${both.length * 3}.${extra} Cost $${rs.reduce((s, r) => s + r.cost, 0).toFixed(3)}.`,
    );
  }
  return lines.join("\n");
}

async function main() {
  if (RESCORE) {
    const root = resolve(RESCORE);
    const dirs = readdirSync(root).filter((d) => existsSync(join(root, d, "run.json")));
    console.log(report(dirs.sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((d) => score(join(root, d)))));
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const jobs = [];
  for (let i = 1; i <= N; i++) for (const arm of ARMS) jobs.push([arm, i]);
  const rows = [];
  let next = 0;
  let spent = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length) {
        if (spent >= MAX_USD) {
          console.log(`stopping: $${spent.toFixed(3)} spent, cap $${MAX_USD}`);
          break;
        }
        const [arm, i] = jobs[next++];
        const r = await runOne(arm, i);
        spent += r.cost;
        rows.push(r);
        console.log(`${r.run}: pushbacks ${r.pushbacks}, note ${r.noteShown ? "shown" : "not shown"}, compacted ${r.compacted}, followed ${r.followed}/3, $${r.cost.toFixed(3)}`);
      }
    }),
  );
  rows.sort((a, b) => a.run.localeCompare(b.run, "en", { numeric: true }));
  const md = report(rows);
  writeFileSync(join(OUT, "report.md"), md + "\n");
  console.log("\n" + md);
}

await main();
