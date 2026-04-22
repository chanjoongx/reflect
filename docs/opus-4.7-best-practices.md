# Opus 4.7 Best Practices (2026-04 corrections)

> Critical changes to the Opus 4.7 API surface that affect reflect's implementation. Sourced from official Anthropic docs, 2026-04-21. See [`hackathon/RESEARCH-FINDINGS-2026-04-21.md`](../hackathon/RESEARCH-FINDINGS-2026-04-21.md) for full source list.

---

## 1. Adaptive thinking (NOT manual budget_tokens)

### Old (Opus 4.6 and earlier)
```typescript
thinking: { type: "enabled", budget_tokens: 5000 }
```

### New (Opus 4.7) — required
```typescript
thinking: { type: "adaptive" }
```

`budget_tokens` returns **400 error** on Opus 4.7. The model self-determines thinking depth.

### Effort parameter
Control intensity via top-level `effort` field:
- `low`
- `medium`
- `high` — reflect's default
- `xhigh` — Anthropic's recommended starting point for coding/agentic
- `max` — CLI/skill-only, not Messages API

reflect uses `high` by default. Test `xhigh` for your use case if you want richer reflections at ~30% cost increase.

---

## 2. NO temperature / top_p / top_k

Opus 4.7 rejects non-default sampling parameters with **400 error**.

```typescript
// ❌ Returns 400
{ temperature: 0.7, top_p: 0.9, top_k: 50 }

// ✅ Don't set them
{
  // Use prompt-based control instead (JSON schema constraint, examples)
}
```

This is intentional. Anthropic moved to prompt-driven determinism.

If you need diverse outputs (e.g., generate 3 candidate reflections), make 3 separate calls rather than tuning sampling.

---

## 3. Thinking content omitted by default

```typescript
// Default: thinking field absent in response
const response = await client.messages.create({ ... });
// response.content has [text] only, no [thinking]

// To inspect:
const response = await client.messages.create({
  ...,
  display: "summarized"  // shows thinking summary
});
```

reflect doesn't request thinking display in production (we only need the structured JSON). For debugging, set `REFLECT_DEBUG=1` and the SDK may surface it.

---

## 4. Cache minimum = 4,096 tokens

For Opus 4.7 / 4.6 / 4.5 / Haiku 4.5, the minimum cacheable block is **4,096 tokens** (raised from 1,024 for older models).

If a `cache_control` block is below this floor, caching silently fails (no error, just no cache_creation_input_tokens). Verify with `usage.cache_*` fields.

reflect's L1 layer is sized to ≥ 4500 tokens with calibration examples to safely meet the floor, with margin for the new tokenizer.

---

## 5. 1h TTL for stable cache

Default TTL is **5 minutes**. Extended TTL = **1 hour** via:

```typescript
cache_control: { type: "ephemeral", ttl: "1h" }
```

### When to use 1h
- Session-spanning content (reflect's L1)
- Extended thinking sessions (often exceed 5 min between calls)

### When to use 5m
- Per-task content that may change (reflect's L2)

### Critical ordering rule
**1h breakpoint MUST come before 5m breakpoint** in the request. Anthropic spec: hierarchy is tools → system → messages, and 1h must precede 5m within that order.

reflect places L1 (1h) in `system`, L2 (5m) in first `messages` content block — automatically satisfies ordering.

### Cost
- 5m write: 1.25× input price
- 1h write: 2× input price
- Cache read: 0.1× input price (both)

Break-even for 1h: ~2 reads per session. reflect typically triggers 3+ times per session — 1h pays off easily.

---

## 6. 1M context = standard pricing (no premium)

Opus 4.7 (and 4.6 onward) charges the same per-token rate regardless of prompt length up to 1M tokens. No 2x/3x premium for >200K like older models.

reflect doesn't approach 1M (typical prompt is ~10K tokens), so this is informational.

---

## 7. Tokenizer changed (1.0–1.35× ratio)

Opus 4.7 uses a new tokenizer. Same English text may produce up to 35% more tokens than Opus 4.6 / GPT-4 baselines.

### Implications for reflect
- L1 layer sized to ≥ 4500 tokens with margin
- `max_tokens: 800` may produce slightly less actual output than expected
- Use `client.beta.messages.countTokens()` to verify L1 ≥ 4096 in production

---

## 8. Behavior changes in 4.7

The model is:
- **More literal** in instruction-following (over-specified prompts may produce verbose responses)
- **Shorter** in default verbosity
- **Fewer tool calls** by default (more self-contained)
- **Fewer subagents** by default (more direct)
- **More direct** in tone

For reflect this means:
- Output JSON is reliably structured (no rambling)
- Schema constraint is followed precisely
- Few-shot examples weight heavily in calibration

---

## 9. Task budgets (beta — opt-in)

```typescript
// Beta header required
"anthropic-beta": "task-budgets-2026-03-13"

// Request shape
output_config: {
  task_budget: { type: "tokens", total: 20000 }  // min 20k
}
```

This is a **soft advisory cap** — model self-moderates. Distinct from `max_tokens` (hard cap).

reflect doesn't currently use task budgets (single-shot, max_tokens 800 is sufficient). Could be useful for v1.1 deep-reflect mode (multi-turn).

---

## 10. Pricing summary (per 1M tokens)

| Operation | Opus 4.7 |
|---|---|
| Base input | $5 |
| Output | $25 |
| 5m cache write | $6.25 (1.25× input) |
| 1h cache write | $10 (2× input) |
| Cache read | $0.50 (0.1× input) |
| Batch input | $2.50 |
| Batch output | $12.50 |

US-only data residency: 1.1× multiplier on all categories.

---

## 11. Response usage fields

```typescript
const response = await client.messages.create({ ... });

response.usage = {
  input_tokens: 3000,                      // non-cached input
  output_tokens: 800,
  cache_read_input_tokens: 6500,           // cache hit
  cache_creation_input_tokens: 0,          // cache write (cold call only)
}
```

reflect's `calculateCost()` in `src/opus-reflection.ts` computes `totalUSD` from these.

---

## 12. Common errors

| Error | Cause | Fix |
|---|---|---|
| 400 — `thinking.budget_tokens not supported` | Old API shape | Use `{ type: "adaptive" }` |
| 400 — `temperature not supported` | Non-default sampling | Remove `temperature`/`top_p`/`top_k` |
| Silent cache miss (cache_creation 0) | L1 < 4096 tokens | Pad L1 to ≥ 4096 |
| Cache invalidation each call | thinking effort changed mid-session | Keep effort stable, or accept invalidation |

---

## 13. Sources

- [What's new in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Building with extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Claude Opus 4.7 GA — GitHub Changelog](https://github.blog/changelog/2026-04-16-claude-opus-4-7-is-generally-available/)

For full research findings + verified-as-of-2026-04-21 source links, see [`hackathon/RESEARCH-FINDINGS-2026-04-21.md`](../hackathon/RESEARCH-FINDINGS-2026-04-21.md).
