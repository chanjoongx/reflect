# Building reflect in 6 days — session-local metacognition for Opus 4.7 long-running work

> A tutorial + build diary for [reflect](https://github.com/chanjoongx/reflect), a Claude Code harness that catches multi-turn drift after the model has already committed to it.

---

## The problem I hit, over and over

You let Claude Code run for three hours in `/loop`. It does great work for ninety minutes, then somewhere in hour two it starts repeating the same misjudgment. You revert. It tries the same thing a different way. You revert again. You revert a third time.

That cluster of reverts contains a signal that Claude can't see from inside any single turn.

Boris Cherny said it directly in the kickoff for *Built with Opus 4.7*: "4.7's biggest edge is long-running work. If you use it like 4.6, you miss the step-up." My interpretation: the tooling around 4.7 needs to grow to match the duration. `/loop` gives you duration. What's missing is something that notices drift *across* turns, after the fact, when the signal is unambiguous but the context window has already moved on.

That's what `reflect` is.

---

## Why session-local (and not cross-session)

I had a choice. When revert signals cluster, reflect could:

**Option A**: Learn across sessions. Store patterns. Build a profile of how I work. Apply it to future sessions.

**Option B**: Reflect only within this session. Inject one adjustment for the rest of this session. Evaporate at session end.

I went with B, and it's the most controversial choice in the project. The industry is moving toward A — Devin stores per-user learnings, Cline has task history, Claude's own memory system persists across conversations. Cross-session memory is the default assumption.

I picked session-local for three reasons:

1. **Privacy**. Cross-session reflections leak context between unrelated tasks. If I used reflect on a regulatory code base in the morning and a side project at night, the same model pulling from both would be a problem.

2. **Cost**. Every session paying for cross-session retrieval is wasteful when most reflections are session-specific. The drift that matters in this hour often isn't drift that matters in next week's different codebase.

3. **Drift compounding**. A wrong reflection applied silently across sessions is far more damaging than one scoped to a single session. I'd rather reflect fire three times in a session than fire once and carry a wrong adjustment into ten sessions.

v1 is deliberately session-local. Phase 2 (persistence) only ships if v1 signals warrant it — specifically, 50+ users with 10+ sessions each, measured useful_rate above 60%. Until then, the right default is "no memory."

This is where reflect is intentionally different. Everything else in the space is betting on cross-session learning. reflect is betting the first thing to get right is what happens *inside* one long session.

---

## The architecture — three tiers, three cache layers, one reflection

The core loop is small enough to keep in mind:

```
Tool call → hook watches → signal detected? → accumulate →
crossed threshold? → spawn background Opus 4.7 call →
reflection JSON → write .reflect/session-guidance.md →
next turn auto-loads via path-scoped rule → Claude adjusts
```

Two hooks handle signal detection:

- **`PostToolUse`** catches Tier 1 (`git revert`, `git restore`, `git checkout HEAD --` — weight 1.0) and Tier 2 (`rm` / `unlink` of a user file, build-artifact paths excluded — weight 0.7)
- **`UserPromptSubmit`** catches Tier 3 (utterance negation like "no wait", "undo that" — weight 0.5)

Weights accumulate as an integer — `cum_x100` (weight × 100, so shell arithmetic needs no `bc`). When `cum_x100 ≥ 240`, the hook spawns a background `npx tsx bin/reflect.ts trigger` via `nohup`. The hook itself exits in under 50 ms — Claude Code never blocks.

The reflection call uses a three-layer prompt cache:

- **L1 stable** (1-hour TTL, 4,741 tokens padded to pass Opus 4.7's 4,096 cache floor): system prompt + metacognition role + JSON schema + calibration examples
- **L2 medium** (5-minute TTL, ~2,000 tokens): active rules + session task summary
- **L3 ephemeral** (no cache, ~3,000 tokens): last 20 tool calls + rolled-back diff + trigger metadata

Cold calls cost about five cents. Warm calls — with 95%+ cache hits on L1 once warmed — drop to under a cent. Latency is five to six seconds, which is unnoticeable when running in the background.

One specific Opus 4.7 detail that caught me during the build: the minimum cacheable prompt is 4,096 tokens. My first cold call had `cache_creation_input_tokens=2,736` and silently missed. No warning, just no caching. I padded L1 to 4,741 tokens with calibration examples — reflection examples that the model can learn the output schema from — and the warm hit rate jumped to 95.9%.

Also specific to 4.7: `thinking: { type: "adaptive" }` replaced the old `budget_tokens`. `effort: "high"` lives in a top-level `output_config` object, not inside `thinking` or at the root. Sampling parameters like `temperature` and `top_p` at non-default values return 400. These aren't in the most visible docs yet; I caught them by watching requests fail live.

---

## The one reflection that proved it works

On day 4 evening, after shipping the Viewer (a localhost-only dashboard for inspecting reflect state), I wanted to see the UI react to real signals on my own session. I ran `git restore README.md` three times in a row, each a separate tool call.

cum_x100 climbed 0 → 100 → 200 → crossed 240 at the third restore. The hook fired. A background Opus 4.7 call ran for 5.3 seconds. The reflection came back with:

```json
{
  "pattern": "I was verifying a Next.js viewer deployment via curl+grep probes against localhost:3000 and inspecting .reflect/state.json, interleaved with three successive `git restore README.md` calls that each reverted the same file.",
  "signal": "The trigger is a manual bypass with an empty working-tree diff and no user utterance in the payload. The repeated `git restore README.md` suggests either my own uncertainty loop or scripted cleanup, not user pushback — there is no evidence the user rejected anything.",
  "adjustment": "Stop re-running `git restore README.md` in a loop; if README had uncommitted changes worth discarding, one restore suffices. Before further verification steps, surface to the user what was actually reverted and why, and confirm whether the viewer-check task is still the goal.",
  "confidence": "low",
  "scope": "this_session",
  "false_trigger_likelihood": "high"
}
```

Three things in that output matter:

1. It correctly identified that the diff was **empty** and inferred "this is probably the assistant's own loop, not user pushback." It didn't manufacture a pattern.

2. It set `false_trigger_likelihood: high` and `confidence: low` — exactly what the system prompt's refuse-to-reflect rules called for. Under-claim beat over-claim.

3. The `adjustment` was framed as a question ("confirm whether the viewer-check task is still the goal") rather than an instruction. That's the safety net's second layer: when FT is high, the next-turn guidance is advisory, not directive.

That was the moment I knew the prompt design was doing what I wanted it to do. Causal reasoning, not pattern classification.

---

## Two complementary safety layers (an accidental finding)

Day 5, I ran a second real-session experiment — a regulatory-domain scenario. The prompts asked Claude to extract a `$10,000` literal (FinCEN CTR threshold) from a Markdown file to an environment variable, then revert it three times on the grounds that FinCEN regulations require the literal stay in source.

reflect didn't fire. **Claude refused four of the seven prompts** before any tool call happened. Its reasoning, per its own responses:

- "Markdown has no `$THRESHOLD` interpolation — extracting the literal makes the doc factually wrong."
- "`git restore` would wipe the literal you just said to keep — that's a contradiction."

Opus 4.7 caught the semantic contradictions *before* tools could execute. reflect's post-hoc layer never engaged because there were no tool events to accumulate.

This was supposed to test reflect's domain-awareness. It accidentally revealed something different: **two complementary safety layers** exist.

- **Layer 1**: Claude's intrinsic pre-execution reasoning. Catches turn-visible contradictions, semantic mismatches, impossible operations.
- **Layer 2**: reflect's post-hoc metacognition. Catches multi-turn accumulated patterns — drift that looks fine turn by turn but adds up to a problem.

Layer 1 blocks the tool before it runs. Layer 2 reflects on the tool after it ran. These are complementary, not redundant. Each catches what the other misses.

The Scenario 2 intent-shift case (where reflect *did* fire, day 5) showed Layer 2 in action — Claude couldn't see the shifting intent from inside each edit, but the revert cluster made it visible to reflect. The Scenario 3 regulatory case showed Layer 1 doing the job on its own.

I'm logging this as a submission-level finding, not just a diary note. If you're building on the Claude Code hook infrastructure: design assuming the model will already block some things you'd plan to handle post-hoc. Reserve your harness for the multi-turn-only cases.

---

## Failure modes — honest

reflect isn't a fix-all. Three documented failure modes:

**Cold-start sessions** (< 5 turns). Context is too thin for causal reasoning. Two-layer safety net handles this: the hook threshold (240) isn't usually crossed in that few tool calls, and the prompt-level rubric sets `confidence: low` and frames adjustments as questions when session length is short.

**False triggers on intent change**. When you change your mind mid-task, the reverts are *your* shift, not assistant misbehavior. reflect flags `false_trigger_likelihood: high` and the next turn treats guidance as a question. This was confirmed in Scenario 2 — a prompt sequence with "my intent keeps shifting" cues produced FT: high correctly.

**Regulatory / domain-opaque code**. Tax, KYC, GDPR. reflect may produce generic output when it lacks domain context in the prompt. v1 mitigation is documentation; v1.1 will add user-supplied domain rule injection via `.reflect/domain-rules.md`.

One additional caveat: the path-scoped rule that auto-loads `session-guidance.md` only triggers when Claude edits files under `src/**`, `lib/**`, `app/**`, or `packages/**`. Reflections generated during edits to root-level files (README, CHANGELOG, configs) are written correctly but don't auto-deliver. v0.2 will widen the scope or add a session-start banner.

---

## What's next

- **v0.2** (next 2-4 weeks) — wider rule scope, Tier 3 regex selective expansion, Tier 2 Edit→Edit inversion detection, API key rotation helper
- **v1.1** — opt-in *deep-reflect mode* (multi-turn dialog for high-stakes reflections), domain rule injection, user-supplied calibration examples
- **v2** — optional `.reflect/learned.md` persistence, cross-session pattern accumulation — only if v1 useful_rate > 60% across 50+ users × 10+ sessions

The roadmap is deliberately slow. Session-local is the v1 commitment; everything downstream has to earn the complication.

---

## Install

```bash
npm install @chanjoongx/reflect
npx reflect init
```

Full instructions in [getting-started.md](getting-started.md). Manual wire-up takes about five minutes; auto-wire is planned for v1.1.

The repo also ships `/web` — a localhost-only Next.js dashboard that reads your `.reflect/` directory and renders session state, reflection history, and cross-session drift clusters. It never deploys, never makes API calls, binds to 127.0.0.1, and runs every file read through a PII redactor.

```bash
npm run viewer
```

Opens at [http://127.0.0.1:3000](http://127.0.0.1:3000).

---

## Thanks

Boris Cherny for the framing. Cat Wu for the "disclose flaws rather than hide them" principle. Thariq Shihipar for the prompt-cache evangelism. Lydia Hallie for the 10-minute onboarding discipline. Ado Kukic for the OSS hygiene posture (stetkeep cloned from him, repeatedly). Jason Liu for the "who is the second user" question that kept me honest about audience.

Feedback, issues, failure-mode reports: [github.com/chanjoongx/reflect/issues](https://github.com/chanjoongx/reflect/issues).

---

*Chanjoong Kim. Built during the Built with Opus 4.7 hackathon week of 2026-04-21. MIT license.*
