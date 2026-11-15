// src/api/client.ts: one place that decides how reflect authenticates.
//
// Order, first match wins:
//   1. ANTHROPIC_API_KEY in the environment (or a project .env loaded by the CLI)
//   2. CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY: the plugin's `userConfig` field,
//      which Claude Code keeps in secure storage and exports to hook processes
//   3. whatever the SDK resolves on its own (ANTHROPIC_AUTH_TOKEN, an
//      `ant auth login` profile, workload identity)
//
// Nothing here prints, logs or persists a credential.

import Anthropic from "@anthropic-ai/sdk";
import { resolveApiKey } from "./credentials.js";

export { resolveApiKey, hasCredentials } from "./credentials.js";

export interface ClientOptions {
  apiKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export function makeClient(opts: ClientOptions = {}): Anthropic {
  const apiKey = opts.apiKey ?? resolveApiKey();
  return new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    maxRetries: opts.maxRetries ?? 2,
    timeout: opts.timeoutMs ?? 60_000,
  });
}
