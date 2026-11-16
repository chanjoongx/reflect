// src/detect/judge.ts — Stage C: the relational correction judge.
//
// ONE implementation, two callers:
//   • bench/label.ts: offline, over a corpus, any model
//   • src/hook/run.ts: online, from an async UserPromptSubmit hook.
//     (A `type: "prompt"` hook cannot do this job: it may only answer
//     {ok, reason}, i.e. allow or block, and blocking a prompt is never ours.)
// Keeping it single-sourced is deliberate: evals/FINDINGS.md exists because the
// detector had five implementations that drifted apart.
//
// Two request formats. `schema` (the default, and what bench/label.ts sends)
// uses structured output:
//   output_config: { format: { type: "json_schema", schema } }
// The nested `json_schema:{...}` variant is rejected with a 400 (2026-08-22).
// `prompt` puts the schema in the message and reads the answer tolerantly, as
// the plugin must. On the 837-pair bench (2026-11-16) it found 101 pushbacks
// where structured output found 76, at the same precision, so the npm hook
// sends it too. An out-of-enum label (the 0.1 judge once answered
// "undo_request") still fails in parseVerdict and that message goes unjudged.

import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError, APIError, InternalServerError, RateLimitError } from "@anthropic-ai/sdk/core/error";
import type { JudgeUsage, JudgeVerdict, Pair } from "./types.js";
import { makeClient, type MessagesClient } from "../api/client.js";
import { JUDGE_SYSTEM, JUDGE_SYSTEM_BLIND, ParseFailure, VERDICT_SCHEMA, buildUserMessage, parseVerdict } from "./judge-prompt.js";
export * from "./judge-prompt.js";
import { answerAsJson, parseLoose } from "./answer-format.js";

import { DEFAULT_JUDGE_MODEL } from "../models.js";

export { DEFAULT_JUDGE_MODEL, BENCH_PROD_MODEL, REFERENCE_JUDGE_MODEL } from "../models.js";

// ─── API call ─────────────────────────────────────────────────────────

export type JudgeThinking = "off" | "adaptive";

export interface JudgeOptions {
  /** Injected client (the hook and tests pass one); otherwise built from `apiKey`. */
  client?: MessagesClient;
  apiKey?: string;
  model?: string;
  /** Omit the prior turn: the stateless-judge ablation. */
  blind?: boolean;
  /** With `blind`, also use the framing that does not promise context. */
  fairBlind?: boolean;
  /**
   * Thinking mode for models that take one. Left unset, the request sends no
   * `thinking` and no `effort`, which is exactly what the 2026-08 benchmark runs
   * sent; changing that would change the annotator behind every cached label.
   */
  thinking?: JudgeThinking;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** `schema`: structured output (default). `prompt`: the schema in the message, read tolerantly. */
  format?: "schema" | "prompt";
  timeoutMs?: number;
  /** SDK-level retries on 408/409/429/5xx and connection errors. */
  maxRetries?: number;
}

export interface JudgeResult {
  verdict: JudgeVerdict;
  usage: JudgeUsage;
}

class RetryableError extends Error {}


/**
 * Classify by error identity, not by searching the message text.
 *
 * The message is partly attacker-controlled here: a judge's own evidence span
 * lands in a parse-failure message, so `/socket|abort/` on the message would
 * retry a deterministic failure five times because the developer happened to
 * write "socket" in their prompt. Transport failures are identified by
 * `name`/`cause.code`, which no prompt can influence.
 */
const RETRYABLE_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND",
  "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

export function isRetryable(e: unknown): boolean {
  if (e instanceof ParseFailure) return false;
  if (e instanceof RetryableError) return true;
  if (e instanceof RateLimitError || e instanceof InternalServerError) return true;
  if (e instanceof APIConnectionError) return true;
  if (e instanceof APIError) return false;
  if (!(e instanceof Error)) return false;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  const code = (e as { cause?: { code?: string } }).cause?.code;
  if (code && RETRYABLE_CODES.has(code)) return true;
  // undici surfaces mid-body socket drops as a bare TypeError("fetch failed")
  // or Error("terminated"); both are transport, both are worth one more try.
  return e.name === "TypeError" || e.message === "terminated";
}

/**
 * Per-model request shaping. Haiku 4.5 rejects `effort`; Claude Haiku 5.5
 * accepts `thinking: disabled` only at effort `high` or below.
 */
export function thinkingParams(
  model: string,
  thinking: JudgeThinking | undefined,
  effort: "low" | "medium" | "high" | undefined,
): Pick<Anthropic.MessageCreateParamsNonStreaming, "thinking" | "output_config"> {
  if (thinking === undefined) return {};
  if (model.startsWith("claude-haiku-4-5")) return {};
  const e = effort ?? "low";
  return thinking === "off"
    ? { thinking: { type: "disabled" }, output_config: { effort: e } }
    : { thinking: { type: "adaptive" }, output_config: { effort: e } };
}

export async function judgePair(pair: Pair, opts: JudgeOptions): Promise<JudgeResult> {
  const model = opts.model ?? DEFAULT_JUDGE_MODEL;
  const client =
    opts.client ??
    (await makeClient({
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
      maxRetries: opts.maxRetries ?? 4,
      timeoutMs: opts.timeoutMs ?? 60_000,
    }));

  const shaped = thinkingParams(model, opts.thinking, opts.effort);
  const inPrompt = opts.format === "prompt";
  const user = buildUserMessage(pair, opts.blind === true);
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: opts.maxTokens ?? 2000,
    system: [
      {
        type: "text",
        text: opts.blind === true && opts.fairBlind === true ? JUDGE_SYSTEM_BLIND : JUDGE_SYSTEM,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: [{ role: "user", content: inPrompt ? `${user}

${answerAsJson(VERDICT_SCHEMA)}` : user }],
    ...(shaped.thinking ? { thinking: shaped.thinking } : {}),
    ...(inPrompt
      ? shaped.output_config
        ? { output_config: shaped.output_config }
        : {}
      : {
          output_config: {
            ...(shaped.output_config ?? {}),
            format: { type: "json_schema", schema: VERDICT_SCHEMA as unknown as Record<string, unknown> },
          },
        }),
  };

  const t0 = Date.now();
  const res = await client.messages.create(params);

  if (res.stop_reason === "refusal") {
    throw new ParseFailure(`judge refused (${res.stop_details?.category ?? "uncategorised"})`);
  }

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!text.trim()) {
    // Empty text block. On thinking-enabled models this is almost always
    // the output budget being consumed before any answer was emitted.
    throw new Error(
      `judge returned no text (stop_reason=${res.stop_reason}, out=${res.usage.output_tokens}, blocks=${res.content.map((b) => b.type).join("+")})`,
    );
  }

  let verdict: JudgeVerdict;
  try {
    verdict = inPrompt ? parseLoose(text, parseVerdict) : parseVerdict(text);
  } catch (pe) {
    throw new ParseFailure(
      `${pe instanceof Error ? pe.message : String(pe)} (stop_reason=${res.stop_reason}, out=${res.usage.output_tokens})`,
    );
  }
  const u = res.usage;
  return {
    verdict,
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - t0,
      model: res.model ?? model,
    },
  };
}
