// src/cli/cli.test.ts: `reflect init` wires known hook modes, and the plugin
// declares no hooks at all (it is a mod: hooks.json names its module only).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyInit, hookSettings, isReflectHook, mergeReflectHooks, removeReflectHooks } from "./cli.js";
import { HOOK_MODES } from "../hook/run.js";

interface Hook { type: string; command: string; args?: string[]; timeout?: number; async?: boolean }
interface Group { matcher?: string; hooks: Hook[] }
type Wiring = Record<string, Group[]>;

const BUNDLE = "/abs/reflect.mjs";
const local = (hookSettings(BUNDLE) as { hooks: Wiring }).hooks;
const all = Object.values(local).flatMap((gs) => gs.flatMap((g) => g.hooks));

test("reflect init runs the given bundle, in exec form, with a known mode", () => {
  assert.ok(all.length > 0);
  for (const h of all) {
    assert.equal(h.type, "command");
    assert.equal(h.command, "node");
    assert.equal(h.args?.[0], BUNDLE);
    assert.ok((HOOK_MODES as readonly string[]).includes(h.args?.[1] ?? ""), `unknown mode ${h.args?.[1]}`);
  }
});

test("only the judge runs in the background; the hooks that deliver guidance are synchronous", () => {
  assert.deepEqual(all.filter((h) => h.async).map((h) => h.args?.[1]), ["judge"]);
  for (const h of all.filter((x) => !x.async)) assert.ok((h.timeout ?? 0) > 0 && (h.timeout ?? 99) <= 10);
});

test("the plugin declares no hook of any type, only the mod's module", () => {
  const hooks = JSON.parse(readFileSync("plugin/hooks/hooks.json", "utf8")) as Record<string, unknown>;
  assert.deepEqual(hooks, { modules: ["./reflect.ts"] });
  assert.ok(existsSync("plugin/hooks/reflect.ts"), "run npm run build");
});

// reflect init --write / --remove

const OLD = String.raw`C:\Users\someone\AppData\Roaming\npm\node_modules\@chanjoongx\reflect\dist\reflect.mjs`;
const userHook = (command: string) => ({ type: "command", command });
const mine = () => ({
  permissions: { allow: ["Bash(npm test)"] },
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [userHook("./lint.sh")] }],
    Stop: [{ hooks: [userHook("notify-send done")] }],
  },
  model: "opus",
});
const reflectEntries = (s: unknown) =>
  Object.values((s as { hooks?: Wiring }).hooks ?? {}).flatMap((gs) => gs.flatMap((g) => g.hooks)).filter(isReflectHook);

test("isReflectHook knows a reflect.mjs path in args or command, with either slash, and nothing else", () => {
  assert.ok(isReflectHook({ type: "command", command: "node", args: [BUNDLE, "prompt"] }));
  assert.ok(isReflectHook({ type: "command", command: "node", args: [OLD, "stop"] }));
  assert.ok(isReflectHook({ type: "command", command: "/usr/lib/node_modules/@chanjoongx/reflect/dist/reflect.mjs" }));
  assert.ok(!isReflectHook({ type: "command", command: "node", args: ["/x/notreflect.mjs"] }));
  assert.ok(!isReflectHook({ type: "command", command: "node", args: ["/x/reflect.mjs.bak"] }));
  assert.ok(!isReflectHook({ type: "prompt", prompt: "reflect.mjs" }));
  assert.ok(!isReflectHook(userHook("./lint.sh")));
});

test("--write on empty settings gives exactly the init wiring", () => {
  const r = mergeReflectHooks({}, BUNDLE);
  assert.deepEqual(r.settings, hookSettings(BUNDLE));
  assert.equal(r.added, all.length);
  assert.equal(r.removed, 0);
});

test("--write keeps other keys and hooks in their order and appends reflect's groups", () => {
  const before = mine();
  const r = mergeReflectHooks(before, BUNDLE);
  assert.deepEqual(before, mine(), "the input is not changed");
  assert.deepEqual(Object.keys(r.settings), ["permissions", "hooks", "model"]);
  const hooks = r.settings["hooks"] as Wiring;
  assert.deepEqual(Object.keys(hooks), ["PreToolUse", "Stop", "SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure"]);
  assert.deepEqual(hooks["PreToolUse"], mine().hooks.PreToolUse);
  assert.deepEqual(hooks["Stop"]?.[0], mine().hooks.Stop[0]);
  assert.deepEqual(hooks["Stop"]?.[1], local["Stop"]?.[0]);
  assert.equal(reflectEntries(r.settings).length, all.length);
});

test("--write twice gives the same settings", () => {
  const once = mergeReflectHooks(mine(), BUNDLE);
  const twice = mergeReflectHooks(once.settings, BUNDLE);
  assert.deepEqual(twice.settings, once.settings);
  assert.equal(twice.removed, all.length);
});

test("--write replaces entries from an older install path and keeps a user hook that shared their group", () => {
  const before = {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "node", args: [OLD, "prompt"] }, userHook("./mine.sh")] }],
      Stop: [{ hooks: [{ type: "command", command: "node", args: [OLD.split("\\").join("/"), "stop"] }] }],
    },
  };
  const r = mergeReflectHooks(before, BUNDLE);
  assert.equal(r.removed, 2);
  const hooks = r.settings["hooks"] as Wiring;
  assert.deepEqual(hooks["UserPromptSubmit"]?.[0], { hooks: [userHook("./mine.sh")] });
  assert.deepEqual(hooks["Stop"], local["Stop"], "the emptied group is gone");
  assert.ok(reflectEntries(r.settings).every((h) => h.args?.[0] === BUNDLE));
});

test("--remove takes out reflect's entries only, and the hooks key when nothing is left", () => {
  const r = removeReflectHooks(mergeReflectHooks(mine(), BUNDLE).settings);
  assert.deepEqual(r.settings, mine());
  assert.equal(r.removed, all.length);
  const bare = removeReflectHooks({ ...(hookSettings(BUNDLE) as object), model: "opus" });
  assert.deepEqual(bare.settings, { model: "opus" });
  assert.equal(removeReflectHooks(mine()).removed, 0);
});

/** A temporary project directory, removed after the test. */
function project(t: { after: (fn: () => void) => void }, settings?: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "reflect-init-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, ".claude", "settings.local.json");
  if (settings !== undefined) {
    mkdirSync(join(dir, ".claude"));
    writeFileSync(file, settings);
  }
  return { dir, file };
}

test("--write creates .claude/settings.local.json with no backup when there was none", (t) => {
  const { dir, file } = project(t);
  const r = applyInit(dir, BUNDLE, "write");
  assert.equal(r.code, 0);
  const text = readFileSync(file, "utf8");
  assert.equal(text, `${JSON.stringify(hookSettings(BUNDLE), null, 2)}\n`);
  assert.ok(!existsSync(`${file}.bak`));
  assert.ok(r.out.some((l) => l.includes("Restart Claude Code")));
});

test("--write on an empty file treats it as no settings", (t) => {
  const { dir, file } = project(t, "");
  assert.equal(applyInit(dir, BUNDLE, "write").code, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), hookSettings(BUNDLE));
});

test("--write backs up the old file, and a second run writes nothing", (t) => {
  const old = `{\n    "model": "opus"\n}`;
  const { dir, file } = project(t, old);
  const r = applyInit(dir, BUNDLE, "write");
  assert.equal(r.code, 0);
  assert.equal(readFileSync(`${file}.bak`, "utf8"), old);
  assert.ok(r.out.some((l) => l.includes(`${file}.bak`)));
  const written = readFileSync(file, "utf8");
  assert.ok(written.endsWith("}\n") && written.includes('\n  "model": "opus"'));
  rmSync(`${file}.bak`);
  const again = applyInit(dir, BUNDLE, "write");
  assert.equal(again.code, 0);
  assert.equal(readFileSync(file, "utf8"), written);
  assert.ok(!existsSync(`${file}.bak`), "no backup when nothing changes");
  assert.ok(again.out.some((l) => l.includes("Nothing to change")));
});

test("invalid JSON, or hooks that are not an object, is refused with nothing written", (t) => {
  for (const bad of ["{ not json", '{ "hooks": [] }', "[]"]) {
    const { dir, file } = project(t, bad);
    for (const mode of ["write", "remove"] as const) {
      const r = applyInit(dir, BUNDLE, mode);
      assert.equal(r.code, 1, `${mode} on ${bad}`);
      assert.ok(r.err.join(" ").includes(file));
      assert.equal(readFileSync(file, "utf8"), bad);
      assert.ok(!existsSync(`${file}.bak`));
    }
  }
});

test("--remove leaves the rest of the file, and says so when there was nothing to remove", (t) => {
  const { dir, file } = project(t, JSON.stringify(mine()));
  assert.equal(applyInit(dir, BUNDLE, "write").code, 0);
  const r = applyInit(dir, BUNDLE, "remove");
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), mine());
  const written = readFileSync(file, "utf8");
  const none = applyInit(dir, BUNDLE, "remove");
  assert.equal(none.code, 0);
  assert.ok(none.out.some((l) => l.includes("no reflect hook entries")));
  assert.equal(readFileSync(file, "utf8"), written);
});

test("--write from npx's temporary cache still writes, and warns", (t) => {
  const { dir, file } = project(t);
  const npx = "C:/Users/someone/AppData/Local/npm-cache/_npx/1a2b3c/node_modules/@chanjoongx/reflect/dist/reflect.mjs";
  const r = applyInit(dir, npx, "write");
  assert.equal(r.code, 0);
  assert.ok(existsSync(file));
  assert.ok(r.out.some((l) => l.includes("npm i -g @chanjoongx/reflect")));
  assert.ok(!applyInit(dir, BUNDLE, "write").out.some((l) => l.includes("npx")));
});
