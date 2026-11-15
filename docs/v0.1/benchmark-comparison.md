# How reflect compares to neighboring tools

> *Where reflect sits in the AI coding tool landscape — what overlaps, what differs, what's deliberately not in scope.*
>
> Comparisons based on **public documentation as of 2026-04**. Other tools evolve; treat features below as a snapshot, not a moving truth. If a comparison is wrong, please [file an issue](https://github.com/chanjoongx/reflect/issues) and I'll correct it.

---

## The categories — five different bets in the same space

The "make AI coding assistants drift less" problem has at least five different shapes of answer. Most tools occupy one shape; reflect deliberately picks the post-hoc + session-local cell because the others were already taken.

| Category | What it does | Examples |
|---|---|---|
| **A. Static prevention** | Block bad edits *before* they happen using fixed rules / patterns | [stetkeep](https://github.com/chanjoongx/stetkeep) (16-entry false-positive catalog), TDD-Guard (test-first enforcement) |
| **B. Pre-execution policy** | Check tool calls against runtime policy before they execute | TDD-Guard hook layer, Cursor's lint integrations, MCP guardrail servers |
| **C. Post-execution metacognition** | After tools run, reflect on patterns and inject guidance | **reflect** ← this project |
| **D. Cross-session memory** | Persist learnings across sessions, build a profile of how the user / codebase works | Devin (long-term memory), Cline (task history), Claude's own memory feature, Aider chat history |
| **E. Live IDE assist** | Real-time autocomplete + inline suggestions during typing | Cursor, GitHub Copilot, Codeium, Tabnine |

Categories A, B, E are *prevention-shaped* — stop bad things at or before the keystroke. D is *memory-shaped* — get smarter over time. C is *reflection-shaped* — notice when things have already gone slightly wrong, in this session, and adjust the rest of this session.

reflect is the only tool I'm aware of in category C that ships as a public Claude Code plugin. That's not a moat; it's a gap that may or may not turn out to matter. The submission claim is "v1 of category C; let's see if the signal warrants Phase 2."

---

## Direct comparisons

The five most-asked "how is reflect different from X" questions, with the most honest answers I can give.

### vs **Cline** (autonomous coding agent + task history)

Cline is a VS Code extension that runs Claude/GPT-class models autonomously on coding tasks, with task history persistence and human-in-the-loop checkpoints. It's category D + B mixed.

| Axis | Cline | reflect |
|---|---|---|
| Surface | VS Code extension, full agent harness | Claude Code hook + npm CLI |
| Memory | Persists task history across sessions | Session-local only (deliberate v1 choice) |
| Trigger | User-initiated tasks | Automatic — revert signal clustering |
| Failure mode handling | Human checkpoint after each step | Post-hoc reflection after the fact |
| Composability | Standalone product | Composes with stetkeep + Claude Code |
| First-party LLM | OpenAI / Anthropic / Bedrock pluggable | Single-shot Opus 4.7 by design |

Different shape. Cline is a *replacement* for the IDE workflow; reflect is an *observer* on top of an existing IDE workflow (Claude Code). Both can coexist.

### vs **TDD-Guard** (pre-execution test enforcement)

TDD-Guard is a Claude Code hook that enforces test-first development by blocking implementation edits without a corresponding failing test. It's category A + B.

| Axis | TDD-Guard | reflect |
|---|---|---|
| Hook event | PreToolUse (block before) | PostToolUse + UserPromptSubmit (observe after) |
| Decision rule | Static (test exists? Y/N) | Dynamic (Opus 4.7 reasoning over context) |
| Scope | Single-tool decisions | Multi-turn pattern detection |
| Latency | <50 ms (rule check) | 5-6 s for reflection (background, non-blocking) |
| Cost | Free (no LLM call) | ≈ $0.05 cold / $0.01 warm per reflection |
| Failure mode | Strict — may over-block | Lenient — may produce vague output |

These are complementary. TDD-Guard's domain is "this specific edit violates a clear rule"; reflect's domain is "the last 20 tool calls together suggest a pattern." A repo could plausibly run both.

### vs **Devin** (autonomous SWE agent with cross-session memory)

Devin is a fully autonomous software engineer agent. It picks up tasks, executes them, and remembers per-user across sessions. Category D heavy.

| Axis | Devin | reflect |
|---|---|---|
| Autonomy level | High — runs tasks end-to-end | Low — observes and advises |
| Memory | Cross-session persistent (per user) | Session-local, evaporates at session end |
| User role | Reviews PRs / accepts/rejects | Continuously editing alongside Claude Code |
| LLM | Proprietary stack | Direct Opus 4.7 API |
| Privacy posture | Per-user memory accumulates | Per-session, no accumulation |
| Cost model | Subscription + per-task | Per-reflection ($0.01-0.05) |

Different products. Devin is "let an agent do the task." reflect is "if I'm doing the task with Claude Code's help, catch it when we drift." reflect was built on the assumption that not every workflow wants a fully autonomous agent — some want an observant ride-along that flags multi-turn patterns.

### vs **Claude's built-in memory** (in claude.ai, Claude Code)

Claude itself ships memory features that persist user preferences and context across conversations. Category D.

| Axis | Claude memory | reflect |
|---|---|---|
| Storage | Anthropic-managed cross-conversation | Local file (`.reflect/session-guidance.md`), gitignored |
| Persistence | Long-term, opt-in | Session-only, evaporates at session end |
| Trigger | Implicit (Claude decides what to remember) | Explicit (revert signal clustering) |
| User control | "Edit memory" UI | Direct file edit, full transparency |
| Cross-session | Yes (the whole point) | No (the whole point of v1) |

Claude memory and reflect address fundamentally different problems. Claude memory: "remember things about me as a user across conversations." reflect: "notice that *this* hour-long session has hit a pattern, and tell next-turn me about it."

If reflect's Phase 2 ever ships, it would compose with Claude memory rather than replace it: cross-session reflect findings might surface as suggestions to add to Claude memory, but never automatically.

### vs **Cursor / GitHub Copilot / Codeium / Tabnine** (IDE autocomplete)

All category E — real-time inline suggestions during typing.

These don't really compete with reflect; they're a different abstraction layer entirely. Cursor + reflect might coexist (Cursor doing autocomplete, Claude Code + reflect doing multi-step refactors). The user's mental model might be: "Cursor suggests one line; Claude Code drives a 3-hour session; reflect notices when the session has drifted."

Skipping the table for these — the comparison is roughly "different problem, no overlap."

---

## The honest "where reflect is weaker" section

Comparison tables make tools look more equivalent than they are. Five places reflect is genuinely weaker than alternatives:

1. **No cross-session learning** (deliberate). If your workflow benefits from "Claude remembers my coding style across days," reflect gives you nothing. Devin / Claude memory / Cline task history all do better here. v1 ships without it because the engineering bet was that session-local is enough to validate the loop. If validation succeeds, Phase 2 may revisit.

2. **Single-shot reflection only**. v1 is one Opus 4.7 call per trigger, no multi-turn dialog. For complex drift cases (e.g., a sequence of architectural mistakes), a deeper conversation might produce better guidance. v1.1 plans an opt-in `deep-reflect mode` for this.

3. **No team / org features**. Single-user, single-machine. If your org needs shared learnings across engineers, reflect is the wrong tool. Cline-team-pro, Cursor-business, Devin-team have those features.

4. **Latency is visible**. 5-6 seconds for a reflection is non-blocking (background subprocess) but the result lands a turn later than ideal. TDD-Guard's <50 ms pre-execution check is tighter for time-critical decisions.

5. **Cost adds up at scale**. ~$0.01 per warm call sounds cheap but a fully autonomous overnight `/loop` that fires 50 reflections costs $0.50. Cheap per session; non-trivial per month for heavy users. Free alternatives exist; reflect is for cases where Opus 4.7's reasoning quality is worth the cost.

---

## The honest "where reflect is stronger" section

Three places reflect specifically beats alternatives I've seen:

1. **Composability with existing Claude Code workflow**. reflect doesn't replace your IDE, doesn't replace Claude Code, doesn't replace your prompts. It hooks in, watches, and stays out of the way until the threshold crosses. Most tools in this space want to *be* the workflow.

2. **Honest about limitations**. v1 ships with documented failure modes (cold-start, intent change, regulatory domain), an experiment-design caveat for the live test scenarios, and a `false_trigger_likelihood: high` output field that explicitly signals when the reflection is probably wrong. Most agent tools over-claim; reflect under-claims by design.

3. **Two complementary safety layers** (architectural finding from D5 testing). Claude's intrinsic pre-execution reasoning catches turn-visible contradictions; reflect's post-hoc metacognition catches multi-turn-only accumulated patterns. They cover different cases. This is a *design discovery*, not a feature claim — and it suggests that anyone building in this space should explicitly partition responsibility between the two layers rather than building monolithic safety.

---

## Where reflect's design hopefully ages well

The choices that should still hold up in 6 months even if specific implementations evolve:

- **Session-local first, persistence later (gated on signal)**. If LLM context windows grow another 10× by end of 2026, single-session reasoning becomes even more powerful. The "reflect within the session" loop survives.
- **Hook + path-scoped rule for delivery**. Reuses existing Claude Code primitives. If Claude Code adds a native "latest guidance" surface, reflect can switch to it without changing the core reflection logic.
- **Single-shot causal reasoning over fixed context**. Avoids multi-turn agent state management. If Anthropic ships managed agents with first-class metacognition primitives, reflect's reflection step can move there in a one-day port.
- **3-tier signal weights tunable, not hard-coded**. `REFLECT_TRIGGER_THRESHOLD_X100`, `REFLECT_COOLDOWN_TURNS`, etc. are env-var configurable. Future tier additions (e.g., Edit→Edit inversion) slot in as new weights without breaking existing.

---

## TL;DR for time-pressed readers

- reflect is a **post-hoc metacognition harness**, not an autocomplete or memory tool
- Sits in a category most tools don't currently target (post-execution, session-local, multi-turn pattern)
- **Strengths**: composable, honest, complementary to Claude's intrinsic safety
- **Weaknesses**: no cross-session learning (by design), latency 5-6s, costs $0.01-0.05 per call
- **If you want a different shape**: Devin (autonomous), Cline (task history), TDD-Guard (test enforcement), Cursor (autocomplete), Claude memory (cross-session preferences)
- **If reflect's bet is right**: the post-execution + session-local + multi-turn cell turns out to matter, and Phase 2 persistence becomes worth shipping

---

*Comparisons reflect public documentation as of 2026-04. File an issue if any are wrong — github.com/chanjoongx/reflect/issues.*
