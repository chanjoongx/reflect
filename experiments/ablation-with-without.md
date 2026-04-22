# Ablation 1: With reflect vs Without

> Thariq Lab requirement T1. Honest publish (positive or negative).
> Run plan: D4 (2026-04-24).

---

## Hypothesis

Sessions with `reflect` enabled produce fewer reverts and less subjective drift than identical sessions without `reflect`, on the same task type.

## Method

### Setup
- 2 sessions × ~2 hours each
- Same task: refactor a known-noisy module (TBD: candidate `src/billing.ts` from a sample repo)
- Same model (Claude Opus 4.7)
- Same Claude Code version (TBD: 2.X.Y)
- Same starting commit (`git checkout` to clean state at start)

### Conditions
| Condition | reflect | Other |
|---|---|---|
| A | Enabled (default threshold 2.4) | Identical |
| B | Disabled (`REFLECT_DISABLED=1`) | Identical |

### Procedure
1. Day 4 morning: select task, prep clean repo
2. Day 4 11:00 PT: run Condition A for 2 hours, screen-record
3. Day 4 14:00 PT: reset repo to same starting commit
4. Day 4 14:00 PT: run Condition B for 2 hours, screen-record
5. Day 4 16:00 PT: review both, fill metrics table

### Random ordering
Run order randomized to avoid bias from CJ getting tired (B might get worse output just because second).
Coin flip: A first or B first? **TBD**.

---

## Metrics

### Quantitative
| Metric | Condition A | Condition B | Δ |
|---|---|---|---|
| Total tool calls | TBD | TBD | TBD |
| Total reverts (Tier 1+2) | TBD | TBD | TBD |
| Reverts per hour | TBD | TBD | TBD |
| Task completion (1 = done, 0 = abandoned) | TBD | TBD | TBD |
| Final code LOC | TBD | TBD | TBD |
| Test pass rate at end | TBD | TBD | TBD |

### Qualitative (CJ self-rating, 1-5)
| Metric | A | B |
|---|---|---|
| Subjective frustration | TBD | TBD |
| Sense of forward progress | TBD | TBD |
| Quality of final code | TBD | TBD |
| Cost (credits used) | TBD | TBD |

### reflect-specific (Condition A only)
| Metric | Value |
|---|---|
| Total reflections fired | TBD |
| Total reflect cost | TBD ($) |
| Y rate (changed next move?) | TBD |

---

## Results

(Filled in D4 17:00 PT)

### Effect size
TBD

### Statistical significance
- Sample size 2 — no statistical claim possible
- Anecdotal evidence only (acknowledged in submission)

### What we'd need for stronger claim
- N = 30 sessions across 5+ users
- Counter-balanced design
- Blind grading

---

## Honest discussion

- **If effect positive**: claim cautiously. "In 2 single-user sessions, reflect reduced reverts by X%. Larger N needed."
- **If effect null**: report as null. "No detectable difference in 2 sessions. Reflection quality may not translate to revert reduction at this scale."
- **If effect negative**: report as negative. "reflect added cognitive overhead without reducing reverts. Possible failure modes: ..."

reflect ships either way. The benchmark data is for transparency, not marketing.

---

## What might we learn

- If reflect helps on **certain task types** but not others → calibrate trigger / examples
- If reflect helps **early in session** but not late → different trigger logic
- If reflect helps but at high cost → tune effort
- If reflect doesn't help at all → fundamental rethink

---

## Demo use

If results positive: 02:00-02:30 segment shows the comparison chart.
If results null/negative: still show the chart with honest interpretation. Demo doesn't require positive result — judges value honest disclosure.

---

**Status**: Plan documented D1. Run D4. Results published D4 EOD.
