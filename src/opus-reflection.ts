// src/opus-reflection.ts — Opus 4.7 API client
//
// CRITICAL (2026-04-21 정정 — RESEARCH-FINDINGS-2026-04-21.md):
//   - thinking: { type: "adaptive" }   (NOT budget_tokens — deprecated, returns 400)
//   - effort: "high"                    (or "xhigh" for coding/agentic)
//   - NO temperature/top_p/top_k        (non-default returns 400)
//   - cache_control ttl: "1h" on L1     (extended thinking 5m 빈번 초과)
//   - 1h breakpoint MUST come before 5m breakpoint
//   - Min cacheable for Opus 4.7 = 4,096 tokens
//   - Pricing: $5 input / $25 output / $0.50 cache read / $6.25 5m write / $10 1h write per 1M

import Anthropic from "@anthropic-ai/sdk";
import type {
  Reflection,
  PromptLayers,
  ReflectConfig,
  CallCost,
  ReflectionResult,
  Effort,
} from "./types.js";

// ─── Pricing (2026-04-21) ────────────────────────────────────────

const PRICE_INPUT_PER_MTOK = 5.0;
const PRICE_OUTPUT_PER_MTOK = 25.0;
const PRICE_CACHE_READ_PER_MTOK = 0.5;
const PRICE_CACHE_WRITE_5M_PER_MTOK = 6.25;
const PRICE_CACHE_WRITE_1H_PER_MTOK = 10.0;

// ─── Client ───────────────────────────────────────────────────────

let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  if (client) return client;
  client = new Anthropic({ apiKey });
  return client;
}

// ─── Main API call ────────────────────────────────────────────────

export async function callOpusReflection(
  layers: PromptLayers,
  config: ReflectConfig,
): Promise<ReflectionResult> {
  const apiClient = getClient(config.apiKey);
  const startTime = Date.now();

  // Construct request body
  // ⚠ NO temperature / top_p / top_k — Opus 4.7 rejects non-default values with 400
  //
  // BASELINE CALL (D1 — Anthropic spec verification deferred to D2)
  // Initial implementation tried `effort` (top-level), `thinking: { type: "adaptive" }`,
  // and `cache_control: { ttl: "1h" }` based on agent-mediated web research. The API
  // rejected `effort` with 400 ("Extra inputs are not permitted"). Out of caution,
  // also removed `thinking` (type "adaptive" unverified) and `cache_control.ttl`.
  //
  // D2 task: fetch official Anthropic docs directly (no agent intermediary), verify
  // exact field shapes for extended thinking + 1h cache + reasoning effort, then
  // re-add per verified spec. Tracked in hackathon/EXECUTION-PLAN.md.
  //
  // Current behavior: cache TTL defaults to 5m, no extended thinking, model uses
  // default reasoning depth. Sufficient for first reflection baseline.
  const requestBody = {
    model: config.model,
    max_tokens: config.maxOutputTokens,
    system: [
      {
        type: "text",
        text: layers.systemL1,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "text",
            text: layers.contextL2,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: layers.triggerL3,
          },
        ],
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await apiClient.messages.create(requestBody as any);

  const latencyMs = Date.now() - startTime;

  // Extract text response
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in Opus 4.7 response");
  }
  const responseText = textBlock.text;

  // Parse JSON
  const reflection = parseReflection(responseText);

  // Calculate cost
  const cost = calculateCost(response.usage);
  const cacheHitRate = calculateCacheHitRate(response.usage);

  if (config.debug) {
    console.error(
      `[reflect] cost=$${cost.totalUSD.toFixed(4)} cache_read=${response.usage.cache_read_input_tokens ?? 0} cache_write=${response.usage.cache_creation_input_tokens ?? 0} latency=${latencyMs}ms hit_rate=${(cacheHitRate * 100).toFixed(1)}%`,
    );
  }

  return {
    reflection,
    cost,
    cacheHitRate,
    latencyMs,
    guidanceFilePath: ".reflect/session-guidance.md",
  };
}

// ─── Response parsing ────────────────────────────────────────────

export function parseReflection(text: string): Reflection {
  // Try to find JSON block — Opus 4.7 should output pure JSON per system prompt
  // but may occasionally wrap in ```json ... ```
  let jsonText = text.trim();

  const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    jsonText = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `Failed to parse reflection JSON: ${e instanceof Error ? e.message : String(e)}\n\nResponse text:\n${text.slice(0, 500)}`,
    );
  }

  // Validate shape
  if (!isReflection(parsed)) {
    throw new Error(
      `Reflection JSON missing required fields. Got: ${JSON.stringify(parsed)}`,
    );
  }

  return parsed;
}

function isReflection(x: unknown): x is Reflection {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r["pattern"] === "string" &&
    typeof r["signal"] === "string" &&
    typeof r["adjustment"] === "string" &&
    (r["confidence"] === "low" ||
      r["confidence"] === "medium" ||
      r["confidence"] === "high") &&
    (r["scope"] === "this_session" || r["scope"] === "wider_concern") &&
    (r["false_trigger_likelihood"] === "low" ||
      r["false_trigger_likelihood"] === "medium" ||
      r["false_trigger_likelihood"] === "high")
  );
}

// ─── Cost calculation ────────────────────────────────────────────

interface UsageShape {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  // Future: separate 5m vs 1h cache write counts
}

export function calculateCost(usage: UsageShape): CallCost {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTotal = usage.cache_creation_input_tokens ?? 0;

  // Without breakdown, assume ~70% of cache write was 1h L1, 30% was 5m L2
  // (Reflects our L1=4500 / L2=2000 ratio)
  const cacheWrite1h = Math.round(cacheWriteTotal * 0.7);
  const cacheWrite5m = cacheWriteTotal - cacheWrite1h;

  const inputCost = (usage.input_tokens / 1_000_000) * PRICE_INPUT_PER_MTOK;
  const outputCost = (usage.output_tokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  const cacheReadCost = (cacheRead / 1_000_000) * PRICE_CACHE_READ_PER_MTOK;
  const cacheWrite5mCost =
    (cacheWrite5m / 1_000_000) * PRICE_CACHE_WRITE_5M_PER_MTOK;
  const cacheWrite1hCost =
    (cacheWrite1h / 1_000_000) * PRICE_CACHE_WRITE_1H_PER_MTOK;

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: cacheRead,
    cacheCreationTokens5m: cacheWrite5m,
    cacheCreationTokens1h: cacheWrite1h,
    totalUSD:
      inputCost + outputCost + cacheReadCost + cacheWrite5mCost + cacheWrite1hCost,
  };
}

function calculateCacheHitRate(usage: UsageShape): number {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const total = cacheRead + usage.input_tokens;
  if (total === 0) return 0;
  return cacheRead / total;
}

// ─── TODO (D2-D3) ─────────────────────────────────────────────────
// - Add retry with backoff for 429 / 503
// - Add token counting (countTokens) before send to verify L1 ≥ 4096
// - Add streaming support for low-latency UI
// - Remove @ts-expect-error once SDK types catch up to 2026-04 spec
