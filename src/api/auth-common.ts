// src/api/auth-common.ts: what both credential modules share. ./credentials.ts
// is the CLI's (environment, project .env, SDK profile); ./credentials.plugin.ts
// replaces it in the plugin's bundle (the plugin setting only). See
// scripts/build-hook.mjs.

export const ANTHROPIC_API_URL = "https://api.anthropic.com";

/** The plugin's `anthropic_api_key` setting, as Claude Code passes it to the plugin's hooks. */
export const PLUGIN_KEY_VAR = "CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY";

/** What reflect hands the SDK client: a key and a base URL, or nothing so the SDK resolves its own. */
export interface SdkAuth {
  apiKey?: string;
  baseURL?: string;
}

export class MissingKeyError extends Error {
  constructor() {
    super("no API key: set one in the reflect plugin settings");
    this.name = "MissingKeyError";
  }
}

export function clean(v: string | undefined): string | undefined {
  return v && v.trim() ? v.trim() : undefined;
}
