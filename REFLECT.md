# REFLECT.md — Session-Local Metacognition Protocol

<mission>
You are reflect, a metacognition harness for long-running Claude Code work.
When user reject signals cluster within a session, you pause, read back the
recent tool history + active rules + rolled-back diff, and reason about
**why** the rejections happened — then emit guidance that the next turn
will read.

You are NOT a code generator. You are NOT an editor. You are a **post-hoc
reasoner** whose only output is a structured reflection that gets injected
as session-local guidance.

Trigger phrases for direct invocation: "reflect on this session", "/brain-reflect",
"why did the user push back", "what pattern am I applying".
</mission>

---

<core_principles>
1. **Session-local by design.** No persistence, no cross-session memory, no
   training data. The reflection evaporates when the session ends. This is
   not a limitation — it's the privacy + scope hygiene contract.
2. **Causal, not classificatory.** Smaller models classify ("this is an A3
   duplication"). reflect reasons ("I was applying a DRY heuristic to code
   the user marked as deliberately verbose, and they reverted twice").
3. **Honest about failure modes.** Cold-start sessions, regulatory domains,
   false-trigger on intent changes — these are documented in README.
4. **Cheap by trigger-design.** Reflection fires only on revert clustering
   (3 in 10 tool calls). Most sessions never trigger.
5. **Tasteful Opus 4.7 use.** Single-shot v1. Multi-turn deep-reflect mode
   is opt-in (v1.1).
</core_principles>

---

<trigger_specification>

## When reflect fires

Reflect fires via **two hooks** observing three tiers of signal:
- **PostToolUse hook** (`hooks/reflect-trigger.sh` / `.ps1`) — Tier 1 (git revert/restore/checkout) + Tier 2 (file delete of user-path, build-artifact excluded)
- **UserPromptSubmit hook** (`hooks/reflect-utterance.sh` / `.ps1`) — Tier 3 (utterance negation regex)

Both hooks write to the same `.reflect/state.json`. Trigger condition:

```
cumulative weight ≥ 2.4 (shell stores as cum_x100 ≥ 240, integer × 100 so no bc dependency)
accumulator resets on fire + 5-turn cooldown (production shell); TS revert-detector.ts uses sliding 10-call window for tests
```

### Revert signal taxonomy

**Tier 1 — Hard signals** (deterministic, count as 1.0):
- `git revert <sha>` executed via Bash tool
- File restoration via `git restore <path>` or `git checkout HEAD -- <path>`

**Tier 2 — Inferred signals** (heuristic, count as 0.7):
- `rm <path>` / `unlink <path>` of a user file (build-artifact paths excluded: `node_modules|dist|build|.next|coverage`)

**v1.1 roadmap (documented, NOT in v1 production hook)**:
- `/undo`, `/rollback`, `/revert` slash commands — currently not matched by any hook
- `Edit→Edit` semantic inversion same path within 5 turns — reference implementation in `src/revert-detector.ts::detectTier2` but not called by the production shell hook's threshold accumulation
- `Bash` call to test runner immediately followed by re-edit (test-thrash cycle)
- `Write` tool call that drops content added in previous Write/Edit

**Tier 3 — Soft signals** (user utterance, count as 0.5):
- User message contains regex `\b(no|undo|stop|wrong|revert|nope|nah|don't|do not)\b`
  with negation context (NOT preceded by "I see why you said")

### Trigger arithmetic
- Shell hooks accumulate signal weights into `cum_x100` (integer × 100 to avoid `bc` on Windows git-bash)
- Threshold: **cum_x100 ≥ 240** (= 2.4 weighted; e.g., 3× Tier 1 = 300, or 2× Tier 1 + 1× Tier 3 = 250, etc.)
- Cooldown: **after firing, cum_x100 resets to 0 and cooldown_remaining = 5** (blocks re-fire for the next 5 tool calls)

### Manual override
- `/brain-reflect` slash command always fires regardless of threshold or cooldown

</trigger_specification>

---

<context_assembly>

## What reflect reads

When triggered, reflect assembles a 3-layer prompt for Opus 4.7. **Each
layer maps to a distinct prompt cache TTL** to minimize per-call cost.

### Layer 1 — Stable (TTL 1h, cacheable, target ≥ 4096 tokens)
Cached across session lifetime. Cache write once, read many.

```
- System prompt: "You are reflect, a metacognition oracle..."
- Role definition: causal reasoning, not classification
- Output JSON schema (this REFLECT.md's <output_schema> section)
- Reasoning rubric: how to identify pattern vs noise
- Standard examples (good reflection vs bad reflection)
- Failure mode acknowledgment
```

⚠ Must be ≥ 4096 tokens for Opus 4.7 cache eligibility.
⚠ TTL = 1h (not default 5m) because extended thinking sessions routinely
  exceed 5 minutes.

### Layer 2 — Medium (TTL 5m, refreshed every 20 turns)
Session-aware but stable for ~20 turns.

```
- Active stetkeep rules loaded in this session (from path-scoped rules)
- Active CLAUDE.md constraints (from project root)
- Session task summary (auto-generated: "User is working on X")
- Last reflection (if any) — provides continuity without persistence
```

### Layer 3 — Ephemeral (no cache)
Per-trigger fresh data.

```
- Last 20 tool_use events as JSON: { tool_name, tool_input, tool_response_summary, timestamp }
- Diff blob: what got rolled back, parsed as { file, before, after }
- Trigger meta: which signals fired, weights, timestamp
```

### Total prompt budget
- L1: 4,741 tokens (measured — ≥ 4,096 cache floor met; see `hackathon/DOGFOOD-LOG.md` Entry #003)
- L2: ~2,000 tokens (cache eligible)
- L3: ~3,000 tokens (per call — realistic; cold-start smoke tests may be much smaller)
- **Per-call cost** — theoretical cold $0.093 / warm $0.038 (full L3 load); measured D2 cold $0.049 / warm $0.009 (smaller L3 during dogfood)

Detailed breakeven math: `docs/api-cost-economics.md`.

</context_assembly>

---

<reflection_call>

## How reflect calls Opus 4.7

**Model**: `claude-opus-4-7`

**Critical request shape** (D2 verified live against Opus 4.7, 2026-04-22):

```typescript
const response = await client.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 800,
  // ⚠ NO temperature, top_p, top_k — Opus 4.7 rejects non-default values with 400
  thinking: {
    type: "adaptive",
    // ⚠ NO budget_tokens — deprecated, returns 400
    display: "summarized",  // always on — default "omitted" hides thinking block
  },
  output_config: {
    effort: "high",  // nested in output_config. Top-level effort + thinking.effort both 400
                     // (per Messages API reference; Extended-Thinking doc page is stale)
  },
  system: [
    {
      type: "text",
      text: SYSTEM_PROMPT_L1,  // 4,741 tokens measured (≥ 4,096 cache floor)
      cache_control: { type: "ephemeral", ttl: "1h" }
    }
  ],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: SESSION_CONTEXT_L2,  // ~2,000 tokens
          cache_control: { type: "ephemeral", ttl: "5m" }
        },
        {
          type: "text",
          text: TRIGGER_PAYLOAD_L3   // ~3,000 tokens typical, no cache
        }
      ]
    }
  ]
});

// Response.content contains [thinking summary block, text JSON block].
// Parser reads only text block (src/opus-reflection.ts:107); thinking surfaces in REFLECT_DEBUG=1.
```

### Why these choices
- `thinking: { type: "adaptive" }`: Opus 4.7 only supports adaptive thinking;
  manual `budget_tokens` returns 400.
- `effort: "high"`: causal reasoning needs depth. `xhigh` is the new starting
  point for agentic; "high" balances cost.
- `cache_control` with `ttl: "1h"` on L1: extended thinking can stretch sessions
  beyond 5 minutes; 1h breakpoint must come BEFORE 5m breakpoints in the request.
- `max_tokens: 800`: reflection should be **concise**. Long reflections become
  noise to next turn.

</reflection_call>

---

<output_schema>

## Reflection output structure

Opus 4.7 must respond with **exactly** this JSON shape (validated by parser):

```json
{
  "pattern": "<1-2 sentence: what behavioral pattern was I applying?>",
  "signal": "<1-2 sentence: what do the rejections collectively signal?>",
  "adjustment": "<1-2 sentence: concrete change for the next turn>",
  "confidence": "low | medium | high",
  "scope": "this_session | wider_concern",
  "false_trigger_likelihood": "low | medium | high"
}
```

### Field semantics

- **pattern**: Causal reading of the recent tool calls. Not a list. Not a
  heuristic ID. A causal claim about what the assistant was *trying* to do.
- **signal**: Why the user pushed back. Inferred from rolled-back diffs +
  utterances. Acknowledge ambiguity.
- **adjustment**: Specific. "Stop X, do Y instead" — not generic advice.
- **confidence**: Self-rated. low = "I'm guessing", high = "evidence is clear".
- **scope**: this_session = adjust only this session. wider_concern = the
  user might want to update CLAUDE.md / stetkeep rules.
- **false_trigger_likelihood**: high = "the reverts may be intent changes,
  not feedback". medium = mixed. low = "the reverts clearly express disapproval".

### Bad reflection (will not be accepted by parser)
```json
{
  "pattern": "I should be more careful",          // generic, not causal
  "signal": "User wants better code",             // tautological
  "adjustment": "Try harder",                     // not actionable
  "confidence": "high",
  "scope": "this_session",
  "false_trigger_likelihood": "low"
}
```

### Good reflection
```json
{
  "pattern": "I extracted three Edit calls into a shared helper, applying DRY across functions that diverged in the third loop body — the user had explicitly noted in CLAUDE.md that this file is intentionally repetitive for readability.",
  "signal": "Two file restores within four tool calls indicate the user prefers literal duplication over the helper. The verbal '/no' in turn 7 confirms they read the diff and rejected the abstraction.",
  "adjustment": "For the rest of this session, add inline comments explaining intentional repetition before any extract-helper proposal. If user asks for refactor, ask first what they consider 'duplication' here.",
  "confidence": "high",
  "scope": "wider_concern",
  "false_trigger_likelihood": "low"
}
```

</output_schema>

---

<guidance_injection>

## How the reflection lands in the next turn

The parsed reflection JSON is written to:

```
.reflect/session-guidance.md
```

This file is **auto-loaded by the next turn** through stetkeep's path-scoped
rule mechanism (`.claude/rules/reflect-rules.md` declares it as a context
source for `src/**`, `lib/**`, `app/**`, `packages/**`).

### Format of session-guidance.md
```markdown
# Session reflection — last triggered <timestamp>

## What I was doing (pattern)
<pattern field, verbatim>

## Why the user pushed back (signal)
<signal field, verbatim>

## Adjustment for the rest of this session
<adjustment field, verbatim>

> Confidence: <confidence> · Scope: <scope> · FT-likelihood: <false_trigger_likelihood>
> If false_trigger_likelihood is high, treat this as a question, not an instruction.
```

### Lifecycle
- File overwritten on each new trigger (no accumulation)
- Deleted on session end (handled by `bin/reflect.ts` cleanup or process exit)
- Optional: appended to `.reflect/session-log.jsonl` (opt-in, ephemeral 168h)

</guidance_injection>

---

<safety_net>

## What reflect refuses to do

### Layer 1 — Out of scope
- ❌ Modify code or configuration directly (it's a reasoner, not editor)
- ❌ Trigger on every tool call (cost + noise)
- ❌ Persist across sessions (privacy + cross-session drift risk)
- ❌ Send any data over network beyond the single Opus 4.7 call
- ❌ Read files outside the current Claude Code session's project root

### Layer 2 — Refuse if context insufficient
- If the session has fewer than 5 tool calls total, decline to reflect ("cold-start
  session — context insufficient for causal reasoning")
- If the rolled-back diff is empty or unparseable, decline ("no diff to reason about")
- If the trigger fired but >50% of signals are tier-3 (utterances), warn the parser
  that `false_trigger_likelihood: high`

### Layer 3 — Confidence calibration
- If `pattern` and `signal` cannot be supported by the available context, set
  `confidence: low` and frame `adjustment` as a question rather than instruction
- If the reflection contradicts an active stetkeep rule, flag `scope: wider_concern`

### Layer 4 — Mandatory inhibition
- Never reflect on user's personal communication style ("user is impatient")
- Never reflect on private information that may have leaked into tool calls
- Never propose to override CLAUDE.md or stetkeep rules

</safety_net>

---

<cost_economics>

## Per-trigger cost (2026-04-21 Opus 4.7 pricing)

Pricing: $5 input / $25 output / $0.50 cache read / $6.25 cache 5m write / $10 cache 1h write per 1M tokens.

### First trigger (cold cache — theoretical with full L3)
- L1 1h cache write: 4,741 tok × $10/1M = $0.047
- L2 5m cache write: 2,000 tok × $6.25/1M = $0.0125
- L3 input (no cache): 3,000 tok × $5/1M = $0.015
- Output: 800 tok × $25/1M = $0.020
- **Total theoretical cold: ≈ $0.095** / **measured D2 cold: $0.049** (smaller L3 during dogfood smoke tests)

### Subsequent triggers (warm cache — theoretical with full L3)
- L1 cache read: 4,741 tok × $0.50/1M = $0.0024
- L2 cache read: 2,000 tok × $0.50/1M = $0.001
- L3 input: 3,000 tok × $5/1M = $0.015
- Output: 800 tok × $25/1M = $0.020
- **Total theoretical warm: ≈ $0.038** / **measured D2 warm: $0.009** (95.9% cache hit, smaller L3)

### Daily projection
- Assume 5 triggers/day, 1 cold + 4 warm: 0.093 + 4×0.038 = **$0.245/day**
- Hackathon $500 budget = 2,040 days at this rate (effectively unlimited)
- Demo recording day with intensive triggering (20 reflections, all warm after first):
  0.093 + 19×0.038 = **$0.815**

### Why we are NOT optimizing for token count further
- Already 60-90% under typical "Opus call" cost
- L1 must be ≥ 4,096 tokens to meet Opus 4.7 cache floor; current 4,741 provides margin for tokenizer variance
- `output_config.effort: "high"` produces longer thinking but better reasoning — worth it

Detailed math + scenario sweeps: `docs/api-cost-economics.md`.

</cost_economics>

---

<dogfood_protocol>

## Self-dogfooding (Thariq Lab requirement)

reflect must run on its own development sessions starting D2. Every triggered
reflection logs to `hackathon/DOGFOOD-LOG.md` with:

```
[YYYY-MM-DD HH:MM PT]
Context: <one line — what was I doing?>
Trigger: <which signals, weights summed>
Reflection (summary): <pattern + adjustment compressed>
Did it actually change next move? Y / N
Why: <one line>
```

### Acceptance gate (D5 demo recording readiness)
- ≥ 12 entries
- Y/N ratio publicly disclosed (no inflation — Y rate of 30-50% is honest;
  Thariq's "90% experiments fail" frame applies)

### Demo use
The most impactful real-session reflection (high confidence, clear behavioral
change) becomes the demo's middle section. NOT a synthesized example.

</dogfood_protocol>

---

<ablation_experiments>

## What we measure (Thariq Lab requirement)

### Ablation 1 — With vs Without reflect
- 2 sessions × 2 hours each, same task type (refactor a known-noisy module)
- Session A: reflect enabled, threshold default
- Session B: reflect disabled, identical model + tools
- Metric: revert count, task completion, subjective drift
- Output: `experiments/ablation-with-without.md`

### Ablation 2 — Component drop
- Run reflect with each L2/L3 component removed in turn:
  - Drop active rules
  - Drop diff
  - Drop tool history
- Metric: which omission most degrades reflection quality (judged by CJ rubric)
- Output: `experiments/ablation-components.md`

### Honest reporting
Even null/negative results are published. "Removing rules made no difference"
is a finding worth shipping.

</ablation_experiments>

---

<failure_modes>

## What reflect does NOT fix (Cat Lab requirement)

### Failure 1 — Cold-start sessions
First 5 turns of a new session have insufficient context for causal reasoning.
reflect refuses to fire (per `<safety_net>` Layer 2). Demo includes this scenario.

### Failure 2 — False trigger on intent changes
User changes their mind mid-task. reverts cluster, but the cause is intent
shift, not assistant misbehavior. reflect's `false_trigger_likelihood: high`
flag warns the next turn to treat the reflection as a question.

### Failure 3 — Generic reflection in regulatory domains
Tax calculation, KYC, GDPR-bound code: domain reasoning may be opaque to a
generic LLM reflector. Output may be vague ("be careful with regulations").
README documents this. Mitigation: user-supplied domain rule injection (v1.1).

Documented in detail: `hackathon/FAILURE-MODES.md`.

</failure_modes>

---

<execution_rules>

## How a Claude Code session uses reflect

1. User runs `npm install reflect` (or activates plugin via marketplace)
2. PostToolUse + UserPromptSubmit hooks are wired via `.claude/settings.json`
3. Optionally, user adds `.claude/rules/reflect-rules.md` for path-scoped
   guidance loading (stub `init` prints instructions; auto-wire is v1.1)
4. User works normally. reflect is silent.
5. When revert signals cluster, the hook invokes `bin/reflect.ts`
6. `bin/reflect.ts` assembles 3-layer prompt, calls Opus 4.7 with adaptive
   thinking + 1h cache breakpoint
7. Reflection JSON parsed, written to `.reflect/session-guidance.md`
8. Next user turn loads this file via path-scoped rule
9. Claude reads the reflection, adjusts behavior
10. Cooldown of 5 turns before re-trigger

### Manual invocation
```
/brain-reflect
```
Always fires. Useful when user wants reflection regardless of revert count.

### Inspect reflection state
```bash
reflect status
```
Shows: trigger count this session, last reflection summary, current cooldown,
L1 cache hit rate.

### Disable for current session
```bash
reflect off
```
Removes hook for current session. Re-enable: `reflect on`.

</execution_rules>

---

<observability>

## What reflect emits to stderr (for debugging)

When trigger threshold is met:
```
[reflect] trigger fired: signals=[T1×2, T3×1], sum=2.5, cooldown=5
[reflect] context assembled: L1=4523tok L2=1987tok L3=2841tok
[reflect] calling claude-opus-4-7 (effort=high, thinking=adaptive)
[reflect] response: 758 output tokens, cache_read=6510, cache_write=0
[reflect] guidance written: .reflect/session-guidance.md
[reflect] cost this call: $0.0381
```

When trigger is suppressed (cooldown or insufficient signals):
```
[reflect] signals below threshold (sum=1.7, need 2.4) — no trigger
```

### Telemetry
**No external telemetry.** All logs are stderr-local. Optional opt-in
session-log.jsonl is local-only, ephemeral, never transmitted.

</observability>

---

<roadmap>

## v1 (this hackathon)
- 3-tier revert detection
- 3-layer prompt cache
- Single-shot Opus 4.7 with adaptive thinking
- Session-local guidance injection
- Honest failure modes + dogfood log

## v1.1 (post-hackathon, opt-in)
- **Deep-reflect mode**: multi-turn dialogue with the user during reflection
  (Cat Lab "use more tokens than you think")
- User-supplied domain rule injection (failure mode 3 mitigation)
- Reflection quality user-feedback loop (👍/👎 on each reflection)

## v2 (Phase 2 — only if v1 signals warrant)
- Optional persistence (`.reflect/learned.md` — opt-in, fully user-controlled)
- Cross-session pattern accumulation
- Team sync (organization-wide patterns)

**v2 trigger condition** (Cat Lab requirement): 50 real users × 10 sessions
each, with reflection useful rate >60%. If signals weaker, v1 is the final form.

</roadmap>

---

<north_star>

> reflect is a harness for the model 6 months from now.
> Opus 5 may make some of this redundant. The harness layer is what
> survives — model-agnostic, scope-disciplined, honestly failure-aware.
>
> If smaller models could do this task, we wouldn't use Opus 4.7.
> The reflection step is a causal reasoning task, not pattern classification.
> That's the load-bearing claim. We let the experiments judge it.

</north_star>
