---
paths:
  - "src/**/*.{ts,tsx,js,jsx,mjs,cjs}"
  - "lib/**/*.{ts,tsx,js,jsx}"
  - "app/**/*.{ts,tsx,js,jsx}"
  - "packages/**/*.{ts,tsx,js,jsx}"
---

# Rule: reflect Session Guidance (path-scoped)

Loaded automatically when Claude reads or edits files in `src/`, `lib/`, `app/`, or `packages/`. Provides session-aware metacognition guidance from previous reflections.

## Pre-action: check for active reflection

Before any non-trivial code action in this session:

1. **Check `.reflect/session-guidance.md`** — if it exists, read it first
2. **Apply the most recent reflection's `adjustment` field** to your next action
3. **If `false_trigger_likelihood: high`** — treat the guidance as a question rather than instruction; ask the user before applying

## What .reflect/session-guidance.md contains

A single, most recent reflection from Opus 4.7 (single-shot, session-local). Format:

```markdown
# Session reflection — last triggered <timestamp>

## What I was doing (pattern)
<causal description of recent behavior>

## Why the user pushed back (signal)
<inference from reverted diffs + utterances>

## Adjustment for the rest of this session
<concrete change for next turn>

> Confidence: <low|medium|high> · Scope: <this_session|wider_concern> · FT-likelihood: <low|medium|high>
```

## How to use the reflection

- **High confidence + low false_trigger_likelihood**: Apply `adjustment` field as instruction
- **Medium confidence**: Apply `adjustment` field but explain reasoning to user
- **Low confidence OR high false_trigger_likelihood**: Treat `adjustment` as a question — surface to user before acting
- **Scope: wider_concern**: Mention to user that they may want to update their CLAUDE.md or stetkeep rules

## When to ignore

- If the reflection contradicts an explicit user instruction in the current turn → user instruction wins
- If `.reflect/session-guidance.md` is empty or unparseable → ignore silently
- If session ended (file deleted by `bin/reflect.ts` cleanup) → no guidance applies

## Lifecycle reminders

- The reflection is **session-local**. It evaporates at session end (file deleted).
- Reflection is **non-persistent** — do not write it back to CLAUDE.md or other tracked files.
- The next reflection (if triggered again) **overwrites** this file. Don't accumulate.

## Manual trigger

User can request a fresh reflection regardless of trigger threshold:

```
/brain-reflect
```

This bypasses the cooldown and threshold logic.

## Disable for current task

User can disable for current session:

```bash
reflect off    # current session only
```

Or edit `.env`:

```
REFLECT_DISABLED=1
```

## Compatibility with stetkeep

reflect operates on **PostToolUse**. stetkeep operates on **PreToolUse**.

- stetkeep blocks bad edits before they happen (prevention, static rules)
- reflect observes patterns after edits (reasoning, dynamic context)

Both can be active simultaneously without conflict. If stetkeep blocks an edit, reflect simply does not see it (no signal).
