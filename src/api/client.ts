// src/api/client.ts: one place that builds the Anthropic SDK client and decides
// how much of the SDK reflect loads.
//
// The key and base URL come from sdkAuth in ./credentials.ts, which the
// plugin's bundle replaces with ./credentials.plugin.ts. As a plugin, the key is
// the plugin's setting and the base URL is pinned to the Anthropic API.
//
// The SDK comes in three pieces loaded with import(): the client core, the
// Messages API and the beta Messages API. Bundled that way, no file under
// plugin/hooks/lib passes 256 KiB, where the whole SDK would be one 1 MB file.
//
// Nothing here prints, logs or persists a credential.

import type { BaseAnthropic } from "@anthropic-ai/sdk/client";
import type { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import type { Messages as BetaMessages } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { sdkAuth } from "./credentials.js";

export { ANTHROPIC_API_URL, MissingKeyError } from "./auth-common.js";

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

/** `env` is where a key not passed in `opts` is looked up; the CLI's default is its own environment. */
export async function makeClient(opts: ClientOptions = {}, env?: NodeJS.ProcessEnv): Promise<MessagesClient> {
  const auth = sdkAuth(opts.apiKey, env);
  const [{ BaseAnthropic: Core }, { Messages: Msgs }, { BetaMessages: BetaMsgs }] = await Promise.all([
    import("./sdk/core.js"),
    import("./sdk/messages.js"),
    import("./sdk/beta-messages.js"),
  ]);
  const core: BaseAnthropic = new Core({
    ...auth,
    maxRetries: opts.maxRetries ?? 2,
    timeout: opts.timeoutMs ?? 60_000,
  });
  return { messages: new Msgs(core), beta: { messages: new BetaMsgs(core) } };
}
