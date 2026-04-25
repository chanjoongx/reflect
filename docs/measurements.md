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

## Real-session reflection measurement (D5 — 2026-04-24/25)

A second live measurement set comes from D5 Scenario 2 (FAILURE-MODES.md §2 real-session execution): a 7-turn intent-shift sequence with 3× `git restore README.md` + 2 utterance Tier 3 matches. Hook fired at T5 PostToolUse, `cum_x100=300 > threshold 240`.

| Metric | Measured |
|---|---|
| Latency | 5,296 ms |
| Cost | $0.0647 (cold; D4 evening prior fire >1h prior, L1 1h TTL expired) |
| Cache hit | 0 % (cold) |
| Output tokens | ~370 (reflection JSON + thinking summary) |
| `false_trigger_likelihood` output | **high** ✅ — H1 hypothesis confirmed (intent-shift correctly flagged) |
| Confidence output | medium (honest under-claim — 4 convergent signals would support high; reflection acknowledged user meta-comment dependence) |
| Adjustment format | question-framed ✅ — "ask a single clarifying question..." |

D5 also surfaced an unexpected architectural finding via Scenario 3: **two complementary safety layers**. Claude Code's intrinsic pre-execution reasoning blocked 4 of 7 prompts on semantic contradiction grounds before tool execution — reflect's hook never fired because no tools ran. This was originally framed as a domain-awareness test that "failed"; reframed honestly, it demonstrates that Claude's own reasoning catches *turn-visible* contradictions, while reflect's post-hoc layer catches *multi-turn-only* accumulated patterns. Complementary, not redundant. Detail in [`hackathon/FAILURE-MODES.md`](../hackathon/FAILURE-MODES.md) §3 (gitignored, but the architectural takeaway is summarized in `docs/tutorial.md`).

---

**Last updated**: 2026-04-25 D5 evening PT (**23 commits pushed `c4ee0af`** — npm `@chanjoongx/reflect@0.1.2` LIVE on registry). D2 measurements + D5 Scenario 2 measurements both from real sessions. Ablation data deferred to v1.1 (N ≥ 30 across 5+ users) per `experiments/ablation-with-without.md` decision-log — single-subject n-of-1 case studies in this hackathon are explicitly framed as "honest small numbers, not controlled trial."
