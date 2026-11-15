// src/api/credentials.plugin.ts: the installed plugin's credentials. The
// plugin's bundle uses this file in place of ./credentials.ts
// (scripts/build-hook.mjs), and it exports the same names.
//
// The plugin uses one credential: the API key the user typed into the plugin's
// own setting. Claude Code keeps it in the system credential store and passes
// it to the plugin's hook processes as CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY.
// Requests go to https://api.anthropic.com and nowhere else. No other variable,
// no .env file and no SDK profile is read: the bundle's copy of the Anthropic
// SDK has its environment reads and its credential chain taken out at build
// time, so the key passed here is the only one it can use.
//
// Nothing here prints, logs or persists a credential.

import { ANTHROPIC_API_URL, MissingKeyError, PLUGIN_KEY_VAR, clean, type SdkAuth } from "./auth-common.js";

export { PLUGIN_KEY_VAR };

export function pluginMode(_env?: NodeJS.ProcessEnv): boolean {
  return true;
}

export function resolveApiKey(env: NodeJS.ProcessEnv): string | undefined {
  return clean(env[PLUGIN_KEY_VAR]);
}

export function hasCredentials(env: NodeJS.ProcessEnv): boolean {
  return resolveApiKey(env) !== undefined;
}

export function sdkAuth(apiKey: string | undefined, env?: NodeJS.ProcessEnv): SdkAuth {
  const key = apiKey ?? (env ? resolveApiKey(env) : undefined);
  if (!key) throw new MissingKeyError();
  return { apiKey: key, baseURL: ANTHROPIC_API_URL };
}
