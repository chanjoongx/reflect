<div align="center">

# reflect

### *A session-local metacognition harness for long-running Claude Code work.*

**When suggestions get reverted a few times, Opus 4.7 reads back the recent tool calls + active rules + rolled-back diff, then reasons about *why* — and injects guidance into the next turn.**

[![License: MIT](https://img.shields.io/badge/License-MIT-A78BFA.svg)](https://opensource.org/licenses/MIT)
[![Built for](https://img.shields.io/badge/Built%20for-Claude%20Code-D4A27F)](https://claude.com/claude-code)
[![Powered by](https://img.shields.io/badge/Powered%20by-Opus%204.7-5FE5D4)](https://www.anthropic.com/claude/opus)
[![Hackathon](https://img.shields.io/badge/Built%20with-Opus%204.7%20Hackathon-7AB7FC)](https://cerebralvalley.ai/e/built-with-4-7-hackathon)

</div>

---

## Status

**Hackathon build, 2026-04-21 to 2026-04-26.** Submitted to *Built with Opus 4.7: a Claude Code Hackathon* (Cerebral Valley + Anthropic).

This README is the public entry point. Full architecture in [`ARCHITECTURE.md`](ARCHITECTURE.md). Protocol spec in [`REFLECT.md`](REFLECT.md).

---

## What

You let Claude Code run for hours in auto mode. It does great work — and somewhere around hour two, it starts repeating the same misjudgment. You revert. It tries again. You revert. It tries something nearby. You revert.

That cluster of reverts contains a signal. **reflect captures it.**

When ≥3 revert signals appear within 10 tool calls, reflect:
1. Reads back the last 20 tool calls + the rolled-back diff + your active CLAUDE.md / stetkeep rules
2. Calls Opus 4.7 with adaptive thinking — single-shot, not multi-turn
3. Gets a structured reflection: *what pattern was I applying / what do the reverts signal / how to adjust*
4. Writes the reflection to `.reflect/session-guidance.md` — your **next turn auto-loads it** via stetkeep's path-scoped rule mechanism

Session-local. No persistence. No team sync. The guidance evaporates at session end.

---

## Why

> "4.7 to me is a giant step up in capability. However, if you use it the same way that you used 4.6, you won't feel that step up. It's just amazing at long-running work." — Boris Cherny, *Built with Opus 4.7* kickoff

[Anthropic's own copy on Opus 4.7](https://www.anthropic.com/claude/opus): "*drives long-running work forward with minimal oversight*."

reflect is the metacognition layer for that workflow. Auto mode and `/loop` enable duration. reflect catches when that duration produces drift.

### Why Opus 4.7 specifically (load-bearing)

The reflection task is **causal reasoning over context**, not pattern classification:
- "What was I trying to do across the last 12 tool calls?"
- "Why did the user push back?"
- "What pattern in my actions led to failure?"

Smaller models flatten this — they emit generic advice ("be more careful"). Opus 4.7 holds the causal chain across 20+ tool calls + 2-3 rule documents and produces a reflection that reads like a thoughtful teammate post-mortem.

We tested. The ablation results are in [`experiments/`](experiments/).

---

## How

### Install

```bash
npm install reflect
```

(Plugin marketplace install: see [`docs/getting-started.md`](docs/getting-started.md).)

### Activate

```bash
npx reflect init
```

This wires the PostToolUse hook in `.claude/settings.json`, installs the path-scoped rule, and writes `.env.example` for your `ANTHROPIC_API_KEY`.

### Verify

```bash
npx reflect status
```

Should print: hook wired, key present, last trigger (none yet).

### First reflection

Just work. After ≥3 reverts in 10 tool calls, the next tool call triggers reflection. You'll see in stderr:

```
[reflect] trigger fired: signals=[T1×2, T3×1], sum=2.5
[reflect] guidance written: .reflect/session-guidance.md
```

Your next turn will silently consume that guidance.

### Manual trigger
```
/brain-reflect
```

---

## Honest gotchas

reflect is **not** a fix-all. Documented failure modes:

- **Cold-start sessions** — first ~5 turns lack causal context. reflect declines to fire.
- **False trigger on intent changes** — if you change your mind mid-task, the reverts may be your shift, not assistant misbehavior. reflect flags `false_trigger_likelihood: high` and the next turn treats the guidance as a question.
- **Regulatory / domain-opaque code** — tax / KYC / GDPR may produce vague reflections. Mitigation in v1.1 (user-supplied domain rule injection).
- **Cost on large prompts** — first trigger is ≈$0.09. Subsequent (cached) ≈$0.04. See [`docs/api-cost-economics.md`](docs/api-cost-economics.md) for math.

If you'd like to push reflect to its breaking point, see [`hackathon/FAILURE-MODES.md`](hackathon/FAILURE-MODES.md) (during the hackathon — public after submission).

---

## Architecture at a glance

```
USER SESSION (Claude Code, auto mode + /loop)
  │
  ├─[PostToolUse hook] reflect-trigger.{sh,ps1}
  │   └─ Detect revert signals (3-tier taxonomy, weighted threshold ≥ 2.4)
  │
  ├─[Trigger handler] src/opus-reflection.ts
  │   ├─ Assemble 3-layer prompt (cache-friendly)
  │   │   L1 stable (TTL 1h) — system + role + schema
  │   │   L2 medium (TTL 5m) — active rules + session summary
  │   │   L3 ephemeral       — last 20 tool calls + diff
  │   └─ Call claude-opus-4-7 (adaptive thinking, effort: high)
  │
  └─[Guidance injector] → .reflect/session-guidance.md
      ↓
  Next turn auto-loads via path-scoped rule
```

Detailed: [`ARCHITECTURE.md`](ARCHITECTURE.md). Protocol: [`REFLECT.md`](REFLECT.md).

---

## Composition with stetkeep

reflect uses [`stetkeep`](https://github.com/chanjoongx/stetkeep) (CJ's existing MIT npm package) as a base dependency. Two distinct layers:

- **stetkeep** — *prevention*. Static 16-entry false-positive catalog + PreToolUse safety net. Blocks bad edits before they happen.
- **reflect** — *post-hoc reasoning*. Dynamic metacognition after revert clustering. Catches what static rules can't.

You can run either independently. Together they're a "prevention + reflection" stack. stetkeep contents are NOT part of this hackathon submission — they're prior work, installed as an npm dependency.

---

## Roadmap

- **v1** (this hackathon) — single-shot Opus 4.7, session-local, honest failure modes
- **v1.1** — opt-in *deep-reflect mode* (multi-turn dialogue), domain rule injection
- **v2** — optional persistence (only if v1 signals warrant — see [`REFLECT.md` `<roadmap>`](REFLECT.md))

---

## Contributing

We particularly want:
- New revert-signal detection patterns (with reproducer)
- Failure-mode reports (sessions where reflect fired but produced bad guidance)
- Reflection prompt improvements (with ablation evidence)
- Language ports (the harness is model-agnostic; Python/Rust ports welcome)

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Process: open an issue → align scope → PR.

---

## Security & supply chain

- Zero runtime dependencies on the harness layer (TypeScript + Anthropic SDK only)
- No network calls outside the single Opus 4.7 API call
- No telemetry, no analytics, no data exfiltration
- Pre-commit PII scanner (clone from stetkeep)
- Privacy policy: [`PRIVACY.md`](PRIVACY.md). Vulnerability reports: [`SECURITY.md`](SECURITY.md).

---

## License

[MIT](LICENSE).

---

<div align="center">

**Built by [Chanjoong Kim](https://github.com/chanjoongx) · Hackathon week of 2026-04-21**
*A harness for the model 6 months from now.*

</div>
