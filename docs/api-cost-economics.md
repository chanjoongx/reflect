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
| L1 stable | 4,500 tok | 1h |
| L2 medium | 2,000 tok | 5m |
| L3 ephemeral | 3,000 tok | none |
| Output | up to 800 tok | n/a |

---

## Cold call (first reflection in session)

| Item | Tokens | Rate | Cost |
|---|---|---|---|
| L1 cache write 1h | 4,500 | $10/M | $0.045 |
| L2 cache write 5m | 2,000 | $6.25/M | $0.0125 |
| L3 input (no cache) | 3,000 | $5/M | $0.015 |
| Output | 800 | $25/M | $0.020 |
| **Total** | | | **$0.0925** |

---

## Warm call (within same hour as cold call)

| Item | Tokens | Rate | Cost |
|---|---|---|---|
| L1 cache read | 4,500 | $0.50/M | $0.00225 |
| L2 cache read (if within 5m) | 2,000 | $0.50/M | $0.001 |
| L3 input | 3,000 | $5/M | $0.015 |
| Output | 800 | $25/M | $0.020 |
| **Total** | | | **$0.038** |

If L2 expired (>5min between calls), L2 must be re-written — adds $0.0125 → **$0.05** per call.

---

## Daily projection

Assuming 5 reflections/day, 1 cold + 4 warm:

```
0.0925 + 4 × 0.038 = $0.245/day
```

Hackathon $500 credit at this rate → **2,040 days**. Effectively unlimited for individual use.

---

## Heavy session (demo recording day)

20 reflections, all warm after first:

```
0.0925 + 19 × 0.038 = $0.815
```

Still under $1.

---

## Break-even analysis: 1h vs 5m TTL on L1

L1 size: 4,500 tokens
- 5m write: $0.028 (1.25× input)
- 1h write: $0.045 (2× input)
- Read: $0.00225 (0.1× input)

Break-even reads (1h vs 5m, if 5m would expire):
```
extra_cost_1h = 0.045 - 0.028 = $0.017
saved_per_avoided_rewrite = 0.028 - 0.00225 = $0.026
break_even = 0.017 / 0.026 ≈ 0.65 rewrites avoided
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
