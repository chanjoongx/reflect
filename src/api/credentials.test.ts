// src/api/credentials.test.ts: as an installed plugin, reflect uses the key from
// its own setting and nothing else; outside the plugin it also takes the
// environment's key. The directory review asks for exactly this split.
// ./credentials.plugin.ts is what the plugin's bundle uses; ./credentials.ts
// is the CLI's, and follows the same rules when CLAUDE_PLUGIN_ROOT is set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCredentials, pluginMode, resolveApiKey } from "./credentials.js";
import * as asPlugin from "./credentials.plugin.js";
import { ANTHROPIC_API_URL, MissingKeyError, makeClient } from "./client.js";

const SETTING = "CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY";

test("outside the plugin, the environment's key comes first, then the plugin setting", () => {
  assert.equal(resolveApiKey({ ANTHROPIC_API_KEY: "sk-env", [SETTING]: "sk-setting" }), "sk-env");
  assert.equal(resolveApiKey({ [SETTING]: " sk-setting " }), "sk-setting");
  assert.equal(hasCredentials({ ANTHROPIC_AUTH_TOKEN: "tok" }), true);
});

test("as a plugin hook, only the plugin setting counts", () => {
  const env = { CLAUDE_PLUGIN_ROOT: "/plugins/reflect", ANTHROPIC_API_KEY: "sk-env", ANTHROPIC_AUTH_TOKEN: "tok" };
  assert.equal(pluginMode(env), true);
  assert.equal(resolveApiKey(env), undefined);
  assert.equal(hasCredentials(env), false);
  assert.equal(resolveApiKey({ ...env, [SETTING]: "sk-setting" }), "sk-setting");
});

test("REFLECT_PLUGIN=1 applies the plugin's rules outside the plugin", () => {
  assert.equal(pluginMode({ REFLECT_PLUGIN: "1" }), true);
  assert.equal(resolveApiKey({ REFLECT_PLUGIN: "1", ANTHROPIC_API_KEY: "sk-env" }), undefined);
  assert.equal(pluginMode({}), false);
});

test("a plugin client with no key fails before loading the SDK", async () => {
  await assert.rejects(makeClient({}, { CLAUDE_PLUGIN_ROOT: "/p", ANTHROPIC_API_KEY: "sk-env" }), MissingKeyError);
});

test("a plugin client sends the setting's key to the Anthropic API, whatever the environment says", async () => {
  const saved = { url: process.env["ANTHROPIC_BASE_URL"], key: process.env["ANTHROPIC_API_KEY"] };
  process.env["ANTHROPIC_BASE_URL"] = "https://gateway.example";
  process.env["ANTHROPIC_API_KEY"] = "sk-env";
  try {
    const c = await makeClient({}, { CLAUDE_PLUGIN_ROOT: "/p", [SETTING]: "sk-setting" });
    const core = (c.messages as unknown as { _client: { baseURL: string; apiKey: string | null } })._client;
    assert.equal(core.baseURL, ANTHROPIC_API_URL);
    assert.equal(core.apiKey, "sk-setting");
  } finally {
    for (const [k, v] of [["ANTHROPIC_BASE_URL", saved.url], ["ANTHROPIC_API_KEY", saved.key]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("a plugin client clears ANTHROPIC_* from its process, so no custom header or token rides along", async () => {
  const saved = process.env["ANTHROPIC_CUSTOM_HEADERS"];
  process.env["ANTHROPIC_CUSTOM_HEADERS"] = "X-Gateway-Auth: secret-from-env";
  try {
    const c = await makeClient({}, { CLAUDE_PLUGIN_ROOT: "/p", [SETTING]: "sk-setting" });
    assert.equal(process.env["ANTHROPIC_CUSTOM_HEADERS"], undefined);
    const core = (c.messages as unknown as { _client: { _options: { defaultHeaders?: Record<string, string> } } })._client;
    assert.equal(JSON.stringify(core._options.defaultHeaders ?? {}).includes("secret-from-env"), false);
  } finally {
    if (saved === undefined) delete process.env["ANTHROPIC_CUSTOM_HEADERS"];
    else process.env["ANTHROPIC_CUSTOM_HEADERS"] = saved;
  }
});

test("the plugin's bundle takes the key from the plugin setting only and pins the Anthropic API", () => {
  const env = { ANTHROPIC_API_KEY: "sk-env", ANTHROPIC_AUTH_TOKEN: "tok" };
  assert.equal(asPlugin.pluginMode(env), true);
  assert.equal(asPlugin.resolveApiKey(env), undefined);
  assert.equal(asPlugin.hasCredentials(env), false);
  assert.throws(() => asPlugin.sdkAuth(undefined, env), MissingKeyError);
  assert.throws(() => asPlugin.sdkAuth(undefined), MissingKeyError);
  assert.deepEqual(asPlugin.sdkAuth(undefined, { ...env, [SETTING]: " sk-setting " }), { apiKey: "sk-setting", baseURL: ANTHROPIC_API_URL });
  assert.deepEqual(asPlugin.sdkAuth("sk-passed"), { apiKey: "sk-passed", baseURL: ANTHROPIC_API_URL });
});
