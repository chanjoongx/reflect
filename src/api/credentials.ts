// src/api/credentials.ts: where reflect looks for a key. No SDK import, so the
// hooks that only deliver guidance can call it cheaply.
//
// As an installed plugin, reflect uses one credential: the API key the user
// typed into the plugin's own setting. Claude Code keeps it in the system
// credential store and passes it to the plugin's hook processes as
// CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY. Nothing else is read in that mode,
// not the environment, not a project .env file and not an SDK profile.
//
// Claude Code sets CLAUDE_PLUGIN_ROOT for every hook a plugin runs, which is
// how the hooks know they are a plugin. The plugin's slash command runs the CLI
// with --plugin (it sets REFLECT_PLUGIN=1), because commands do not receive
// CLAUDE_PLUGIN_ROOT in their environment.
//
// Run by hand from a terminal, or wired into settings.json without the plugin
// system, reflect also accepts ANTHROPIC_API_KEY from the environment (or the
// project's .env, loaded by withProjectEnv) and whatever the Anthropic SDK
// resolves on its own: ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
//
// Nothing here prints, logs or persists a credential.

export const PLUGIN_KEY_VAR = "CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY";

/** True when reflect runs as an installed plugin: a plugin hook, or the plugin's command. */
export function pluginMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env["CLAUDE_PLUGIN_ROOT"]) || env["REFLECT_PLUGIN"] === "1";
}

function clean(v: string | undefined): string | undefined {
  return v && v.trim() ? v.trim() : undefined;
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
