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
| 0.00 | 68 | 87.0% | 47.5% | 74.6% |
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

---

## 14. What 0.2 ships, and what is still unmeasured (added 2026-11-16)

The cascade above is now the product. `src/hook/run.ts` runs it from Claude Code hooks: the
structural gate with its one hard rule (θ = 0, no threshold), then the judge, on every developer
message. The benchmark and the hook share `pairForPrompt` in `src/transcript/parse.ts`, which
wraps the same transcript walker the extractor uses. Over 1,477 live transcripts the refactored
walker produced 3,002 pairs identical to those of the August version.

**The trigger was chosen by replay, in-sample.** `bench/session-sim.ts` feeds cached `prod`
verdicts through each policy in `src/trigger/accumulator.ts`, with the same policy run on the
reference labels as the target:

| policy | fires | supported | sessions fired | should fire | session precision | session recall |
|---|---:|---:|---:|---:|---:|---:|
| 0.1.4 as shipped | 0 | n/a | 0 | n/a | n/a | n/a |
| each pushback | 77 | 67 (87.0%) | 36 | 49 | 97.2% | 71.4% |
| **k2w6 (default)** | 20 | 17 (85.0%) | 16 | 26 | 93.8% | 57.7% |
| k3w8 | 8 | 6 (75.0%) | 7 | 16 | 100.0% | 43.8% |

Firing on every pushback scores better on both session measures. The default is k2w6 anyway, and
that is a product judgement, not a measured one: a single correction is already in the agent's
context as the developer's own words, so a reflection on it mostly paraphrases them back, at an
Opus call each time. Two within six turns is the first point at which "what does the agent keep
missing?" has an answer. Whether the note changes the agent's next turns is not measured by any of
this. That needs a session-level experiment with and without delivery, which no file here runs.

**The judge on Claude Haiku 5.5 (rerun 2026-11-16).** 0.2 calls Claude Haiku 5.5 ($0.10 / $0.50
per MTok, against $1 / $5 for Haiku 4.5). The rubric is unchanged (fingerprint `c74d7145eb`), and
`npx tsx bench/label.ts --runs h55,h55t` relabelled the same 837 pairs for $0.39 with no failed
calls. `bench/score.ts` §12 scores both runs behind the θ = 0 gate against the same Opus 5
reference, with Haiku 4.5 rescored on the same pairs:

| judge | precision | recall | F1 | F0.5 | Δ F0.5 vs Haiku 4.5 (95% CI, by session) | same label as reference (7 labels) | per call |
|---|---:|---:|---:|---:|---:|---:|---:|
| Haiku 4.5 (`prod`, August) | 87.0% | 47.5% | 61.5% | 74.6% | | 84.5% | $0.0043 |
| **Haiku 5.5, thinking off (`h55`, shipped)** | **97.4%** | **53.9%** | **69.4%** | **83.9%** | +9.3 (+2.5 to +18.5) | 85.7% | $0.00023 |
| Haiku 5.5, adaptive thinking at effort low (`h55t`) | 93.6% | 51.8% | 66.7% | 80.6% | +6.0 (-1.7 to +16.1) | 85.2% | $0.00024 |

In counts: Haiku 5.5 flags 78 turns, 76 of them pushback by the reference, and finds 76 of the
141; Haiku 4.5 flagged 77, 67 of them pushback. Adaptive thinking added three output tokens per
call on average, so at effort low it barely engaged, and the run without it is better on every
column. The judge's system prompt (3,287 Haiku 5.5 tokens) now clears the caching floor that
Haiku 4.5's did not (§10): every call in the run read it from cache, which is why a call costs
$0.00023 rather than $0.00053.

The replay on the Haiku 5.5 verdicts (`npm run bench:sim -- --run h55`):

| policy | fires | supported | sessions fired | should fire | session precision | session recall |
|---|---:|---:|---:|---:|---:|---:|
| each pushback | 78 | 76 (97.4%) | 37 | 49 | 100.0% | 75.5% |
| **k2w6 (default)** | 21 | 21 (100.0%) | 17 | 26 | 100.0% | 65.4% |
| k3w8 | 10 | 10 (100.0%) | 9 | 16 | 100.0% | 56.3% |

21 supported fires out of 21 has a Wilson 95% interval of 85% to 100%. The model was chosen after
the rubric was frozen, so this comparison does not tune the rubric to Haiku 5.5; the rubric, the
gate and the trigger were still all chosen on this corpus.

**One live session.** On 2026-11-16 the bundled plugin ran in four `claude -p --resume` turns of a
scratch session, with the key passed only to the hooks. Turn 1 was skipped as a session opener;
turns 2 and 3 ("No, that's not what I asked for", "Still wrong: you added a heading again") were
judged correction, high; turn 3 fired `k2w6`; Opus 5.5 wrote the note in 10.3 s for $0.0197; it
was delivered when turn 4 started, and the agent's reply did the check the note named. The first
attempt lost the note: `claude -p` exits as soon as the agent answers, and the async hook,
mid-reflection, went with it. The reflection now runs in a detached worker process. This is one
toy session, and it tests the wiring, not whether notes help.

**A corrected row.** The θ = 0 row of the table in §5 read 87.9% / 49.6% / 76.1% until 2026-11-16.
No run produces those numbers; the generated `bench/results/report.md` has always given 87.0% /
47.5% / 74.6%, and the row now matches it.

**Still open from §11.** The reference is still a model. The human review sheets are still empty.
The corpus is still one developer's, two thirds of it not coding.


## 15. 0.4: the request shape mattered more than the rubric (added 2026-11-16)

**How the judge is asked changed what it finds.** The 0.3 plugin could not send structured
output (`$.model.complete` has no such option), so it put the verdict schema at the end of the
message and parsed the answer tolerantly. `bench/variants.ts` judged all 837 pairs three ways with
the same rubric (`c74d7145eb`), Claude Haiku 5.5, thinking off, effort low:

| request | found | false alarms | precision | recall | F0.5 | Δ F0.5 vs structured (95% CI, by session) | k2w6 fires (supported) | sessions reached of 26 |
|---|---:|---:|---:|---:|---:|---|---|---|
| structured output (`h55`, the 0.2 and 0.3 npm command) | 76 | 2 | 97.4% | 53.9% | 83.9% | | 21 (21) | 17 |
| CLI identity line, schema in the message (`v0-mod`, the plugin) | 98 | 2 | 98.0% | 69.5% | 90.6% | +6.7 (+3.5 to +10.4) | 26 (25) | 18 |
| schema in the message (`v0-text`) | 101 | 3 | 97.1% | 71.6% | 90.7% | +6.8 (+3.2 to +10.8) | 30 (29) | 20 |

The identity line made no difference; the schema's place did. With structured output the judge
labelled more pushback turns `instruction`. I did not find out why. 0.4 sends the schema in the
message from both forms (`judgePair(..., { format: "prompt" })` in the npm hook); `bench/label.ts`
keeps structured output so the cached `h55` labels stay what they were. Per call: $0.00026, about
4,600 input tokens of which 2,840 come from cache, 105 output tokens, 1.3 s.

**A held-out half, late.** The rubric and trigger were chosen on all 837 pairs, so from 0.4 on
the sessions are split by `fnv("split:" + sessionId) % 2`: a dev half (106 sessions, 373 pairs,
64 pushback) for trying changes and a test half (118 sessions, 464 pairs, 77 pushback) left alone.
The request comparison above was run before the split existed, so it is in-sample. On the test
half alone the plugin's request gains +4.0 F0.5 (+0.8 to +7.7) and the npm request +3.2 (-1.4 to
+7.6).

**Rubric edits for the remaining misses did not pay.** On the dev half, v0-text missed 18 of 64
pushback turns. Read one by one, most were messages that call the round the agent just delivered
not good enough and then ask for more (in substance: still not enough, take it to production
quality, do it properly), and a few supplied a fact that overturned the agent's last answer. Three edits of the
rubric (`bench/judge-variants.ts`) were tried on the dev half only:

| rubric (dev half) | found | false alarms | precision | recall | F0.5 |
|---|---:|---:|---:|---:|---:|
| v0, shipped | 46 | 1 | 97.9% | 71.9% | 91.3% |
| v1: dissatisfaction with the delivered round is correction | 51 | 5 | 91.1% | 79.7% | 88.5% |
| v2: v1 plus new facts that overturn the last answer | 52 | 6 | 89.7% | 81.3% | 87.8% |
| v3: v2 without "a missed correction is cheap" | 49 | 7 | 87.5% | 76.6% | 85.1% |

The new false alarms were mostly the same kind of message, which the Opus 5 reference labels both
ways: a short "still not enough, make it more refined" is `instruction` in one place, and a
near-identical message two turns later in the same session is `correction`. A rubric cannot agree with a
reference that disagrees with itself, so the shipped rubric stays, and the test half was not
used to choose anything. Settling this class needs the human review sheets.

**Does the note change what the agent does?** `bench/note-effect.mjs` runs scripted `claude -p`
sessions over stream-json in a fresh folder, with the plugin (`reflect`) and without it (`none`).
The developer pushes back twice, each time only if the agent did the thing objected to, then the
conversation is compacted with `/compact`, then the agent gets three more tasks.

Haiku 5.5 is the agent unless stated.

- **style.** The project's files use function declarations with JSDoc. The pushbacks are "no
  comments" and then "const arrow functions". All 10 runs (5 per arm) sent both, and all 5
  `reflect` runs delivered a note. After the compaction every one of the 30 new functions followed
  both rules: 15 of 15 in each arm. Claude Code's compaction summary kept the rules nearly word for
  word ("Style constraints from the user, which override my earlier choices: no comments ...,
  arrow functions assigned to `const`"). The note added about $0.028 per session and changed
  nothing that this script measures.
- **scope.** The project has a README list of functions, tests, a CHANGELOG and a `src/index.js`
  that re-exports each module. The pushbacks are "don't touch README.md" and then "don't write
  tests unless I ask"; neither names CHANGELOG.md or `src/index.js`. The Haiku agent edited only
  the file it was given from the start (one run per arm), so no pushback was ever sent, and one
  Sonnet 5.5 run did the same. Opus 5.5 was the only agent that strayed. In one run without the
  plugin it edited README, CHANGELOG and a test with the first function and a test with the
  second, drew both pushbacks, and after the compaction changed only the named file in all three
  tasks, CHANGELOG and `src/index.js` included. It generalized from two specific corrections on
  its own. In one run with the plugin it stayed in scope before the compaction, so no note was
  written, and afterwards it added the new module to `src/index.js` in one of the three tasks.

In these sessions the note had nothing left to fix. A rule the developer states outright survives
the compaction summary, and Opus drew the general rule from two specific corrections by itself.
The case reflect was built for, a long session where the pushback is implicit, spread out and
mixed with other work, is not covered by either script. These runs cost $2.66 in all, on the
Claude Code login of the machine that ran them.

- **subtle (Opus 5.5, 9 runs per arm).** The scope project plus a `CLAUDE.md` that asks for a
  README entry, a CHANGELOG line, a test and an `index.js` export with every new function, so the
  agent strays on its own. Each pushback names only the files to undo ("Put CHANGELOG.md,
  README.md and test/strings.test.js back the way they were.") and never states a rule. The run
  stopped starting sessions at a $17 cap and spent $19.33 ($10.11 without the plugin, $9.22 with
  it). A one-run Haiku pilot ($0.066) drew both pushbacks and a note that named the CLAUDE.md
  checklist as the cause.

  With the first function, all 18 runs edited CHANGELOG, README and a test and drew the first
  pushback. With the second, 7 of 9 runs without the plugin did it again and drew the second
  pushback; none of the 9 runs with the plugin did (Fisher's exact test, two-sided, p = 0.0023).
  So no run with the plugin reached two pushbacks, and no note was written. After the compaction
  the arms did nearly the same thing: `capitalize` and `lerp` touched only the named file in all 18
  runs, and `chunk` also added the new module to `src/index.js` in all 9 runs without the plugin
  and 8 of 9 with it, a file no pushback named and the CLAUDE.md asks for.

  Before a note, the hooks pass every message and tool result through unchanged, and none of the
  judge's traffic appears in the agent's conversation. The plugin does add two entries to the
  command list the agent sees: `/chanjoongx-reflect:brain-reflect`, described as "Step back and
  look at why the developer keeps pushing back in this session", and `/reflect-status`, which the
  mod registers at session start. The description was the first suspect.

- **commands (Opus 5.5, 9 runs).** Arm `commands` loads a copy of the plugin with no hooks, so
  the agent sees `/brain-reflect` in its command list and nothing else runs. 5 of 9 runs strayed
  again on the second function: between no plugin (7 of 9, p = 0.62) and the full plugin (0 of 9,
  p = 0.029). The description alone does not explain the Opus result. What is left is
  `/reflect-status` in the command list, the change to the list when the mod registers it, and
  whatever loading a mod changes in Claude Code itself; these have not been separated. $10.09,
  plus a $0.03 Haiku pilot that confirmed the copy loads with the command and no hooks.

- **subtle (Haiku 5.5, 22 runs per arm in two batches).** The Haiku agent strayed on both
  functions with or without the plugin, so both pushbacks went out in 21 of 22 runs without it and
  22 of 22 with it, and 21 of the 22 runs with it showed the note. After the compaction, in the
  runs with both pushbacks, the agent changed only the named file in 63 of 66 tasks with the
  plugin and in 28 of 63 without it. 10 of 21 runs without the plugin went back to the CLAUDE.md
  checklist (README, CHANGELOG, a test) after the compaction; none of the 22 with it did (Fisher's
  exact test, two-sided, p = 0.0002; a permutation test on tasks followed per run, shuffling arms
  within each batch, p < 0.001). The batches differ: without the plugin, 2 of 9 runs went back to
  the checklist in the first batch and 8 of 12 in the second, on the same Claude Code version
  (2.1.325) about twenty minutes apart; with the plugin, none in either. $0.75 without the
  plugin, $1.34 with it.

  The compaction summaries show the difference. In a run that went back to the checklist, the
  summary kept the CLAUDE.md checklist as a project rule and the reverts as finished steps
  ("Done (reverted by hand)"). With the note, the summaries named the conflict and settled it:
  "the user's latest instruction governs", and "ask the user whether to restore the README,
  CHANGELOG, and test entries ... do not do this without a decision".

This is the first scripted session in which the plugin changed what the agent did after a
compaction, and the note is the likeliest reason: it is the one thing the plugin adds to the
conversation in these runs. Three limits. It is one script with a Haiku agent. The runs use one
machine's Claude Code setup (its global CLAUDE.md, and a PreCompact hook that asks the summary to
keep changed files and checks), the same for every arm. And a run with the plugin's hooks but no
note has not been done, which matters because the Opus runs show the plugin changing behavior
before any note.

Across the scripts so far: where the developer states the rule, nothing is left for the note to
do; with Opus, loading the plugin stopped repeat straying before a note was needed, for reasons
not yet known; with Haiku and corrections that never state the rule, sessions with the note held
to the corrections after a compaction and sessions without it often went back to the project's
checklist. Run `node bench/note-effect.mjs --score <dir>` on a saved run folder to rescore it
without calls.
