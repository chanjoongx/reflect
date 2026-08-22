// src/pricing.ts — model catalogue and cost arithmetic.
//
// Replaces the hardcoded 2026-04 Opus 4.7 constants that were inlined in
// src/opus-reflection.ts (debt item D7). Prices are USD per million tokens,
// Anthropic first-party API rates. Partner platforms (Bedrock, Vertex) bill
// separately and are out of scope here.
//
// Cache multipliers are ratios of the input rate, which is how Anthropic
// documents them and how they stay correct when a model's base rate changes:
//   read 0.1x · 5-minute write 1.25x · 1-hour write 2.0x

export interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** Context window in tokens. */
  context: number;
}

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const CACHE_WRITE_1H_MULTIPLIER = 2.0;

/**
 * Catalogue snapshot: 2026-08-22. Verify against the pricing page before
 * publishing numbers.
 *
 * Frozen: `priceFor` hands the entry straight back, so an unfrozen object lets
 * one careless caller silently reprice every subsequent cost calculation in the
 * process.
 */
export const PRICES: Readonly<Record<string, Readonly<ModelPrice>>> = Object.freeze({
  "claude-fable-5": { input: 10, output: 50, context: 1_000_000 },
  "claude-opus-5": { input: 5, output: 25, context: 1_000_000 },
  "claude-opus-4-8": { input: 5, output: 25, context: 1_000_000 },
  "claude-opus-4-7": { input: 5, output: 25, context: 1_000_000 },
  "claude-opus-4-6": { input: 5, output: 25, context: 1_000_000 },
  "claude-sonnet-5": { input: 3, output: 15, context: 1_000_000 },
  "claude-sonnet-4-6": { input: 3, output: 15, context: 1_000_000 },
  "claude-haiku-4-5": { input: 1, output: 5, context: 200_000 },
} as Record<string, ModelPrice>);
for (const v of Object.values(PRICES)) Object.freeze(v);

export const PRICES_AS_OF = "2026-08-22";

/** Resolve a dated snapshot id (claude-haiku-4-5-20251001) to its base entry. */
export function priceFor(model: string): Readonly<ModelPrice> {
  const exact = PRICES[model];
  if (exact) return exact;
  const base = model.replace(/-\d{8}$/, "");
  const stripped = PRICES[base];
  if (stripped) return stripped;
  throw new Error(`unknown model for pricing: ${model} (add it to src/pricing.ts)`);
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreation5mTokens?: number;
  cacheCreation1hTokens?: number;
}

export function costUSD(model: string, u: TokenUsage): number {
  const p = priceFor(model);
  const m = 1 / 1_000_000;
  return (
    u.inputTokens * p.input * m +
    u.outputTokens * p.output * m +
    (u.cacheReadTokens ?? 0) * p.input * CACHE_READ_MULTIPLIER * m +
    (u.cacheCreation5mTokens ?? 0) * p.input * CACHE_WRITE_5M_MULTIPLIER * m +
    (u.cacheCreation1hTokens ?? 0) * p.input * CACHE_WRITE_1H_MULTIPLIER * m
  );
}

export function formatUSD(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(5)}`;
  if (v < 1) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
