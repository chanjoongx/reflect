---
description: Manually trigger reflect — a session-local metacognition reflection on recent tool calls.
argument-hint: "[scope: session|recent]"
---

# /brain-reflect

Invoke a manual reflection on the current Claude Code session. Bypasses the automatic threshold (3 weighted revert signals in 10 tool calls) and cooldown — fires on demand.

## What this does

1. Reads `REFLECT.md` from project root (protocol spec)
2. Calls `bin/reflect.ts manual` which:
   - Assembles the 3-layer prompt (L1 stable + L2 medium + L3 ephemeral)
   - Calls Opus 4.7 with adaptive thinking (`effort: high`)
   - Parses structured JSON response: `{ pattern, signal, adjustment, confidence, scope, false_trigger_likelihood }`
   - Writes to `.reflect/session-guidance.md`
3. Reports the reflection summary back to the user
4. Future tool calls in this session will pick up the guidance via `.claude/rules/reflect-rules.md` (path-scoped)

## Steps for Claude Code to execute

1. Read the most recent 20 tool calls from session transcript
2. Read any rolled-back diff (if available)
3. Read `.claude/rules/reflect-rules.md` (active rules in this scope)
4. Execute: `npx tsx bin/reflect.ts manual --scope $ARGUMENTS`
5. Report the reflection's `pattern` / `signal` / `adjustment` to the user
6. Wait for user acknowledgment before applying `adjustment` to next turn

## Optional argument

`$ARGUMENTS` (default: `session`):
- `session` — entire session context (default)
- `recent` — last 10 tool calls only (faster, cheaper)

## Cost
- Cold call (first reflect of session): ~$0.09
- Warm call (subsequent in same hour): ~$0.04

Cost details: `docs/api-cost-economics.md`.

## When to use

- After a noticeable pattern of mistakes (you don't want to wait for the auto-trigger)
- Before a critical decision (e.g., "should I refactor this whole module?")
- At the end of a long task (post-mortem reflection on what worked)

## When NOT to use

- Sessions with < 5 tool calls (cold-start; reflect refuses to fire — see `<safety_net>` in `REFLECT.md`)
- Immediately after intent change (false_trigger_likelihood: high)
- Inside regulatory / domain-opaque code (Generic output likely)

End the report with the reflection's `confidence` and `false_trigger_likelihood` fields visible.
