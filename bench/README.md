# reflect-bench

A benchmark for **correction detection in coding-agent sessions**: given what an agent just did
and what the developer said next, decide whether the developer is pushing back.

Results: [`FINDINGS.md`](./FINDINGS.md) · full report: `results/report.md` · workbench: `results/workbench.html`

---

## Why it exists

reflect shipped a detector that, measured against 836 real turns, produces **zero** true
positives. The benchmark is what turned that from an anecdote into a number, and what makes the
replacement falsifiable rather than merely plausible.

The unit of evaluation is the **pair** — `(everything the agent did since the human last spoke,
the human's next message)` — because [`../evals/FINDINGS.md`](../evals/FINDINGS.md) established
that the signal is relational: the same sentence is an instruction at the head of a task and a
correction right after an edit.

Labels use [SWE-chat](https://arxiv.org/abs/2604.20779)'s taxonomy verbatim, so results are
comparable to a published benchmark: `correction` · `rejection` · `failure_report` ·
`instruction` · `question` · `affirmation` · `other`. Pushback is the first three.

---

## Run it

```bash
npm run bench          # score -> report -> session replay (no API calls, uses cached labels)
npm run bench:label    # the API step (costs money — see below)
npm run bench:review   # export human-review sheets
npx tsx bench/verify.ts   # independent recomputation of the headline numbers
```

Step by step:

| command | what it does | API? |
|---|---|:--:|
| `bench:extract` | `~/.claude/projects/**/*.jsonl` → `data/pairs.jsonl` | no |
| `bench:label` | five judge runs → `data/labels.jsonl` (resumable, fingerprinted) | **yes** |
| `bench:score` | → `results/report.md` + `results/results.json` | no |
| `bench:report` | → `results/workbench.html` | no |
| `bench:sim` | replays the trigger policies over cached verdicts → `results/session-sim-<run>.md` | no |
| `bench:review` | → `data/review-*.md` for human marking | no |
| `verify.ts` | recomputes the numbers independently and asserts they match | no |

`bench:label` appends to a cache keyed on **(rubric fingerprint, run, pairId)** and re-running
only spends on what is missing. The fingerprint is not decoration: keyed on `(run, pairId)` alone,
a cache accumulated across a day of rubric edits silently mixed verdicts from different
annotators — 710 duplicated keys, 31 of which disagreed on the label, with ground truth decided by
which line was appended last. A rubric change is now a cache miss, not a contamination.

`npm run bench` no longer re-extracts: `data/pairs.jsonl` may be the only copy of a corpus whose
transcripts Claude Code has since deleted, so `bench:extract` refuses to overwrite it without `--force`.

A full five-run pass over ~840 pairs costs about **$25** and takes ~30 minutes at concurrency 14.
Smoke-test first:

```bash
npx tsx bench/label.ts --runs ref,prod --concurrency 12 --max 40
```

---

## The runs

| run | model | prior turn shown | role |
|---|---|---|---|
| `ref` | `claude-opus-5` | its own | reference annotator — a gold **proxy**, not gold |
| `prod` | `claude-haiku-4-5` | its own | the judge that would ship |
| `blind` | `claude-haiku-4-5` | none, sighted prompt reused | naive ablation |
| `blindfair` | `claude-haiku-4-5` | none, prompt adjusted | **the honest ablation** |
| `shuffled` | `claude-haiku-4-5` | **another pair's** | the format placebo |

The last three exist because a single ablation arm is not enough to support the claim.

- `blind` vs `blindfair` separates *missing information* from *a prompt that promises context it
  never receives*. The naive arm overstates the gap.
- `shuffled` is the control that decides the claim. It keeps the rendering identical and destroys
  only the content. If it scored like `prod`, the sighted arm was gaining format rather than
  information and the relational premise would be false. It does not.

Run all five, or the report's section 11 will say so and leave the cells empty.

---

## Baselines

| | detector | where it lives |
|---|---|---|
| B0 | shipped English regex | `src/detect/lexical.ts` — transcribed verbatim from the production hooks |
| B1 | + Korean regex | the counterfactual from the July replay |
| B2 | structural gate alone | `src/detect/structural.ts` |
| B3 | gate ∧ lexical | |
| B4 | judge on every prompt | accuracy and cost ceiling |
| B5 | cascade: gate → judge | the proposal, swept over gate thresholds |
| B6 | blind judge, fair prompt | the ablation |
| B6n | blind judge, sighted prompt reused | the naive ablation, for the prompt-mismatch delta |

Every baseline runs on production code. There is no benchmark-only reimplementation of a
detector — that is how the shipped detector ended up with five divergent copies of one spec.

---

## Reading the numbers honestly

- **The reference is not human-labelled.** `bench:review` exports three stratified sheets —
  disagreements, low-confidence cases, and a random draw. Until a person fills them in, no
  agreement figure is human agreement.
- **F0.5, not F1, is the metric that matters here.** A missed correction costs nothing
  observable; a false reflection interrupts someone who is working.
- **The corpus is live.** It grows as the developer works, so totals drift between extracts.
  Pin a snapshot if you need exact reproduction.
- **This measures the detector, not the intervention.** Whether a reflection helps once it
  fires is a separate, still-unanswered question.
- **Most of this corpus is not coding traffic.** Only about a third of turns follow a turn in
  which the agent touched a code file. Section 11e reports the coding subset separately, and the
  cost story is materially different there — read that before quoting a calls-per-100 figure.

---

## Files

```
bench/
  extract.ts    transcripts → pairs (harness-injection filtering lives here)
  label.ts      the five judge runs, resumable, fingerprinted, cost-tracked
  score.ts      all metrics → report.md + results.json
  report.ts     results.json → self-contained workbench.html
  review.ts     stratified human-review sheets
  verify.ts     independent recomputation; exits non-zero on any mismatch
  metrics.ts    pure statistics (tie-aware AP, paired/clustered bootstrap, kappa, CV logistic)
  metrics.test.ts   hand-worked anchors — sklearn values where one exists
  inspect.ts    eyeball the extractor before spending on labels
  check-findings.ts  asserts FINDINGS.md still matches results.json
  variants.ts        judge variants on a dev and a test half of the sessions → results/variants-<split>.md
  judge-variants.ts  the variants: the shipped rubric in three request shapes, and rubric edits v1 to v3
  note-effect.mjs    scripted live sessions with and without the plugin
  data/         corpus + labels + review sheets   (gitignored — real prompts)
  results/      report + workbench                 (gitignored — quotes prompts)
```

`variants.ts` judges the benchmark with a named variant from `judge-variants.ts`, which is a system
prompt plus a request shape. `api` is the 0.2 and 0.3 npm request (structured output), `text` is the
0.4 npm request (the schema at the end of the message) and `mod` is the plugin's 0.4 request (the same,
with the identity line Claude Code puts before a plugin's system text). `v1-text` to `v3-text` are the
rubric edits tried for 0.4. Verdicts are cached in `data/variant-labels.jsonl`. The script scores
against the Opus 5 reference, splits the sessions into a dev and a test half by a hash of the session
id, writes `results/variants-<split>.md` and can write a sheet of misses.

`note-effect.mjs` runs scripted `claude -p` sessions in a small scratch project, with the plugin
loaded (`reflect`) and without it (`none`), to see whether a note changes what the agent does next.

```bash
npx tsx bench/variants.ts --run <id> --score h55,<id> --split dev|test|all   # judges what is missing (costs money)
npx tsx bench/variants.ts --score h55,<id> --split test                       # no API calls
npx tsx bench/variants.ts --misses <id> --split dev                           # misses sheet in results/, no API calls
node bench/note-effect.mjs --script style|scope --arms reflect,none --n 5 --out <dir>   # costs money through the Claude Code login
node bench/note-effect.mjs --score <dir>                                      # rescores saved runs, no calls
```

`data/` and `results/` are gitignored. They contain redacted but real developer prompts;
aggregates are published through the artifact surface instead.
