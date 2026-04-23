# Ablation 2: Component-drop ablation

> Thariq Lab requirement T1 (second study). Causal isolation of which prompt components matter most.
> Run plan: D4-D5 (2026-04-24/25).

---

## Hypothesis

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

**Status (D4 late AM)**: Plan documented D1. **Run deferred to D5 morning** (D4 catch-up: DOGFOOD entries 4 real / target 5 — payload 5개 freeze 위해 1개 부족, 자연 +2-4 entries D4 afternoon ablation Run 2 또는 DOGFOOD bulk session 후 D5 morning execute 가능). Path A (ablation 진행) 시 Run 2 의 자연 entries 후 D5 morning, Path 4 (skip) 시 v1.1 deferred. Results: TBD.
