// src/api/credentials.ts: where the reflect CLI looks for a key. No SDK import,
// so the hooks that only deliver guidance can call it cheaply.
//
// The installed plugin does not use this file: it is a mod that calls models
// through Claude Code and holds no key. What follows is for the npm CLI and for
// hooks wired into settings.json by hand.
//
// Run that way, reflect accepts ANTHROPIC_API_KEY from the environment (or the
// project's .env, loaded by withProjectEnv in ../hook/project-env.ts) and
// whatever the Anthropic SDK resolves on its own: ANTHROPIC_AUTH_TOKEN or an
// `ant auth login` profile. CLAUDE_PLUGIN_ROOT or REFLECT_PLUGIN=1 switch it to
// the plugin's rules, which the tests use to cover both.
//
// Nothing here prints, logs or persists a credential.

import { ANTHROPIC_API_URL, MissingKeyError, PLUGIN_KEY_VAR, clean, type SdkAuth } from "./auth-common.js";

export { PLUGIN_KEY_VAR };

/** True when reflect follows the plugin's rules: only the plugin setting, pinned to the Anthropic API. */
export function pluginMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["CLAUDE_PLUGIN_ROOT"]) || env["REFLECT_PLUGIN"] === "1";
}

export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromSetting = clean(env[PLUGIN_KEY_VAR]);
  if (pluginMode(env)) return fromSetting;
  return clean(env["ANTHROPIC_API_KEY"]) ?? fromSetting;
}

/** True when some credential source is plausibly present. Used by `reflect doctor`. */
export function hasCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  if (resolveApiKey(env) !== undefined) return true;
  if (pluginMode(env)) return false;
  return (
    Boolean(env["ANTHROPIC_AUTH_TOKEN"]) ||
    Boolean(env["ANTHROPIC_PROFILE"]) ||
    Boolean(env["ANTHROPIC_FEDERATION_RULE_ID"])
  );
}

/**
 * The SDK reads more than a key from the environment: a base URL, an auth
 * token, a profile, and `ANTHROPIC_CUSTOM_HEADERS`, which it adds to every
 * request even when the key is passed in code. Under the plugin's rules the
 * process removes every ANTHROPIC_* variable from its own environment before
 * it creates a client, so the SDK finds none of them.
 */
export function clearAnthropicEnv(target: NodeJS.ProcessEnv = process.env): void {
  for (const k of Object.keys(target)) if (k.startsWith("ANTHROPIC_")) delete target[k];
}

/** The key and base URL for a client. `apiKey` is one the caller already resolved. */
export function sdkAuth(apiKey: string | undefined, env: NodeJS.ProcessEnv = process.env): SdkAuth {
  const plugin = pluginMode(env);
  const key = apiKey ?? resolveApiKey(env);
  if (plugin && !key) throw new MissingKeyError();
  if (plugin) clearAnthropicEnv();
  // Outside the plugin's rules, an absent key lets the SDK resolve its own credential.
  return { ...(key ? { apiKey: key } : {}), ...(plugin ? { baseURL: ANTHROPIC_API_URL } : {}) };
}
