# Live measurements & failure modes

> Public artifact grounding reflect's cost, cache, and failure-mode claims. Based on live Opus 4.7 Messages API calls during reflect's own development.

---

## Live API measurements (D2 — 2026-04-22)

Sampling: successive calls against `claude-opus-4-7` during a reflect build session. Full session transcript retained privately; this page surfaces the numbers a reader needs to verify the claims in `README.md`, `ARCHITECTURE.md`, and `REFLECT.md`.

### Cost per call

| Call type | Cost | Cache behavior |
|---|---|---|
| Cold (first call, 1h L1 write) | **$0.0486** | `cache_write` 4,741 tok (≥ 4,096 floor), `cache_read` 0 |
| Warm (within 1h, same session) | **$0.0089** | `cache_read` 4,741, `cache_write` 0, hit 95.9% |
| Warm / cold ratio | **1 / 5.4×** | break-even at 2 reads — 1h TTL pays off in-session |

Latency: ~5.0 s cold, ~5.3 s warm. `thinking: "adaptive"` + `output_config.effort: "high"` dominate wall-clock; caching affects cost, not latency.

Measured numbers are **lower than the theoretical projection** in [`api-cost-economics.md`](./api-cost-economics.md) because the D2 smoke-test L3 (recent tool calls + rolled-back diff) was small. Theoretical figures assume L3 ≈ 3,000 tokens — realistic for mature sessions, not a fresh reflect-on-reflect dogfood run.

### L1 cache eligibility

- Target: ≥ 4,096 tokens (Opus 4.7 cache floor — below this, `cache_control` silently fails with `cache_creation_input_tokens = 0` and no error)
- Measured total: **4,741 tokens** (`SYSTEM_PROMPT_L1 + L1_PADDING_EXAMPLES` concatenated in `src/context-assembler.ts::assemblePrompt`)
- Margin: **645 tokens** of buffer for tokenizer variance (Opus 4.7 uses a new tokenizer with 1.0–1.35× ratio)

### Field-shape verification

Verified live against Opus 4.7 on D2 (rejected shapes were logged as findings during development):

| Shape | Result |
|---|---|
| `thinking: { type: "adaptive", display: "summarized" }` | ✅ accepted |
| `output_config: { effort: "high" }` | ✅ accepted |
| `cache_control: { type: "ephemeral", ttl: "1h" }` | ✅ accepted |
| `thinking: { type: "adaptive", budget_tokens: 5000 }` | ❌ 400 (deprecated) |
| `thinking: { type: "adaptive", effort: "high" }` | ❌ 400 (`Extra inputs not permitted`) |
| `effort: "high"` (top-level, sibling of `thinking`) | ❌ 400 (`Extra inputs not permitted`) |
| `temperature: 0.7` | ❌ 400 |

The Extended-Thinking doc page shows `thinking.effort`; the Messages API reference shows `output_config.effort`. **The Messages API reference wins.** See [`opus-4.7-best-practices.md`](./opus-4.7-best-practices.md) for the full corrected API surface.

---

## Failure modes

reflect v1 explicitly refuses to fire, or explicitly signals low-confidence, in several scenarios. Documented in README's `<details>` "Honest gotchas"; the mechanism detail lives here.

### 1. Cold-start sessions (< 5 tool calls)

**The problem.** First 5–7 turns of a new session have insufficient tool-call history to support causal reasoning. A reflection fired this early produces generic output ("be careful with refactors") that erodes trust.

**Two-layer defense.**

- **Layer A — hook threshold.** The `PostToolUse` hook accumulates signals into `cum_x100` with default threshold 240. Most cold-start revert patterns (1–2 reverts across turns 2–3) stay below threshold → no API call is spawned. Zero cost, zero noise.
- **Layer B — prompt-level refuse.** If Layer A is breached (e.g., 3 Tier 1 reverts in turns 2–4), the system prompt explicitly instructs Opus 4.7 to:
  - set `confidence: low`
  - frame `adjustment` as a question, not an instruction
  - set `false_trigger_likelihood: high`

  The next turn's path-scoped rule sees the low-confidence flag and treats the reflection as a question, not a directive.

**Cost if Layer A fails.** ≈ $0.02 warm (one unnecessary API call producing a clearly-flagged low-confidence reflection). Non-harmful.

### 2. False trigger on intent change

**The problem.** User changes their mind mid-task. Reverts cluster, but the cause is intent shift (the user's goal changed), not assistant misbehavior.

**Mitigation.** reflect's reasoning rubric explicitly considers intent change as a cause; the `false_trigger_likelihood` output field surfaces it. The path-scoped rule then treats guidance as a question.

**What we cannot fix.** True intent detection requires reading the user's mind. Our mitigation is a warning (flag it), not a prevention.

### 3. Generic reflection in regulatory / opaque domains

**The problem.** Tax calculation, KYC, GDPR-bound code: reflection may be vague ("be careful with regulations") because Opus 4.7 lacks domain-specific priors without explicit prompting.

**v1.1 roadmap.** User-supplied domain rule injection via `.reflect/domain-rules.md`. Users encode their regulatory constraints once; reflect injects them into L2 on trigger.

**What we cannot fix.** Without user-supplied rules, reflect cannot invent domain knowledge. This is a documented limitation, not a hidden one.

---

## Ablation methodology

- [`experiments/ablation-with-without.md`](../experiments/ablation-with-without.md) — effect-size data for reflect on vs off on the same refactor task
- [`experiments/ablation-components.md`](../experiments/ablation-components.md) — component-drop data (drop L2 rules, drop L3 diff, drop L3 tool history) across 5 frozen payloads

Both publications include null results. A single-subject case study (N = 2 sessions) is not a controlled trial; threats to validity are reported alongside numbers.

---

## Self-dogfood

Maintainers use reflect during its own development. Triggered reflections are logged locally; aggregate Y-rate statistics publish here with each release.

**Honest Y-rate targets**:
- 30–50 % useful rate is considered honest
- 90 %+ claims should be suspect — causal reasoning over 20+ tool calls is genuinely hard
- Null results (reflections that did not change the next move) are documented alongside successes

---

**Last updated**: 2026-04-24 D4 late AM (4 D4 commits pushed `01ed845`). Ablation data + per-release Y-rate statistics **to be added post-D5** (D4 ablation decision pending — if Path A proceeds, publish D4 evening; if Path 4 skip, deferred to v1.1 with decision-log).
