# Changelog

All notable changes are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Semver: MAJOR.MINOR.PATCH.

---

## [0.1.0-alpha.1] — 2026-04-21

### Added — initial scaffold (hackathon D1)

Built during *Built with Opus 4.7: a Claude Code Hackathon* (Cerebral Valley + Anthropic, 2026-04-21 to 2026-04-26).

**Core architecture (skeleton — implementation D2-D5)**:
- `bin/reflect.ts` — CLI: `init`, `status`, `manual`, `trigger`, `log`, `off`, `on`
- `src/revert-detector.ts` — 3-tier signal taxonomy (hard / inferred / soft, weighted)
- `src/context-assembler.ts` — 3-layer prompt cache (L1 1h, L2 5m, L3 ephemeral)
- `src/opus-reflection.ts` — Opus 4.7 client with adaptive thinking + cache
- `src/guidance-injector.ts` — `.reflect/session-guidance.md` writer
- `src/logger.ts` — opt-in `.reflect/session-log.jsonl` (168h auto-pruned)
- `src/types.ts` — strict TypeScript types

**Hooks**:
- `hooks/reflect-trigger.sh` — PostToolUse hook (bash)
- `hooks/reflect-trigger.ps1` — PostToolUse hook (PowerShell)
- `hooks/hooks.json` — plugin manifest

**Plugin / commands / agents**:
- `commands/brain-reflect.md` — manual trigger slash command
- `agents/reflection-orchestrator.md` — subagent (read-only, no Edit/Write)
- `.claude-plugin/plugin.json` — Claude Code plugin manifest
- `.claude/rules/reflect-rules.md` — path-scoped rule for guidance auto-loading
- `.claude/settings.example.json` — wiring template

**Documentation**:
- `README.md` — public face (4 sections: What / Why / How / Honest gotchas)
- `REFLECT.md` — XML-tagged metacognition protocol spec
- `ARCHITECTURE.md` — harness vs model layer separation, Mermaid sequence diagram
- `docs/getting-started.md` — install → first reflection in 10 minutes
- `docs/reflection-prompt-design.md` — why the L1 prompt is shaped this way
- `docs/opus-4.7-best-practices.md` — 2026-04-21 API corrections (adaptive thinking, no sampling, cache floor)
- `docs/api-cost-economics.md` — break-even math, daily cost projection
- `docs/troubleshooting.md` — common issues + fixes

**OSS hygiene**:
- `LICENSE` (MIT)
- `CONTRIBUTING.md` — reflection quality reports as highest-leverage contribution
- `SECURITY.md` — vulnerability reporting + supply chain (zero runtime deps beyond Anthropic SDK)
- `PRIVACY.md` — no telemetry, no data collection, single Opus 4.7 call per trigger
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1
- `.github/ISSUE_TEMPLATE/` — bug, reflection_quality, feature, config
- `.github/workflows/ci.yml` — TS typecheck + mirror-check + hook smoke test

**Defense layers (PII / supply chain)**:
- `.gitignore` — Layer 1, file-level (env, hackathon/, CLAUDE.md, .reflect/)
- `.git/hooks/pre-commit` — Layer 2, content-level PII scanner (cloned from stetkeep)
- Memory file physical isolation — Layer 3, outside repo

**Composition with stetkeep**:
- `package.json` declares `stetkeep@^0.4.6` as runtime dependency
- stetkeep handles PreToolUse (prevention); reflect handles PostToolUse (observation)
- Path-scoped rule reuses stetkeep's mechanism for guidance auto-loading

### Design decisions

1. **Single-shot Opus 4.7** (not Managed Agents for v1)
   - reflection task is single-shot causal reasoning over fixed context
   - direct Messages API gives precise cache breakpoint control
   - v1.1 deep-reflect mode (multi-turn) may revisit Managed Agents

2. **PostToolUse layering**
   - PreToolUse occupied by stetkeep (prevention)
   - PostToolUse fits reflect (observation, no blocking)

3. **Session-local intentional**
   - No persistence v1
   - Phase 2 trigger condition: 50 users × 10 sessions, useful rate >60%
   - Privacy + cost + cross-session drift risk justify v1 scope

4. **3-tier weighted signals + threshold 2.4**
   - 3× tier-1 = 3.0 (clear trigger)
   - 2× tier-1 + 1× tier-3 = 2.5 (also triggers)
   - All-tier-3 = 1.5 (does not trigger — utterance noise filter)
   - Cooldown 5 turns post-trigger (avoid loops)

5. **Cache strategy: L1 1h + L2 5m + L3 none**
   - Opus 4.7 cache floor 4,096 tokens met by L1
   - 1h on L1 because extended thinking exceeds 5min default
   - Break-even: ~2 reads per session (typical reflect fires 3+ times)

### Honest gaps (D1 EOD)

- Hook + CLI skeleton only — full implementation D2-D3
- First Opus 4.7 API call not yet executed
- No real reflections in dogfood log yet
- Ablation experiments unrun (D4 plan documented)
- Demo not recorded (D5)
- npm not published (post-hackathon decision)

### Status: pre-alpha, hackathon submission scope

**Submission**: 2026-04-26 5:00 PM PT to *Built with Opus 4.7: a Claude Code Hackathon*.

---

## [Unreleased] — Roadmap

### v0.2 (post-hackathon)
- Real `getActiveRules()` / `summarizeTask()` / `getRolledBackDiff()` implementations
- Retry with exponential backoff for 429 / 503
- Token counting via SDK `countTokens()` to verify L1 ≥ 4096
- Tutorial blog (D+28 commitment per Ado Lab roadmap)
- Korean dev community launch (D+7 per Jason Lab playbook)

### v0.5 / v1.0 (if signals warrant)
- Deep-reflect mode (opt-in multi-turn dialog)
- User-supplied domain rule injection (mitigates regulatory failure mode)
- Reflection quality 👍/👎 user feedback loop
- npm publish with OIDC + Sigstore (pattern from stetkeep)
- Anthropic marketplace submission

### v2 (Phase 2 — only if v1 useful_rate > 60% across 50 users × 10 sessions)
- Optional `.reflect/learned.md` persistence (opt-in, fully user-controlled)
- Cross-session pattern accumulation
- Team sync (organization-wide patterns)
