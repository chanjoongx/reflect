# Ablation 1: With reflect vs Without

> Thariq Lab requirement T1. Honest publish (positive or negative).
> Run plan: D4 (2026-04-24).

---

## Hypothesis

Sessions with `reflect` enabled produce fewer reverts and less subjective drift than identical sessions without `reflect`, on the same task type.

## Method

### Setup
- 2 sessions × ~2 hours each
- Same task: **Alt #1 truncation consolidation** — extract `src/utils/truncate.ts` helper covering 8 slice+length sites across `src/context-assembler.ts`, `src/revert-detector.ts`, `src/opus-reflection.ts`. Full prompt: `experiments/ablation-1-task-prompt.md` (gitignored).
- Same model: `claude-opus-4-7`
- Same Claude Code version: `2.1.118`
- Same starting commit: `9e67b14` (synced remote+local)
- Threshold (A only): `cum_x100 ≥ 240` (default per shell hook)

### Conditions
| Condition | reflect | Other |
|---|---|---|
| A | Enabled (default threshold cum_x100 ≥ 240) | Identical |
| B | Disabled (`REFLECT_DISABLED=1` in `.env`) | Identical |

### Procedure (D4 early-shift; deviates from D1 plan due to 05:08 PT catch-up start)
1. D4 05:08–05:50 PT: prep — coin flip, base SHA verify, `.env` toggle, `rm -rf .reflect/`
2. D4 06:00–08:00 PT: **Run 1 = Condition B** (REFLECT_OFF), no screen-record (Hawthorne)
3. D4 08:00–09:00 PT: reset (`git stash && git checkout 9e67b14`, `rm -rf .reflect/`, `.env` toggle)
4. D4 09:00–11:00 PT: **Run 2 = Condition A** (REFLECT_ON), no screen-record
5. D4 11:00–12:00 PT: review both, fill metrics table, post + 24h re-rate plan

### Random ordering
Run order randomized to mitigate fatigue + memorization bias.
**Coin flip**: bash `$RANDOM = 21483` (odd). Pre-agreed mapping: even → A first, odd → B first.
**Result**: **B (REFLECT_OFF) runs first, A (REFLECT_ON) runs second.**
Memorization risk on Run 2 (A) acknowledged in threats-to-validity.

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
