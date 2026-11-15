// src/api/credentials.ts: where reflect looks for a key. No SDK import, so the
// hooks that only deliver guidance can call it cheaply.
//
// Order, first match wins:
//   1. ANTHROPIC_API_KEY in the environment (or a project .env loaded by the CLI)
//   2. CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY: the plugin's `userConfig` field,
//      which Claude Code keeps in secure storage and exports to hook processes
//   3. whatever the SDK resolves on its own (ANTHROPIC_AUTH_TOKEN, an
//      `ant auth login` profile, workload identity)
//
// Nothing here prints, logs or persists a credential.

export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [env["ANTHROPIC_API_KEY"], env["CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY"]];
  for (const c of candidates) {
    if (c && c.trim()) return c.trim();
  }
  return undefined;
}

/** True when some credential source is plausibly present. Used by `reflect doctor`. */
export function hasCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    resolveApiKey(env) !== undefined ||
    Boolean(env["ANTHROPIC_AUTH_TOKEN"]) ||
    Boolean(env["ANTHROPIC_PROFILE"]) ||
    Boolean(env["ANTHROPIC_FEDERATION_RULE_ID"])
  );
}
