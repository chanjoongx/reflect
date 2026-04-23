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

### D2 Progress (2026-04-22)

- ✅ Tarek AMA 참석 (Discord #hackathon-stage)
- ✅ Anthropic API spec 직접 verify (platform.claude.com fetch) — `output_config.effort` accepted, `thinking.effort` rejected (extended-thinking page outdated)
- ✅ L1 token padding 4,741 (≥ 4,096 cache floor) — D1 의 silent cache miss (2,736 < 4,096) 해결
- ✅ Cache hit rate 95.9% measured (D2 Entry #003) + cost $0.009 warm
- ✅ `src/revert-detector.ts` Tier 1+2 production shell impl (canonical)
- ✅ `src/context-assembler.ts` real data sources (no stubs)
- ✅ First real E2E (DOGFOOD #004): hook → trigger → API call → guidance.md write 전체 사이클
- ✅ Hook cross-platform fix: Windows git-bash 의 jq+bc 부재 — pure-bash integer arithmetic (weights × 100) + grep/sed fallback rewrite

### D3 Progress (2026-04-23)

- ✅ Michael Cohen Managed Agents session 참석 → Q12 결정: 옵션 B (raw API + single-shot)
- ✅ `hooks/reflect-utterance.sh` + `.ps1` — Tier 3 utterance regex (UserPromptSubmit hook, NOT PostToolUse)
- ✅ `src/guidance-injector.ts` 완성 + lifecycle (overwrite on trigger, delete on session end)
- ✅ `src/logger.ts` opt-in `.reflect/session-log.jsonl` + 168h auto-prune
- ✅ `bin/reflect.ts` CLI subcommands 모두 작동 (init/status/manual/log/off/on)
- ✅ FAILURE-MODES Scenario 1 (cold-start sessions) 분석 완료 — Two-layer safety net + 5 edge cases + mock test seq

### D4 Progress (2026-04-24)

#### D4 morning (3 commits pushed)
- ✅ `4c39193` — ARCHITECTURE drift 10 items + README v1.0 (4-section + 6 details) + REFLECT.md `output_config.effort` fix (judges copy-paste 400-error risk 제거) + spec-reality alignment
- ✅ `c12db62` — CI hook smoke-test env-var prefix fix + state.json content assertion + Tier 3 step
- ✅ `9e67b14` — `docs/measurements.md` 신설 + 14 public MD links repoint to hackathon/ (GitHub 404 방지)
- ✅ Ablation 1 prompt Alt #1 swap (3-file cross-file truncation, 8 sites, no L1 cache landmine) — original D4-PREP "shared prompt-building helpers" was contrived per 3-round agent verification reject
- ✅ GitHub repo state fix: Linguist detected (TS 46K / Shell 29K / PS 23K / JS 11K), description + 15 topics set, `[branch "main"]` tracking config wired

#### D4 catch-up session (5:08-7:00 PT, 1 commit pushed)
- ✅ `01ed845` — `experiments/ablation-with-without.md` sync to D4 reality (Cond A/B labels FIXED + early-shift schedule + coin flip seed `$RANDOM=21483` odd → Run 1=Cond B / Run 2=Cond A)
- ✅ Coin flip + ablation prep: `.env` `REFLECT_DISABLED=1` + `REFLECT_LOG_ENABLED=1` set, `.reflect/` 삭제, ablation files synced
- ✅ 19 hackathon/*.md drift fix sweep (~50 Edits) — DEMO/COST/SUBMISSION/ACCEPTANCE-MATRIX/EXECUTION-PLAN/D4-PREP/FAILURE-MODES/DOGFOOD/CLAUDE/6-LAB/SUBMISSION-CHECKLIST/PII-AUDIT/HACKATHON/JUDGES/APPLICATION/OFFICE-HOURS/DISCORD-INTEL/RESEARCH-FINDINGS/NEXT_SESSION
- ✅ `hackathon/BRAIN-CHECKSUM.md` 신설 — cross-file spec consistency map (17 row Tier 1/2/3) + verification commands + self-limitations + v1.1 path
- ✅ Cross-file consistency reconciled (10 axis): DOGFOOD count / Cost figures / Cache hit / output_config.effort / Auto mode / Managed Agents 옵션 B / Ablation A/B 시나리오 / D4 morning commits / ACCEPTANCE 19/30 / D5 미루기

### Honest gaps (D4 late AM)

- ⏳ Ablation Run 1/2 진행/skip decision pending (사용자)
- ⏳ DOGFOOD entries 4 → target 12 (gap 8, D4 afternoon/D5 morning bulk session)
- ⏳ FAILURE-MODES Scenarios 2/3 real-session (D4 afternoon if skip OR D5 morning if Path A)
- ⏳ Demo dry-run ×1-3 (D4 evening)
- ⏳ Demo recording (D5 9-12 PT)
- ⏳ Submission form (D6 14-16 PT, 5 PM PT 마감)
- ⏳ npm publish (post-hackathon decision)

### Status: pre-alpha, hackathon D4 late AM (working code, 4 commits pushed `01ed845`)

**Acceptance**: 19/30 fully + 4 partial = ~21/30 effective. D5 25 + D6 28 목표 달성 가능.
**Cumulative cost**: D3 EOD $18.78 / $500. D4 estimate +$29-39.
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
