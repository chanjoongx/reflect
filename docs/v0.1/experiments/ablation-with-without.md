# Ablation 1: With reflect vs Without — **DEFERRED to v1.1**

> **Status (2026-04-24 D4 late afternoon PT)**: This ablation is **deferred to v1.1** (post-hackathon, N≥30 across 5+ users, counter-balanced design, blind grading). Decision-log below.
> The rest of this document is preserved as the original design, for transparency and to show the ablation was genuinely planned — not skipped from neglect.

---

## Decision-log (why we did not run it)

The v1 ablation as designed had three compounding methodological problems that, together, made the data we would collect weaker than the qualitative case studies we could produce instead in the same time budget.

1. **Primary metric (Tier 1/2 reverts per hour) mismatches the author's working style.** The author primarily vibe-codes with Claude Code — accepting diffs, pushing back verbally, rarely running `git revert`/`git restore`. Under vibecoding, the dominant revert signal is Tier 3 (user utterance), which accumulates too slowly to reliably cross the `cum_x100 ≥ 240` trigger threshold in a 2-hour session. Expected reflect fires per 2h vibecoded session: 0–2 — too few to separate signal from noise at N=2.
2. **"Same task" breaks under vibecoding.** The author's prompt sequences in Run 1 and Run 2 would differ meaningfully (vibecoders encode insight in prompts, not edits), so the learning effect between runs is larger than for a non-vibecoding user. Counter-balancing with a single subject cannot control for this.
3. **N=2 self-experiment on one's own tool is unfalsifiable.** Positive → suspected bias. Null → power too low to distinguish. Negative → hard to interpret. Any result reads as amateur science under judging scrutiny, and the honest weight such data deserves is small.

The opportunity cost was ~6 hours (2h Run 1 + 1h reset + 2h Run 2 + 1h analysis) on D4 afternoon. Redirecting that budget to dogfood harvest + submission-writeup polish + demo dry-runs produced better evidence per hour: qualitative case studies from the real usage over the week, with explicit "changed my next move? Y/N/Worse/Inconclusive" labels — the form of evidence that reflect's own hypothesis (metacognition reframes stuck moments) is actually testable against at single-subject scale.

**What we ship instead, in the submission**:
- `hackathon/DOGFOOD-LOG.md` — qualitative entries from real usage (target ≥ 12 by D5)
- Demo scene 02:00-02:30 shows a single concrete real reflection (cache/cost/latency + pattern/signal/adjustment) rather than a weak chart
- Honest limitations section in `SUBMISSION-WRITEUP.md` "Opus 4.7 feedback" naming this choice explicitly

**What v1.1 ablation would look like** (post-hackathon, 2026-05+): N ≥ 30 sessions across 5+ users, counter-balanced task order, blind grading by at least one external rater, pre-registered primary outcome that is NOT Tier 1/2 revert count (candidates: time-to-task-completion, final-state quality by blind rater, subjective flow 1–5, trajectory-divergence entropy for long autonomous runs).

See also: `experiments/ablation-components.md` (also deferred, same rationale).

---

## Hypothesis (original design, preserved for reference)

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

**Status**: Plan documented D1. **Run deferred to v1.1** — decision-log at top of this file (2026-04-24 D4 late afternoon PT). Qualitative evidence via `hackathon/DOGFOOD-LOG.md` + demo scene 02:00-02:30 + honest limitations paragraph in `SUBMISSION-WRITEUP.md`.
