# The detector fired zero times again — and this time the mechanism has a control

> **Result: on 837 turns from 224 sessions that did not exist when the July replay ran, the
> shipped detector produced 0 true positives against 141 real pushbacks. Replacing its regex with
> a judge that sees what the agent just did reaches 90% precision at 46% recall for about a
> quarter of a cent per 100 prompts.**
>
> **And the mechanism was tested against something that could have refuted it.** Hiding the
> agent's last turn costs 10.3 F1 points. Keeping the context block exactly where it is and
> filling it with *another pair's* prior turn costs **27.6** — worse than removing it. Whatever
> the sighted judge is using, it is not the shape of its prompt.

**Date:** 2026-08-23 · **Harness:** [`bench/`](.) · **Reproduce:** `npm run bench`
**Rubric fingerprint:** `c74d7145eb` · **Independently recomputed by:** `npx tsx bench/verify.ts`

---

## 1. What this follows up

[`evals/FINDINGS.md`](../evals/FINDINGS.md) established in July that reflect's shipped detector
fired 0 times across 109 sessions, and diagnosed why:

> *"수정하지 마라" at the head of a new task → instruction.*
> *"수정하지 마" right after an Edit → correction.*
> *Same string. Opposite meaning. Disambiguated only by what the assistant just did.*
> *The bug is that the detector is stateless when the signal is relational.*

It named three open items:

1. The 45 hand-labelled candidates gave **precision only** — nobody sampled what the regex missed.
2. "Relational, not lexical" was **an argument, not a measurement**.
3. One user, one language pair, one corpus.

This closes (1), settles (2) with a control that could have killed it, and closes (3) only
partially.

**It is not a replication.** Same developer, same `~/.claude/projects`, six weeks later. Claude
Code purges transcripts after ~30 days so almost none of the July files survive, but re-reading
one person's directory is a re-analysis, not an independent test.

---

## 2. Method

**Corpus.** 630 local transcripts, 229 carrying main-thread traffic → **225 sessions, 31,052 tool
calls, 837 user turns**. The corpus is live and grows as the developer works; an extract days
later will not reproduce these totals exactly.

**Unit.** The **pair**: `(everything the agent did and said since the human last spoke, the
human's next message)`.

**Labels.** SWE-chat's taxonomy verbatim ([arXiv 2604.20779](https://arxiv.org/abs/2604.20779)) —
`correction` / `rejection` / `failure_report` / `instruction` / `question` / `affirmation` /
`other`. Pushback is the first three.

**Five arms**, same pairs throughout:

| run | model | prior turn shown | role |
|---|---|---|---|
| `ref` | `claude-opus-5` | its own | reference annotator — a gold **proxy** |
| `prod` | `claude-haiku-4-5` | its own | the judge that would ship |
| `blindfair` | `claude-haiku-4-5` | none, prompt adjusted | the ablation |
| `blind` | `claude-haiku-4-5` | none, sighted prompt reused | naive ablation, for the mismatch delta |
| `shuffled` | `claude-haiku-4-5` | **another pair's** | **the control that decides it** |

4,185 annotations under the current rubric, **$24.28**. Total API bill across every pass including
the discarded ones: **$56.17**.

**Cache keying.** Verdicts are keyed on `(rubric fingerprint, run, pairId)`. Without the
fingerprint a cache accumulated across a day of rubric edits silently mixes annotators — the first
pass ended with 710 duplicated keys, 31 of which **disagreed on the label**, with ground truth
decided by which line was appended last. Scorer, verifier and review exporter all apply the same
filter, so a rubric change is a cache miss rather than a contamination.

### Making the extractor honest

Three contaminations, all found by reading the extracted pairs rather than trusting the count:

- **Harness injection.** `<task-notification>`, `!` command echoes and hook context preambles
  accounted for **465 of 1,400** raw `user` events. Every Claude Code injection channel uses a
  hyphenated tag name and ordinary HTML does not, so the filter is structural rather than a
  hand-maintained denylist.
- **Auto-compaction summaries.** `"This session is being continued…"` is written into the
  transcript as a user message. 87 of the survivors were these, and they are the longest messages
  in the corpus.
- **Non-unique pair ids.** `<sessionId>:<promptIndex>` collided: one session outlived a project
  rename and was written into two folders, so `<session>:0` named a 5,989-character job posting
  *and* a 44-character question about texting a recruiter, sharing one label.

---

## 3. The shipped detector, again

```
SIGNALS (production, as shipped, over 31,052 tool calls and 837 prompts)
  Tier 1  git revert/restore/checkout            :      0
  Tier 2  rm/unlink (non-artifact)               :     10
  Tier 3  user negation regex (ENGLISH)          :      0     <-- 0 of 837
```

| detector | TP | FP | FN | precision | recall | F0.5 |
|---|---:|---:|---:|---|---|---:|
| **B0 — shipped regex** | **0** | **0** | **141** | **0.0%** | **0.0%** | **0.0%** |
| B1 — + Korean regex | 11 | 23 | 130 | 32.4% | 7.8% | 19.9% |
| B2 — structural gate alone | 106 | 288 | 35 | 26.9% | 75.2% | 30.9% |
| B4 — judge on every prompt | 70 | 10 | 71 | 87.5% | 49.6% | 75.9% |
| **B5 — cascade, gate θ=0.30** | 65 | 7 | 76 | **90.3%** | 46.1% | **75.8%** |

**141 pushback turns. Zero found.** 49 of 224 sessions contain at least one; the shipped detector
fires in **0** of them, the cascade in 36.

A broader unanchored English probe (`no wait|undo that|revert that|that's wrong|hold on|don't|
stop it|scrap that|start over`, anywhere in the first 400 characters) also returns **0**, so this
is not an artefact of the `^` anchor or the window. 122 of the 141 true pushbacks contain Latin
characters — the corpus is not missing English, it is missing English *negation*.

B1 is the instructive failure. Translating the regex, the obvious fix, buys 32% precision at 8%
recall. It is not that it is bad at Korean. It is that it is a regex.

**One scoring caveat, stated because it favours B0.** The shipped detector is an accumulator that
needs `cum_x100 ≥ 240`, not a per-turn classifier. Scoring the candidate signal per turn is
strictly more generous than production, so the conclusion is safe in the direction it points.

### A live control, unplanned

The shipped hooks were active throughout the session that produced this document. At the end,
`.reflect/state.json` read `{"turn_count": 104, "cum_x100": 0}`. The threshold is 240. The detector
watched its own replacement being built and registered nothing.

---

## 4. The control that decides the mechanism

Same model, same pairs. What changes is the prior turn.

| arm | prior turn | precision | recall | F1 |
|---|---|---|---|---:|
| sighted | its own | 87.5% | 49.6% | **63.3%** |
| **shuffled** | **another pair's** | 84.2% | 22.7% | **35.8%** |
| blind (fair) | none | 89.8% | 37.6% | **53.0%** |
| blind (naive) | none, sighted prompt | 88.3% | 37.6% | 52.7% |

**The format placebo settles it.** A judge given a *wrong* context block scores 27.6 F1 points
below one given the right block — **267% of the 10.3 points that removing the block costs**.
Present-but-wrong is worse than absent, because the judge trusts it and is actively misled. Had
the sighted arm's advantage been the shape of its prompt, shuffled would have matched it. It does
not, and this control was designed to be able to say otherwise.

**Prompt mismatch is not the explanation.** The naive blind arm reuses a rubric that opens by
promising context it never receives. Adjusting exactly that paragraph moves the gap by **0.3
points**. On an earlier corpus, before the truncation bug in §7 was fixed, the same adjustment
moved it by 3.5 — worth recording, because it shows how far a measurement of a measurement can
travel.

**The loss is almost entirely recall.** Removing the prior turn costs **12.1 points of recall**
against 10.3 of F1 — precision barely moves. Without context the judge retreats to `instruction`,
which is exactly what the shipped regex does, for exactly the same reason.

**The gap is distinguishable from zero, barely.** Paired bootstrap on ΔF1: i.i.d. rows
**[2.3, 18.9]**, clustered by session **[1.2, 19.8]**, P(Δ≤0) = 0.015. Turns within a session are
not independent draws, so the clustered interval is the honest one. **10.3 points with a very wide
interval** is the correct way to quote this; the point estimate alone is not.

### What the ablation does NOT support

Two things an earlier draft claimed and this one withdraws.

**Agreement and κ are not evidence here.** Stratified by how much the prior turn contains, the
7-way agreement gap is roughly flat — and it is present on the 264 rows where the prior turn is
*absent* and the sighted arm is shown one sentence saying so. That sentence is itself information
(it identifies a session opener), but the agreement number also picks up the sighted arm sharing
an input rendering with the reference annotator. F1 against the reference is reported instead.

**Part of the loss is the rubric abstaining, not failing.** `JUDGE_SYSTEM` tells the judge to
answer `other` when the shown context is too thin — a condition the ablation manufactures. Blind
answers `other` 82 times against the sighted arm's 33. Excluding every row where either arm
abstained, the gap falls from 10.3 to **6.8 points**. Still positive, still the same direction,
smaller than the headline.

**And the signal is in the prose, not only the actions.** ΔF1 is 9.4 where the prior turn has text
but zero tool calls, and 10.5 where it has tool calls — nearly flat. Stage A encodes only actions,
which means the cheap gate approximates the wrong half of what the judge is using.

---

## 5. What a structural gate costs

Stage A reads no words. It asks only where the prompt sits relative to what the agent just did,
which is why it works in every language for free.

Alone it is a **bad detector and a good gate**: 75.2% recall at 26.9% precision. That is the right
shape for a cheap first stage.

The hard rule — and there is exactly **one**, no prior assistant turn — rejects **264 of 837**
pairs (31.5%) and discards **4** true pushbacks. Recall ceiling behind it: **97.2%**. An earlier
version advertised two rules; the second (`session_opener`) was unreachable, because a session's
first prompt has no prior turn by construction. It fired once in 837 pairs. The single rule covers
224 session openers and **40 mid-session consecutive user messages** — the second group is the one
worth watching, because a correction can target work from two turns back and this gate cannot see
it.

| gate θ | judge calls / 100 | precision | recall | F0.5 |
|---:|---:|---:|---:|---:|
| 0.00 | 68 | 87.9% | 49.6% | 76.1% |
| 0.30 | 61 | 90.3% | 46.1% | 75.8% |
| 0.50 | 47 | 94.6% | 37.6% | 72.6% |
| 0.70 | 29 | 96.0% | 24.1% | 61.2% |

**θ was selected in-sample.** Seven thresholds were swept on the same 837 rows that report the
result. There is no held-out selection, so the operating point describes this corpus rather than
recommending itself.

---

## 6. The corpus is mostly not coding traffic, and that inverts two conclusions

Only **286 of 837** turns (34.2%) follow a turn in which the agent touched a code-like file. The
rest is résumé editing, interview preparation, research and business writing — real Claude Code
sessions, but not what a coding-agent correction detector is aimed at.

| corpus | n | pushback rate | gate discards | judge calls / 100 | B5 precision | B5 recall |
|---|---:|---:|---:|---:|---:|---:|
| full | 837 | 16.8% | 31.5% | 61 | 90.3% | 46.1% |
| **prior touched code** | 286 | **30.4%** | **0.0%** | **98** | 97.9% | 54.0% |

**The SWE-chat gap is composition, not personality.** On coding turns pushback is 30.4% against
SWE-chat's 39% — close. The 16.8% headline is diluted by non-coding sessions, not explained by
"this developer writes long specifications," which is what an earlier draft claimed.

**The cascade's cost advantage largely evaporates on the target traffic.** Turns that follow code
edits are exactly the turns the gate cannot discard: it drops **0%** of them, and the cascade
costs **98 judge calls per 100 prompts** rather than 61. The 61 comes from session openers and
non-coding work.

---

## 7. Twelve bugs, none of them visible in the numbers

`bench/verify.ts` recomputes the load-bearing figures from the raw JSONL with plain counters and
no shared code. An adversarial review ran a second, harder pass. Between them:

| | what was wrong | how it surfaced |
|---|---|---|
| pair ids | `<session>:<index>` collided across a renamed project folder | verifier counted 833 where the scorer counted 834 |
| truncation | `redactString` repaired lone surrogates, then `.slice(0, 2500)` cut an emoji in half and made a new one | 13 `no low surrogate in string` failures — the truncation was the damage, not the input |
| head vs tail | extract stored the **first** 4,000 chars of a turn; the renderer took the **last** 1,400 of that and called it "ending its turn" | 17% of turns showed the judge the *middle*, labelled as the end |
| fence before parse | `parseVerdict` stripped a code fence before trying `JSON.parse` | 33 unrecoverable failures, biased toward code-heavy prompts |
| tie-blind AP | 265 rows tie at exactly 0 and only the hand-prior arm has ties | AP moved ±0.04 on tie ordering alone |
| unconverged fit | 3,000 iterations was short; two weights changed sign on the way to 22,000 | the published "these priors are backwards" list named the wrong features |
| 10 vs 13 features | the fit was given three inputs the hand model does not have | "the same features" was simply false |
| cost over raw rows | cost iterated the append-only log, not the deduped eval set | n=1327 against an 836-pair corpus |
| biased shuffle | `sort(() => rnd() - 0.5)` over-sampled the first projects 2.3× | affects `--max` runs only |
| whitespace after unmask | fenced code was masked to protect it, then had its indentation collapsed anyway | changed a scored feature and the judge's input |
| error attribution | an error marked the last call in flight, ignoring `tool_use_id` | 28 of 777 errors named the wrong tool in the judge's prompt |
| clock from harness | dropped background-task events advanced `endedAt` | 26 of 573 gaps wrong; 7 flipped `staleGap` → `fastReply` |

The test suite went from **36 to 86** cases in the same pass, because most of these lived in code
whose own header claimed it was tested and was not.

---

## 8. Headroom, recomputed

Hand priors are deliberately unfitted — fitting on one developer's corpus is the mistake the
English-only regex made, one level up.

| model | inputs | AP |
|---|---:|---:|
| hand priors | 10 | 0.275 |
| **`priorMutation > 0` alone** | **1** | **0.272** |
| CV logistic, same 10 inputs | 10 | 0.380 |
| CV logistic, three more inputs | 13 | 0.415 |
| chance | — | 0.168 |

**A single binary feature matches the entire hand-designed scorer.** The other nine terms and
their weights are, on this corpus, decoration. That strengthens the headroom argument and destroys
the artefact the argument was about: the gate should be re-derived, not re-weighted.

---

## 9. Where the cheap judge is weak

| label | precision | recall | F1 | support |
|---|---:|---:|---:|---:|
| correction | 81.7% | **46.0%** | 58.9% | 126 |
| rejection | 50.0% | 100.0% | 66.7% | 3 |
| failure_report | 100.0% | 25.0% | 40.0% | 12 |
| instruction | 89.5% | 93.9% | 91.7% | 544 |
| question | 74.3% | 88.9% | 80.9% | 117 |
| **macro** | | | **67.9%** | 837 |

The error is one-directional: Haiku calls corrections *instructions*, not the reverse. For a
harness whose false positives interrupt a working developer that is the safe direction to be wrong
in — but it is the ceiling on recall. Note also that `rejection` has support 3 and
`failure_report` 12, so the macro average is dominated by classes too small to trust.

---

## 10. A silent caching failure

The Haiku arms report a **0% prompt-cache hit rate** across 3,348 calls. The reference arm, same
code path, reports 100%.

Probed directly, each variant sent twice:

```
claude-haiku-4-5  @ 2,207 tok  ->  cache_creation 0,     cache_read 0      (nothing, no error)
claude-haiku-4-5  @ 4,378 tok  ->  cache_creation 4378,  cache_read 4378
claude-opus-5     @ 3,288 tok  ->  caches normally
```

**Haiku 4.5's minimum cacheable prefix is 4,096 tokens**, not the ~1,024 that applies to most
models. Below the floor the API does not error: `cache_control` is accepted, the counters come back
zero, and you pay full price forever. Two compounding traps: the failure is silent, and the two
models tokenise the same string at a **1.30× ratio** (2,196 on Haiku, 2,871 on Opus), so a floor
cleared under one model's `count_tokens` is not cleared under the other's.

reflect already knew a version of this — its own L1 is padded to 4,741 tokens for a documented
Opus 4.7 floor. The lesson did not transfer, because the number was recorded as a fact about
*caching* rather than a fact about *a model*.

Not fixed yet, deliberately: padding the judge prompt changes the annotator and invalidates the
labelled corpus every number here rests on. It is a P1 task worth roughly half the judge spend.

---

## 11. Honest limits

- **The reference is a gold proxy.** Opus 5 labelled it; no human has checked. `bench:review`
  exports 130 disagreements, 4 low-confidence cases and a 60-row random draw for exactly that
  purpose. Until someone fills them in, no number here is human agreement.
- **"Precision" means agreement with Opus 5.** `prod` and `ref` share the identical rubric and
  rendering; only the model differs. Systematic rubric bias is invisible to this measurement.
- **26% of rows are duplicate prompts.** 837 rows contain 685 distinct prompts; the largest group
  is 30 identical automated health-check pings across 30 sessions. On distinct prompts only, the
  pushback rate rises to 19.4% and the ablation gap to 10.9 — direction holds, effective sample is
  smaller than 837.
- **One developer, one language pair.** The zero-detection result generalises to anyone prompting
  in a language the regex does not speak. The precision and recall figures do not.
- **Main-thread only.** 401 sidechain transcripts excluded, as in July.
- **θ was chosen in-sample**, on the rows that report the result.
- **This measures the detector, not the intervention.** Whether a reflection *helps* once it fires
  remains untested and remains unfalsifiable at N=1. That has not changed since April.
- **The experiment code is not committed.** Until it is, "reproduce with `npm run bench`" is a
  claim about a working tree, not about a revision.

---

## 12. What this changes in the repo

| | before | after |
|---|---|---|
| detector implementations | 5 (shell ×2, PowerShell ×2, TS reference), documented as divergent | 1 TypeScript module the bench calls directly |
| tests | `npm test` globbed `src/**/*.test.ts` and matched nothing | **86** cases across parser, detector, metrics, pricing, redaction |
| judge output | fence regex + hand-written type guard | JSON-schema structured output, parsed before fence extraction |
| ground truth | 45 hand-labelled candidates, precision only | 837 pairs × 5 arms, with a placebo control and clustered intervals |
| label provenance | append-only, last-line-wins | keyed on a rubric fingerprint; a prompt change is a cache miss |
| corpus construction | a Python re-implementation of the shell hooks | production code, called directly |
| number checking | none | `verify.ts` recomputes independently and exits non-zero on drift |

The structured-output path fixes a real defect, not a theoretical one: asked for a classification
without a schema, Haiku returned `{"label": "undo_request", "confidence": 0.92}` — a label outside
the enum and a confidence of the wrong type. The shipped parser would have accepted the shape and
moved on.

---

## 13. What I would tell someone shipping a detector

July's document ended: *"I measured everything about the call I was making, and nothing about
whether I was making it."*

The correction is not "measure more." It is that **a claim about a mechanism needs a control that
could kill it.** The blind arm was not that control — it removes two things at once and hands the
rubric an excuse to abstain. The shuffled arm is: identical shape, wrong content, one thing
different. It cost $3.62, and it is the only reason §4 is a result rather than a story.

The second lesson is smaller and more embarrassing. Twelve real bugs surfaced in a single day,
none visible in the numbers, most in code whose own comments claimed it was tested. An independent
recomputation found two of them. An adversarial reader found the rest. Neither was optional.
