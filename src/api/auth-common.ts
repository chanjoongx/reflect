// src/api/auth-common.ts: constants and helpers for ./credentials.ts, the npm
// CLI's key lookup (environment, project .env, SDK profile).

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
