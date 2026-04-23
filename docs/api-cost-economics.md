# API Cost Economics

> Math for understanding reflect's per-call cost. Helps you decide trigger threshold + cooldown for your own use.

All prices are 2026-04-21 Opus 4.7 standard rate (per 1M tokens):
- Input: $5
- Output: $25
- Cache read: $0.50 (0.1× input)
- Cache write 5m: $6.25 (1.25× input)
- Cache write 1h: $10 (2× input)

---

## reflect's prompt budget

| Layer | Size | Cache TTL |
|---|---|---|
| L1 stable | 4,741 tok measured (≥ 4,096 cache floor) | 1h |
| L2 medium | ~2,000 tok | 5m |
| L3 ephemeral | ~3,000 tok typical (dogfood smoke tests run smaller) | none |
| Output | up to 800 tok | n/a |

---

## Cold call — theoretical vs measured

**Theoretical** (first reflection, full L3 ~3,000 tok):

| Item | Tokens | Rate | Cost |
|---|---|---|---|
| L1 cache write 1h | 4,741 | $10/M | $0.047 |
| L2 cache write 5m | 2,000 | $6.25/M | $0.0125 |
| L3 input (no cache) | 3,000 | $5/M | $0.015 |
| Output | 800 | $25/M | $0.020 |
| **Theoretical total** | | | **$0.095** |

**Measured D2** (`hackathon/DOGFOOD-LOG.md` Entry #003): **$0.049 cold** (smaller L3 during smoke tests; output 800 tok accurate).

---

## Warm call — theoretical vs measured

**Theoretical** (within same 1h as cold, full L3):

| Item | Tokens | Rate | Cost |
|---|---|---|---|
| L1 cache read | 4,741 | $0.50/M | $0.0024 |
| L2 cache read (if within 5m) | 2,000 | $0.50/M | $0.001 |
| L3 input | 3,000 | $5/M | $0.015 |
| Output | 800 | $25/M | $0.020 |
| **Theoretical total** | | | **$0.038** |

**Measured D2**: **$0.009 warm** (95.9% cache hit, smaller L3). Both numbers are honest — which applies depends on L3 size at your call site.

If L2 expired (>5min between calls), L2 must be re-written — adds $0.0125 → **$0.05** theoretical per call.

---

## Daily projection

Assuming 5 reflections/day, 1 cold + 4 warm (theoretical):

```
0.095 + 4 × 0.038 = $0.247/day
```

Hackathon $500 credit at this rate → **~2,000 days**. Effectively unlimited for individual use.

---

## Heavy session (demo recording day)

20 reflections, all warm after first (theoretical):

```
0.095 + 19 × 0.038 = $0.817
```

Still under $1.

---

## Break-even analysis: 1h vs 5m TTL on L1

L1 size: 4,741 tokens measured
- 5m write: $0.030 (1.25× input)
- 1h write: $0.047 (2× input)
- Read: $0.0024 (0.1× input)

Break-even reads (1h vs 5m, if 5m would expire):
```
extra_cost_1h = 0.047 - 0.030 = $0.017
saved_per_avoided_rewrite = 0.030 - 0.0024 = $0.028
break_even = 0.017 / 0.028 ≈ 0.61 rewrites avoided
```

→ If you'd otherwise rewrite L1 cache **even once** within the hour, 1h TTL pays off.

For reflect, L1 contains stable system prompt — never invalidated within a session. 1h is correct.

---

## Why we don't use Anthropic Batches

Batch API (input $2.50, output $12.50 — 50% off) requires async response, not suitable for inline reflection.

If we ever batch multiple reflections (e.g., end-of-day summary across sessions), batch becomes worth it. Not in v1.

---

## Why we don't use Managed Agents

Managed Agents adds **$0.08 per session-hour** on top of token costs. For reflect's single-shot pattern with no orchestration need, this is overhead.

If v1.1 deep-reflect mode (multi-turn) ships, Managed Agents become worth evaluating.

---

## Cost comparison: vs alternative reflection mechanisms

### Approach 1: reflect (current)
$0.038 per warm call. Triggered ~5x per session. **~$0.20/session**.

### Approach 2: Sonnet 4.6 instead of Opus 4.7
Sonnet 4.6: $3 input / $15 output (60% Opus prices).
$0.038 × 0.6 = **$0.023/call**. Saves ~$0.015/call.
Trade-off: reflection quality flattens (per our ablations) — not worth $0.015.

### Approach 3: Multi-turn dialog
3 turns × $0.04 = **$0.12/call**.
Adds latency + complexity. Defer to v1.1.

### Approach 4: Local model (Llama 70B, etc.)
Variable cost. Can't match Opus 4.7's causal reasoning quality (per our ablations).

---

## Tuning recommendations

### If your $/session is too high
- Raise `REFLECT_TRIGGER_THRESHOLD` from 2.4 to 3.0 (fewer triggers)
- Raise `REFLECT_COOLDOWN_TURNS` from 5 to 10 (longer suppression)
- Drop `REFLECT_EFFORT` from `high` to `medium` (cheaper thinking)

### If reflections aren't catching enough
- Lower `REFLECT_TRIGGER_THRESHOLD` to 2.0
- Lower `REFLECT_COOLDOWN_TURNS` to 3
- Raise `REFLECT_EFFORT` to `xhigh`

---

## Cost monitoring

The CLI debug mode logs each call's cost:
```bash
REFLECT_DEBUG=1 npx reflect manual
# stderr: [reflect] cost=$0.0381 cache_read=6500 cache_write=0 latency=2103ms hit_rate=68.4%
```

If opt-in logging enabled, daily cost computable from `.reflect/session-log.jsonl`:
```bash
jq -s 'map(.cost.totalUSD) | add' .reflect/session-log.jsonl
```

Anthropic dashboard at platform.claude.com gives the authoritative number.

---

## Anomaly thresholds

If your daily cost exceeds:
- $1: investigate. Likely too-low threshold or trigger loop
- $5: check `.reflect/state.json` for cooldown not decrementing
- $10: stop reflect (`REFLECT_DISABLED=1`), debug

---

**Last updated**: 2026-04-21
