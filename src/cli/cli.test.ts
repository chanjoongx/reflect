// src/cli/cli.test.ts: the plugin's hooks.json and `reflect init` must wire the same hooks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { hookSettings } from "./cli.js";
import { HOOK_MODES } from "../hook/run.js";

interface Hook { type: string; command: string; args?: string[]; timeout?: number; async?: boolean }
interface Group { matcher?: string; hooks: Hook[] }
type Wiring = Record<string, Group[]>;

const BUNDLE_IN_PLUGIN = "${CLAUDE_PLUGIN_ROOT}/hooks/reflect-hook.mjs";

const plugin = (JSON.parse(readFileSync("plugin/hooks/hooks.json", "utf8")) as { hooks: Wiring }).hooks;

test("hooks.json runs the committed bundle, in exec form, with a known mode", () => {
  assert.ok(existsSync("plugin/hooks/reflect-hook.mjs"), "run npm run build");
  for (const groups of Object.values(plugin)) {
    for (const h of groups.flatMap((g) => g.hooks)) {
      assert.equal(h.command, "node");
      assert.equal(h.args?.[0], BUNDLE_IN_PLUGIN);
      assert.ok((HOOK_MODES as readonly string[]).includes(h.args?.[1] ?? ""), `unknown mode ${h.args?.[1]}`);
    }
  }
});

test("only the judge runs in the background; the hooks that deliver guidance are synchronous", () => {
  const all = Object.values(plugin).flatMap((gs) => gs.flatMap((g) => g.hooks));
  assert.deepEqual(all.filter((h) => h.async).map((h) => h.args?.[1]), ["judge"]);
  for (const h of all.filter((x) => !x.async)) assert.ok((h.timeout ?? 0) > 0 && (h.timeout ?? 99) <= 10);
});

test("reflect init prints the same wiring as the plugin, pointed at the given bundle", () => {
  const local = (hookSettings("/abs/reflect-hook.mjs") as { hooks: Wiring }).hooks;
  const swap = (w: Wiring) => JSON.stringify(w).split(BUNDLE_IN_PLUGIN).join("/abs/reflect-hook.mjs");
  assert.equal(JSON.stringify(local), swap(plugin));
});
