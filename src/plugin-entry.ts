// src/plugin-entry.ts: the installed plugin's hooks (plugin/hooks/reflect-hook.mjs).
// It runs the hook modes, the reflection worker the judge hook starts, and
// --version. The reflect CLI is the npm package's entry, src/entry.ts.
//
// The plugin reads the variables below, each by name, and no others. Claude
// Code sets CLAUDE_PLUGIN_ROOT and CLAUDE_PROJECT_DIR for a plugin's hooks and
// passes the plugin's settings as CLAUDE_PLUGIN_OPTION_*; the REFLECT_* ones
// are optional switches a developer can set. The key setting is the only
// credential, and it goes only to https://api.anthropic.com (see
// src/api/credentials.plugin.ts, which this bundle uses in place of
// src/api/credentials.ts).

import { runHookMode, start } from "./hook/main.js";
import { VERSION } from "./version.js";

function pluginEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    CLAUDE_PLUGIN_ROOT: process.env["CLAUDE_PLUGIN_ROOT"],
    CLAUDE_PROJECT_DIR: process.env["CLAUDE_PROJECT_DIR"],
    CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY: process.env["CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY"],
    CLAUDE_PLUGIN_OPTION_REFLECTION_MODEL: process.env["CLAUDE_PLUGIN_OPTION_REFLECTION_MODEL"],
    CLAUDE_PLUGIN_OPTION_MAX_USD_PER_SESSION: process.env["CLAUDE_PLUGIN_OPTION_MAX_USD_PER_SESSION"],
    REFLECT_DISABLED: process.env["REFLECT_DISABLED"],
    REFLECT_INNER: process.env["REFLECT_INNER"],
    REFLECT_POLICY: process.env["REFLECT_POLICY"],
    REFLECT_MODEL: process.env["REFLECT_MODEL"],
    REFLECT_EFFORT: process.env["REFLECT_EFFORT"],
    REFLECT_JUDGE_MODEL: process.env["REFLECT_JUDGE_MODEL"],
    REFLECT_JUDGE_THINKING: process.env["REFLECT_JUDGE_THINKING"],
    REFLECT_MAX_USD_PER_SESSION: process.env["REFLECT_MAX_USD_PER_SESSION"],
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}

start(async (argv) => {
  const env = pluginEnv();
  const code = await runHookMode(argv, env, () => env);
  if (code !== null) return code;
  if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    console.log(VERSION);
    return 0;
  }
  console.error("This file runs the reflect plugin's hooks. The reflect command is in the npm package @chanjoongx/reflect.");
  return 1;
});
