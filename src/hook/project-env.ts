// src/hook/project-env.ts: the project .env, for the reflect CLI and for hooks
// wired by hand. The plugin's bundle does not contain this file: an installed
// plugin takes its key and settings from the plugin's settings only.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginMode } from "../api/credentials.js";

const ENV_KEYS = /^(ANTHROPIC_API_KEY|REFLECT_[A-Z_]+)$/;

/** `"quoted"` or `'quoted'` as written; otherwise trimmed, with a trailing ` # comment` dropped. */
function dotenvValue(raw: string): string {
  const v = raw.trim();
  const q = /^(["'])(.*)\1$/.exec(v);
  if (q) return q[2] ?? "";
  return v.replace(/\s+#.*$/, "").trim();
}

/**
 * v0.1 told users to put ANTHROPIC_API_KEY in the project's .env. Keep that
 * working for hooks wired by hand and the CLI, but read only reflect's own
 * keys from it, and never override what the environment already says. Under
 * the plugin's rules (CLAUDE_PLUGIN_ROOT or REFLECT_PLUGIN=1) the file is not
 * read at all.
 */
export function withProjectEnv(projectDir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  if (pluginMode(env)) return out;
  let raw: string;
  try {
    raw = readFileSync(join(projectDir, ".env"), "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (!m || !m[1] || !ENV_KEYS.test(m[1])) continue;
    if (out[m[1]] !== undefined && out[m[1]] !== "") continue;
    out[m[1]] = dotenvValue(m[2] ?? "");
  }
  return out;
}
