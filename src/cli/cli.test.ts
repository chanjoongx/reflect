// src/cli/cli.test.ts: `reflect init` wires known hook modes, and the plugin
// declares no hooks at all (it is a mod: hooks.json names its module only).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { hookSettings } from "./cli.js";
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
