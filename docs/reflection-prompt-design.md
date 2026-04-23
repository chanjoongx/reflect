# Reflection Prompt Design

> Why the reflection prompt is shaped this way. Background reading for contributors who want to improve the prompt.

---

## Design principles

1. **Causal, not classificatory.** Smaller models flatten reflection into pattern matching ("this is duplication"). The prompt explicitly demands causal reasoning ("what was the assistant trying to do that led to these reverts").
2. **Schema-first output.** Structured JSON forces the model to produce actionable fields. No free-form prose.
3. **Refuse weak inputs.** The prompt instructs the model to set `confidence: low` and frame `adjustment` as a question when context is insufficient.
4. **Honest about ambiguity.** `false_trigger_likelihood` field surfaces when reverts may be intent changes rather than feedback.

---

## Why XML is NOT used in the system prompt

stetkeep uses XML-tagged sections heavily. reflect's REFLECT.md uses XML internally for spec organization. But the **system prompt sent to Opus 4.7** uses simple Markdown headings, not XML.

Reason: the model's task here is to OUTPUT JSON. XML in the prompt would compete with the JSON output instruction. Markdown headings provide structure without ambiguity about what the response shape should be.

---

## L1 layer composition (4,741 tokens measured, cached 1h)

The L1 stable layer is the largest and the only one that absolutely must meet Opus 4.7's 4,096-token cache floor. Composition (approximate — measured total is 4,741 per `hackathon/DOGFOOD-LOG.md` Entry #003):

| Section | ~Tokens | Purpose |
|---|---|---|
| Role definition | 200 | "You are reflect, a metacognition oracle..." |
| How to think (causal vs classificatory) | 300 | Anti-pattern guard against generic output |
| Output JSON schema | 200 | Exact field names + types |
| Field semantics | 400 | What each field means + examples of bad/good |
| Examples (3 calibration cases) | 1500 | Few-shot reasoning models |
| Refuse-to-reflect cases | 300 | Cold-start, false trigger, private info |
| Reasoning rubric (7 steps) | 300 | Internal chain-of-thought scaffold |
| Output discipline | 200 | "Output ONLY JSON, no prose" |
| Padding examples (additional calibration) | 1100 | Bring total to ≥ 4096 |

The padding is not waste — every example tightens the model's calibration. The 4096 floor is a constraint we accept.

---

## L2 layer composition (~2000 tokens, cached 5m)

L2 changes every ~20 turns (or when active rules change):

| Section | ~Tokens |
|---|---|
| Active rules in current scope | 500-1000 |
| Session task summary | 100-300 |
| Last reflection (continuity, optional) | 200-400 |

Cached at 5m TTL because session task drift is faster than L1 invariants.

---

## L3 layer composition (~3000 tokens, no cache)

L3 is per-trigger fresh data:

| Section | ~Tokens |
|---|---|
| Last 20 tool call summaries | 1500-2000 |
| Rolled-back diff blob | 500-1000 |
| Trigger meta (signals, weights) | 100 |
| Final task instruction | 200 |

Tool calls are summarized (long string fields truncated to 200 chars) to fit budget.

---

## Why few-shot examples in L1

Opus 4.7's adaptive thinking + literal-instruction-following means it follows examples *very* closely. Three calibration examples (good vs bad reflection) shape output more reliably than abstract criteria.

The three included examples cover:
1. **High-confidence behavioral pattern** (DRY-over-CLAUDE.md violation)
2. **Intent change masquerading as revert** (high false_trigger_likelihood)
3. **Regulatory domain** (literal value matters, generalization is harm)

These were chosen to span the failure modes documented in `hackathon/FAILURE-MODES.md`.

---

## Why the 800-token output cap

Reflections should be **concise**. Long reflections become noise to the next turn. 800 tokens fits:
- pattern: ~50 tokens (1-2 sentences)
- signal: ~50 tokens (1-2 sentences)
- adjustment: ~80 tokens (1-2 sentences, more concrete)
- enum fields: ~30 tokens
- JSON structure: ~40 tokens
- thinking content (if displayed): ~550 tokens

reflect sets `display: "summarized"` on every call (`src/opus-reflection.ts:71`) — the response contains both a thinking summary block and a text JSON block. The parser at `src/opus-reflection.ts:107` reads only the text block; the thinking summary surfaces in `REFLECT_DEBUG=1` output for audit.

---

## How to improve the prompt

### Add a calibration example
If you encounter a real session where reflect produced a poor reflection:

1. Save the trigger payload (last 20 tool calls + diff)
2. Hand-craft what the *good* reflection should have been
3. Add to the examples section in `src/context-assembler.ts`'s `SYSTEM_PROMPT_L1`
4. Run ablation: does the new example improve similar future cases without regressing others?

PR welcome.

### Adjust effort
- `effort: "low"` — fast, lower cost, may flatten causal reasoning
- `effort: "high"` — current default, balanced
- `effort: "xhigh"` — Anthropic's recommended starting point for coding/agentic. May produce richer reflections at ~30% cost increase

Test in your own dogfood log before changing default.

### Tune the trigger threshold
Default 2.4 (3 tier-1 signals, or 2 tier-1 + 1 tier-3, etc.). Adjust via `REFLECT_TRIGGER_THRESHOLD`.

If you find too many false triggers: raise to 3.0+
If you find missed clusters: lower to 2.0

---

## Related work

- **Reflexion** (Shinn et al., 2023, arXiv:2303.11366) — verbal self-reflection inspires the prompt structure but reflect's signal-driven trigger is different
- **Constitutional AI** (Bai et al., 2022) — principle-driven self-critique. reflect's "refuse weak inputs" is in this spirit
- **Process Reward Models** — academic frame for reflection at training time. reflect operates at inference

---

**Last updated**: 2026-04-24 D4 (D2 verified API spec, D4 ablation 1 frozen to `experiments/ablation-1-task-prompt.md`)
