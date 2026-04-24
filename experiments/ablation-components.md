# Ablation 2: Component-drop ablation — **DEFERRED to v1.1**

> **Status (2026-04-24 D4 late afternoon PT)**: This ablation is **deferred to v1.1** together with Ablation 1. See `experiments/ablation-with-without.md` for the unified decision-log.
> Preserved below as originally designed — the payload + rubric + rater methodology is intended to be picked up verbatim once the DOGFOOD dataset grows past N = 30 across multiple users.

---

## Why deferred (short form)

Ablation 2 presupposes a stable set of 5 high-quality trigger payloads sourced from dogfood. At D4 late PT, the dogfood corpus contains 4 real entries (#001–#004), all of which are smoke-test or stub-data manual triggers rather than organic revert clusters — the distribution we would need to represent in the payload set. Running with 4 stub payloads would multiply the N=2 self-experiment problem of Ablation 1: the conclusions would be about how Opus 4.7 reasons over *stub* payloads, not how it reasons over organic drift.

The correct input to this experiment is a corpus of organic drift payloads from real multi-user usage, which does not exist yet and is exactly what v1 is designed to collect via the opt-in `.reflect/session-log.jsonl` (168h auto-delete). We ship v1 first, collect the data honestly, then run this ablation once the Phase 2 trigger condition (50 users × 10 sessions, useful rate > 60%) is met.

---

## Hypothesis (original design, preserved for reference)

The L2 (active rules) and L3 (recent tool calls + diff) components both contribute to reflection quality, but in different ways:
- Drop L2 → reflections become generic / lose context-awareness
- Drop L3 (tool calls) → reflections lose causal chain
- Drop L3 (diff) → reflections lose specific revert anchor

## Method

### Setup
- Use a fixed set of 5 trigger payloads (sourced from CJ's D2-D4 dogfood log)
- For each payload, run reflect 4 times:
  1. Full prompt (control)
  2. Drop L2 (no active rules)
  3. Drop L3 tool calls (only diff)
  4. Drop L3 diff (only tool calls)

5 payloads × 4 conditions = 20 calls.

### Cost
20 × ~$0.05 = ~$1 total (warm cache amortizes).

### Procedure
1. D4 evening: select 5 payloads from dogfood log
2. D5 morning: run 20 calls, save raw responses
3. D5 morning: rate each reflection on 1-5 rubric (CJ + 1 external grader if possible)
4. D5 noon: compile results

---

## Rubric (1-5)

For each reflection, rate:
- **Specificity** — concrete vs generic
- **Causal accuracy** — does pattern match what happened
- **Adjustment actionability** — can next turn use it
- **Calibration** — does confidence match evidence

Average for "overall quality" (subjective but consistent).

---

## Results

(Filled in D5 noon)

### Per-payload table

| Payload | Full | Drop L2 | Drop tool calls | Drop diff |
|---|---|---|---|---|
| #1 (DRY violation) | TBD | TBD | TBD | TBD |
| #2 (intent change) | TBD | TBD | TBD | TBD |
| #3 (regulatory) | TBD | TBD | TBD | TBD |
| #4 (god file) | TBD | TBD | TBD | TBD |
| #5 (test thrash) | TBD | TBD | TBD | TBD |
| **Average** | TBD | TBD | TBD | TBD |

### Causal reading
- If "Drop L2" similar to Full: rules don't matter much → simplify L2
- If "Drop tool calls" significantly worse: tool calls are causal anchor → preserve
- If "Drop diff" significantly worse: diff is the revert evidence → must preserve
- If all drops similar: prompt structure may be unnecessarily heavy

---

## Honest reporting

Report all 4 averages even if results contradict the hypothesis.
If we find that L2 doesn't matter, **trim L2 in v1.1** to save tokens.
If diff is critical, **mandate diff inclusion** even when manual trigger.

Negative findings are equally publishable.

---

## Limitations

- N=5 payloads is small (limited statistical power)
- Single grader (CJ) introduces bias — try to recruit 1 external grader
- Same model (Opus 4.7) — generalization to other models unstudied
- CJ's task distribution may not represent broader users

---

## Future work (post-hackathon)

- Larger N (50 payloads)
- Multiple graders + Cohen's κ
- Test on Sonnet 4.6 / Haiku 4.5 for cost-vs-quality curve
- Test prompt cache invalidation impact when L1 changes

---

**Status (D4 late afternoon PT)**: Plan documented D1. **Run deferred to v1.1** (post-hackathon) once organic dogfood payload corpus reaches N ≥ 30 across 5+ users. See `experiments/ablation-with-without.md` decision-log for unified rationale. Results: TBD, Phase 2.
