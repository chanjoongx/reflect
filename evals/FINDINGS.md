# Replaying reflect's detector on 109 real sessions

> **Result: the shipped detector fired 0 times. Not once. Across 17,180 tool calls
> and 2,275 user prompts.**
>
> This document is the follow-up that [`docs/v0.1/experiments/ablation-with-without.md`](../docs/v0.1/experiments/ablation-with-without.md)
> said it could not run in April, run now against a corpus that did not exist then.

**Date:** 2026-07-15 · **Harness:** [`evals/replay_history.py`](./replay_history.py) · **Reproduce:**
`python evals/replay_history.py --projects ~/.claude/projects --out evals/out`

---

## 1. Why this, and why not the ablation

In April I designed a with/without ablation and then killed it. The decision-log
([ablation-with-without.md](../docs/v0.1/experiments/ablation-with-without.md)) gave three reasons; the third
still holds and always will:

> *"N=2 self-experiment on one's own tool is unfalsifiable. Positive → suspected bias.
> Null → power too low to distinguish. Negative → hard to interpret."*

That reasoning was right, and I would make the same call again. But the same document
left a **falsifiable** claim on the table and never tested it:

> *"Under vibecoding, the dominant revert signal is Tier 3 (user utterance), which
> accumulates too slowly to reliably cross `cum_x100 >= 240` ... **Expected reflect fires
> per 2h vibecoded session: 0–2.**"*

That is a prediction about the **detector**, not about the intervention. It needs no
control group and no blind rater — only a corpus of real sessions and the shipped
detector. I now have 1,606 Claude Code transcripts. So I replayed it.

**The prediction was directionally right and quantitatively wrong. Not "0–2." Zero. Always.**

---

## 2. Method

Replays the **canonical shell hooks** (`hooks/reflect-trigger.sh`, `hooks/reflect-utterance.sh`) —
*not* the TypeScript reference impl in `src/revert-detector.ts`, which
[diverges from production](../src/revert-detector.ts) (different file-delete tier,
sliding window vs monotonic accumulator, unwired Tier-2 inversion).

Production semantics, reproduced exactly:

| Signal | Weight | Rule |
|---|---|---|
| Tier 1 | 1.0 | Bash `^(git revert\|git restore\|git checkout HEAD --)` |
| Tier 2 | 0.7 | Bash `^(rm \|unlink )` **and not** `(node_modules\|dist\|build\|.next\|coverage)` |
| Tier 3 | 0.5 | UserPromptSubmit matching the negation regex (positive-negation exclusion checked first) |

Accumulator: monotonic `cum_x100`; fires at `>= 240`; resets to 0 on fire. No sliding window.

**Corpus.** 1,606 `.jsonl` transcripts. **1,497 are sidechain-only** (subagent transcripts;
the hooks observe main-thread traffic, so they are excluded — a real limitation, stated
rather than hidden). **109 sessions carry main-thread traffic**, and those are the corpus:

- **17,180 tool calls**
- **2,275 user prompts** — **59% of them Korean**

---

## 3. Result

```
SIGNALS (production, as shipped)
  Tier 1  git revert/restore/checkout   w=1.0 :      1
  Tier 2  rm/unlink (non-artifact)      w=0.7 :     13
  Tier 3  user negation (ENGLISH)       w=0.5 :      0     <-- 0 of 2,275

FIRES (cum_x100 >= 240)
  total fires                                  :      0
  sessions that fired                          :   0/109   (0.0%)
```

**Threshold sweep** — the threshold is not the problem:

| threshold | fires | sessions fired |
|---:|---:|---:|
| 1.00 | 3 | 3 / 109 |
| 1.40 | 2 | 2 / 109 |
| 1.70 | 1 | 1 / 109 |
| 2.00 | 1 | 1 / 109 |
| **2.40 (shipped)** | **0** | **0 / 109** |
| 3.00 | 0 | 0 / 109 |

Lowering the threshold all the way to 1.0 — i.e. *one single `git revert` fires it* — still
only reaches 3 sessions out of 109. **There is no threshold at which this detector works for
this user.** The signal isn't weak. It's absent.

---

## 4. Root cause

**The detector is calibrated for a user who reverts with `git`. I am a user who redirects
with words. And the words are Korean.**

- **Tier 1 fired once in 17,180 tool calls.** I don't `git revert`. I say "아니, 다시 해줘."
- **Tier 2 fired 13 times**, at 0.7 each — you'd need four `rm`s in a row, uninterrupted, to
  reach 2.4. That never happens.
- **Tier 3 — the signal my own design doc predicted would dominate — fired 0 times in 2,275
  prompts.** The regex is English-only:

  ```
  no wait | no stop | no, | nope, | nah, | undo that | revert that
  | that's wrong | stop | don't | hold on | wait, | please undo | ...
  ```

  **59% of my prompts are Korean. None of them can match.**

I shipped this to npm and used it for ~3 months without noticing, because I never looked at
the data. The tool was, for me, a no-op with a `$0.01` price tag it never charged.

---

## 5. The naive fix does not work — and *that* is the interesting part

The obvious repair is to translate the regex. I wrote a Korean-aware Tier 3 as a
**counterfactual only** (not shipped) and replayed:

```
COUNTERFACTUAL — if Tier 3 also matched Korean
  Tier 3 (KO) candidates missed by production  :     45
  total fires                                  :      5   (+5)
  sessions that fired                          :   4/109  (3.7%)
```

Then I hand-labeled all 45 candidates: *is this correcting something the assistant just did?*

| Label | n | Examples |
|---|---:|---|
| **True correction** | **25** | *"아니, 내가 원하는건 …. 다시 만들어"* · *"아냐 유지하자"* · *"국민대 미래자동차사업단 아니야. 해당 문구 빼줘"* |
| Borderline (interrogative) | 5 | *"이거 로그인 기능 넣으면 되잖아?"* |
| **False positive** | **15** | see below |

**Precision ≈ 56%** (25/45 strict; 67% if borderline counts). A regex that is wrong 4 times
out of 10 is not a detector — at w=0.5 and threshold 2.4, five noisy hits fire a real API call.

### The false positives cluster in one place, and it is diagnostic

**8 of 15 are guardrail instructions in a prompt preamble**, not corrections:

> *"읽기 전용 검토만 한다. 어떤 파일도 생성, 수정, **삭제하지 마라.**"*
> *"--continue로 이어서. 새 실험도, 새 수치 생성도, 논문 수정도 **하지 마라.**"*

The rest: 2 pasted blobs (an assistant transcript, a Cloudflare UI dump), 3 questions
(*"…아니야?"* as an interrogative), 2 stray matches on `잠깐` / `안그럴거아냐` in reasoning.

So:

```
"수정하지 마라"   at the head of a new task   →  instruction     (not a signal)
"수정하지 마"     right after an Edit         →  correction      (a signal)
```

**Same string. Opposite meaning. Disambiguated only by what the assistant just did.**

A regex over the utterance alone is *structurally incapable* of telling these apart — in any
language. English hides this because `"don't "` in a preamble is rarer; Korean surfaced it
because I write long guardrail preambles. The bug was never "the regex is English." The bug
is **"the detector is stateless when the signal is relational."**

---

## 6. What this changes

**Tier 3 should not be a pattern match. It should be a judge over a pair:**

```
(last assistant action, user's next utterance)  ->  is this a correction?  {yes, no}
```

That is a small, cheap, single-purpose classifier — a *micro-API* — and it is the same shape
as the problem it was always adjacent to: given a model output and the user's response, did
the output miss? The revert-detection problem and the hallucination-detection problem are the
same problem wearing different clothes.

**Next** (tracked, not claimed):
- [ ] Replace Tier 3 regex with a judge over `(prev_tool_calls, prompt)`; keep the regex as a
      cheap pre-filter to avoid a model call on every prompt.
- [ ] Build a labeled set from this corpus (45 candidates labeled; need the negatives too —
      sample non-matching prompts that *were* corrections, to get recall, not just precision).
- [ ] Re-run the sweep against the judge. Report P/R, not fire count.
- [ ] Re-examine Tier 1's weight. It fired **once** in 17,180 calls. A signal that rare should
      probably fire alone (w=2.4), not need company.

---

## 7. Honest limits

- **Single user, single language pair.** Precision/recall here describe *my* transcripts. The
  "0 fires" result generalizes to anyone who prompts in a language the regex doesn't speak —
  which is most of the world — but the exact numbers do not.
- **Sidechain traffic excluded** (1,497 of 1,606 files). The hooks are main-thread; whether
  subagent tool calls *should* count toward the accumulator is an open design question this
  replay does not answer.
- **The 45 labels are mine, first-pass, from 105-char previews.** They should be re-labeled
  at full length, ideally by someone who is not me. The *clusters* are unambiguous; the exact
  56% is not load-bearing and I would not defend the second digit.
- **This still measures the detector, not the intervention.** Whether a reflection *helps*
  once it fires remains untested, and remains unfalsifiable at N=1. That has not changed.

---

## 8. What I'd tell someone shipping an agent

Sendbird's own ZTI post makes the point better than I can:

> *"5만 개 테스트 대화에서 100% 통과해도 실제 고객 앞에서 무너진다. AI는 테스트 스위트를
> 마스터한 것이지 고객 응대를 마스터한 게 아니다."*

reflect passed its own design review, its own cost model, its own cache-eligibility analysis —
every number in [`docs/v0.1/measurements.md`](../docs/v0.1/measurements.md) is real and was measured
against the live API. And it fired **zero times** in three months of actual use.

**I measured everything about the call I was making, and nothing about whether I was making it.**
