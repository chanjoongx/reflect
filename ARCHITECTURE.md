# ARCHITECTURE.md — How reflect works

> Honest technical reference. Every behavioral claim maps to a real
> Claude Code mechanism (hook, rule, slash command) or a real Opus 4.7
> API call. The metacognition framing is mnemonic; the implementation
> is harness + single-shot LLM call.

---

## 1. The two layers

```
┌────────────────────────────────────────────────────────────────────┐
│  HARNESS LAYER (model-agnostic, survives model upgrades)           │
│                                                                    │
│  • Revert signal detection (3-tier taxonomy)                       │
│  • Threshold + cooldown logic                                      │
│  • Context assembly (3-layer cache plan)                           │
│  • Guidance injection (filesystem write, path-scoped rule trigger) │
│                                                                    │
│  Implementation: TypeScript, no external deps beyond @anthropic-ai/sdk │
└────────────────────────────────────────────────────────────────────┘
                                ↓
┌────────────────────────────────────────────────────────────────────┐
│  MODEL LAYER (currently Opus 4.7, swappable)                       │
│                                                                    │
│  • Causal reasoning over assembled context                         │
│  • Adaptive thinking (effort: high)                                │
│  • Structured JSON output (validated by parser)                    │
│                                                                    │
│  Implementation: claude-opus-4-7 via Messages API                  │
└────────────────────────────────────────────────────────────────────┘
```

The harness is the **6-month-survival layer**. If Opus 5 ships in 2026-Q4
and reduces over-refactoring directly, the harness still earns its place —
the trigger + injection + cache patterns are not model-dependent.

---

## 2. End-to-end signal flow

```mermaid
sequenceDiagram
    participant User
    participant CC as Claude Code
    participant Hook as PostToolUse Hook
    participant Reflect as reflect-trigger.sh
    participant Core as opus-reflection.ts
    participant API as Opus 4.7 API
    participant Inject as guidance-injector.ts
    participant Rule as Path-scoped Rule

    User->>CC: ask for refactor
    CC->>CC: Edit, Edit, Edit
    User->>CC: revert (git restore)
    CC->>Hook: PostToolUse(tool_name=Bash)
    Hook->>Reflect: stdin JSON
    Reflect->>Reflect: increment signal count
    Reflect-->>CC: exit 0 (no block)
    CC->>CC: Edit (try again)
    User->>CC: revert
    CC->>Hook: PostToolUse(tool_name=Bash)
    Hook->>Reflect: stdin JSON
    Reflect->>Reflect: signal sum >= 2.4
    Reflect->>Core: invoke trigger handler
    Core->>Core: assemble 3-layer prompt (L1+L2 cached)
    Core->>API: messages.create(model=claude-opus-4-7, thinking=adaptive)
    API-->>Core: { pattern, signal, adjustment, confidence, ... }
    Core->>Inject: parsed reflection
    Inject->>Inject: write .reflect/session-guidance.md
    Inject-->>CC: hookSpecificOutput.additionalContext (optional)
    User->>CC: next request
    CC->>Rule: load .claude/rules/reflect-rules.md (path-scoped)
    Rule->>CC: includes session-guidance.md content
    CC->>User: response (now informed by reflection)
```

---

## 3. Why PostToolUse, not PreToolUse

| Hook | When | Use case |
|---|---|---|
| **PreToolUse** | Before tool runs | Block / ask / allow (e.g., stetkeep safety-net) |
| **PostToolUse** | After tool returns | Observe / log / inject context |

reflect is **observational** — it cannot block actions retroactively.
PostToolUse fits because:
1. Revert signals (`git restore`, `Edit` inversions) only become observable
   after the tool runs
2. We don't want to block — we want to *learn* from clustering
3. PostToolUse can return `additionalContext` that lands in next-turn context
4. Out-of-process — the hook process can't slow down Claude's loop

stetkeep is the PreToolUse layer (prevention). reflect is the PostToolUse
layer (reasoning). Intentional separation, not redundancy.

---

## 4. The 3-tier revert signal taxonomy

| Tier | Mechanism | Weight | Examples |
|---|---|---|---|
| **1 (hard)** | Deterministic file/git operation | 1.0 | `git revert`, `git restore`, `/undo`, file delete |
| **2 (inferred)** | Diff-based heuristic | 0.7 | Edit→Edit semantic inversion, test→edit→test→edit cycle |
| **3 (soft)** | User utterance | 0.5 | regex match for negation in user message |

**Trigger**: sum of weights in last 10 tool calls ≥ **2.4**.
**Cooldown**: 5 turns post-fire.

Why these weights:
- Tier 1 is unambiguous → full weight
- Tier 2 has false positive risk (semantic inversion is heuristic) → partial
- Tier 3 has highest false-positive risk (utterance ambiguity) → smallest

Why threshold 2.4 (not 3):
- 3× tier-1 = 3.0 (clear trigger)
- 2× tier-1 + 1× tier-3 = 2.5 (also triggers — strong signal)
- 1× tier-1 + 2× tier-3 = 2.0 (does not trigger — too soft)
- All-tier-3 (3 utterances) = 1.5 (does not trigger — utterance noise)

Tunable via env var `REFLECT_TRIGGER_THRESHOLD`.

---

## 5. The 3-layer prompt cache plan

Anthropic prompt cache (2026-04 spec):
- TTL options: 5m (default) or 1h
- Min cacheable for Opus 4.7: **4,096 tokens** (not 1,024)
- Max 4 explicit breakpoints per request
- Hierarchy: tools → system → messages
- 1h breakpoints must come **before** 5m breakpoints

Our layer plan:

```
┌───────── L1 STABLE (TTL 1h, ≥4096 tok) ────────┐
│ • System prompt: "You are reflect..."           │
│ • Role definition                               │
│ • Output JSON schema                            │
│ • Reasoning rubric                              │
│ • Reflection examples (good / bad)              │
│ Cached for ENTIRE session                       │  ← cache_control breakpoint #1 (1h)
└──────────────────────────────────────────────────┘

┌───────── L2 MEDIUM (TTL 5m, ~2000 tok) ────────┐
│ • Active stetkeep rules                         │
│ • Active CLAUDE.md constraints                  │
│ • Session task summary (refreshed every 20 turns)│  ← cache_control breakpoint #2 (5m)
│ • Last reflection (continuity, no persist)      │
└──────────────────────────────────────────────────┘

┌───────── L3 EPHEMERAL (no cache, ~3000 tok) ───┐
│ • Last 20 tool_use events as JSON               │
│ • Rolled-back diff blob                         │
│ • Trigger meta (signals, weights, timestamp)    │
└──────────────────────────────────────────────────┘
```

### Why 1h on L1
- Default 5m insufficient: extended thinking sessions easily exceed 5 minutes
- 1h write costs 2× input ($10/MTok) but reads at 0.1× ($0.50/MTok)
- Break-even: ~2 reads to amortize 1h write
- Typical session triggers ≥3 times — easy ROI

### Cost per trigger
- Cold (first call): ≈ $0.093
- Warm (subsequent): ≈ $0.038

Math: [`docs/api-cost-economics.md`](docs/api-cost-economics.md).

---

## 6. Why adaptive thinking + effort: high

Opus 4.7 changed the thinking API:
- ❌ `thinking: { budget_tokens: N }` — deprecated, returns 400
- ✅ `thinking: { type: "adaptive" }` — model decides depth
- ✅ `effort: "low" | "medium" | "high" | "xhigh" | "max"` — request-level intensity

For reflection:
- `effort: "high"` balances reasoning depth vs cost
- `effort: "xhigh"` is the new starting point for "coding/agentic" — we evaluate
  in ablations whether the marginal cost is justified for our task

Note: thinking content is **omitted by default** in the response. To inspect
during debugging, pass `display: "summarized"`. We don't need it in production
(only the structured JSON matters).

---

## 7. Why no temperature / top_p / top_k

Opus 4.7 rejects non-default sampling parameters with 400 errors. This is
intentional — Anthropic recommends prompt-based control instead.

For reflect, this is fine:
- Reflection should be **deterministic-ish** (same context → similar output)
- Default sampling is calibrated for adaptive thinking
- Prompt structure (the JSON schema constraint) provides enough determinism

If we ever need diversity (e.g., generate multiple candidate reflections),
we'd multi-call rather than tune sampling.

---

## 8. Path-scoped rule injection

Claude Code's `.claude/rules/*.md` files with `paths:` frontmatter auto-load
when Claude reads matching files. We piggyback this:

```markdown
---
paths:
  - "src/**/*.{ts,tsx,js,jsx,mjs,cjs}"
  - "lib/**/*.ts"
  - "app/**/*.tsx"
---

# reflect Session Guidance

The most recent reflection in this session is below. If
`.reflect/session-guidance.md` exists, treat its contents as
authoritative for the rest of this session.

<!-- session-guidance.md content auto-loaded by reflect when present -->
```

Mechanism reuse:
- We don't invent a new context-injection primitive
- We use stetkeep's path-scoped rule pattern (same as CRAFT/PERF rules)
- The reflection lands when the user works on code (which is when it matters)

---

## 9. Subagent option (deferred to v1.1)

Currently reflect makes a **single Messages API call**. For v1.1, we evaluate
delegating to a Claude Managed Agent:

| Aspect | Single-shot Messages | Managed Agent |
|---|---|---|
| Cost (per call) | $0.04 (cached) | $0.04 + $0.08/session-hour |
| Latency | 2-5s | 5-15s (cold start) |
| State management | None (we handle) | Session log + checkpointing |
| Multi-turn | No | Yes (could ask user follow-up) |
| Fit for v1 | ✅ | Overhead unjustified |

Decision: stay with Messages API for v1. Re-evaluate after D3 Michael Cohen
session at hackathon. If v1.1 ships deep-reflect mode (multi-turn), Managed
Agents become attractive.

---

## 10. Storage layout in user's project

```
user-project/
├── .claude/
│   ├── settings.json       # PostToolUse hook wired here
│   └── rules/
│       └── reflect-rules.md  # path-scoped, auto-loaded
│
├── .reflect/               # ⭐ ephemeral, gitignored
│   ├── session-guidance.md # current reflection (overwritten on trigger)
│   └── session-log.jsonl   # opt-in, 168h auto-deleted
│
└── .env                    # ANTHROPIC_API_KEY
```

We refuse to write anywhere else. No cache in `~/.cache`. No telemetry.

---

## 11. Failure modes & graceful degradation

| Scenario | Behavior |
|---|---|
| `ANTHROPIC_API_KEY` missing | Hook exits 0 silently; logs to stderr |
| API call fails (network / rate limit) | Single retry with 1s backoff, then silent skip |
| Response not valid JSON | Parser logs error, no guidance written, no exception |
| Cold-start (< 5 tool calls in session) | Trigger refuses, logs "context insufficient" |
| Cache miss on L1/L2 | Re-write transparently, cost goes up for one call |
| `.reflect/` directory unwritable | Log error to stderr, no guidance file created |
| User sets `REFLECT_DISABLED=1` | Hook exits 0 immediately |

**Hooks fail open.** Never block the user's tool from running.

---

## 12. Validation — how to verify reflect works

```bash
# 1. Hook executes correctly
echo '{
  "tool_name":"Bash",
  "tool_input":{"command":"git restore src/foo.ts"},
  "tool_response":{"output":""}
}' | bash hooks/reflect-trigger.sh
# Expected (after enough signals): JSON with hookSpecificOutput

# 2. Manual trigger
npx reflect manual
# Expected: reads session state, calls API, writes guidance

# 3. Check guidance
cat .reflect/session-guidance.md
# Expected: pattern / signal / adjustment

# 4. Cache hit verification
REFLECT_DEBUG=1 npx reflect manual
# Expected stderr: cache_read=6510 (or similar), cost=$0.038

# 5. Cooldown verification
REFLECT_DEBUG=1 npx reflect manual  # immediately after #4
# Expected stderr: "in cooldown, 4 turns remaining"
```

---

## 13. What this is NOT

- **Not a fix-all** — adjustment is a hypothesis, not a guarantee
- **Not Anthropic-affiliated** — independent open source
- **Not a replacement for code review** — it's a reasoning vector
- **Not collecting data** — read [`PRIVACY.md`](PRIVACY.md)
- **Not measured at scale yet** — ablations in [`experiments/`](experiments/),
  full benchmark deferred to post-hackathon

---

## 14. Related work

- **stetkeep** ([github.com/chanjoongx/stetkeep](https://github.com/chanjoongx/stetkeep)) — PreToolUse safety net, false-positive catalog (CJ's prior work, base dep)
- **TDD-Guard** ([nizos/tdd-guard](https://github.com/nizos/tdd-guard)) — closest mechanical pattern (separate Claude session for hook decisions). Different domain (TDD vs general metacognition)
- **Cline** ([saoudrizwan/claude-dev](https://github.com/saoudrizwan/claude-dev)) — checkpoint timeline. Different mechanism (storage vs reflection)
- **Aider** ([Aider-AI/aider](https://github.com/Aider-AI/aider)) — `/undo` + repo-map. Different mode (chat vs hook)
- **Reflexion** (Shinn et al., 2023) — academic verbal-reflection pattern. Inspirational, not operational
- **Anthropic Auto mode** ([blog](https://claude.com/blog/auto-mode)) — permission delegation. Composes with reflect (auto enables duration; reflect catches drift)

---

## 15. Further reading

- [`REFLECT.md`](REFLECT.md) — protocol spec, XML-tagged
- [`docs/getting-started.md`](docs/getting-started.md) — install → first reflection in 10 min
- [`docs/reflection-prompt-design.md`](docs/reflection-prompt-design.md) — why the prompt is shaped this way
- [`docs/opus-4.7-best-practices.md`](docs/opus-4.7-best-practices.md) — adaptive thinking, sampling, cache details (2026-04 corrections)
- [`docs/api-cost-economics.md`](docs/api-cost-economics.md) — breakeven math, cost projections
- [`experiments/`](experiments/) — ablation results
