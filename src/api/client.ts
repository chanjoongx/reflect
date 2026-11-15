// src/api/client.ts: one place that decides how reflect authenticates and how
// much of the Anthropic SDK it loads.
//
// Credentials follow ./credentials.ts. As an installed plugin the client gets
// the key from the plugin's setting and nothing else: the hook clears every
// ANTHROPIC_* variable from its own environment first (clearAnthropicEnv), and
// the base URL is pinned to the Anthropic API, so neither a key, a gateway nor
// a custom header set in the environment reaches a request.
//
// The SDK comes in three pieces loaded with import(): the client core, the
// Messages API and the beta Messages API. Bundled that way, no file under
// plugin/hooks/lib passes 256 KiB, where the whole SDK would be one 1 MB file.
//
// Nothing here prints, logs or persists a credential.

import type { BaseAnthropic } from "@anthropic-ai/sdk/client";
import type { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import type { Messages as BetaMessages } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { pluginMode, resolveApiKey } from "./credentials.js";

export { resolveApiKey, hasCredentials, pluginMode } from "./credentials.js";

export const ANTHROPIC_API_URL = "https://api.anthropic.com";

export interface ClientOptions {
  apiKey?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

/** The two calls reflect makes. Tests pass a fake with the same shape. */
export interface MessagesClient {
  messages: Pick<Messages, "create">;
  beta: { messages: Pick<BetaMessages, "create"> };
}

export class MissingKeyError extends Error {
  constructor() {
    super("no API key: set one in the reflect plugin settings");
    this.name = "MissingKeyError";
  }
}

/**
 * The SDK reads more than a key from the environment: a base URL, an auth
 * token, a profile, and `ANTHROPIC_CUSTOM_HEADERS`, which it adds to every
 * request even when the key is passed in code. A plugin hook is a short-lived
 * process of its own, so it removes every ANTHROPIC_* variable from its own
 * environment before it creates a client, and the SDK finds none of them.
 */
export function clearAnthropicEnv(target: NodeJS.ProcessEnv = process.env): void {
  for (const k of Object.keys(target)) if (k.startsWith("ANTHROPIC_")) delete target[k];
}

export async function makeClient(opts: ClientOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<MessagesClient> {
  const plugin = pluginMode(env);
  const apiKey = opts.apiKey ?? resolveApiKey(env);
  if (plugin && !apiKey) throw new MissingKeyError();
  if (plugin) clearAnthropicEnv();

  const [{ BaseAnthropic: Core }, { Messages: Msgs }, { BetaMessages: BetaMsgs }] = await Promise.all([
    import("./sdk/core.js"),
    import("./sdk/messages.js"),
    import("./sdk/beta-messages.js"),
  ]);
  const core: BaseAnthropic = new Core({
    // Outside the plugin, an absent key lets the SDK resolve its own credential.
    ...(apiKey ? { apiKey } : {}),
    ...(plugin ? { baseURL: ANTHROPIC_API_URL } : {}),
    maxRetries: opts.maxRetries ?? 2,
    timeout: opts.timeoutMs ?? 60_000,
  });
  return { messages: new Msgs(core), beta: { messages: new BetaMsgs(core) } };
}
