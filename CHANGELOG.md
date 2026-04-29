# Changelog

All notable changes are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Semver: MAJOR.MINOR.PATCH.

---

## [0.1.4] — 2026-04-29

### Fixed (post 8-agent parallel audit)

- **`.github/ISSUE_TEMPLATE/config.yml`**: security contact email `cj@stetkeep.com` → `cj@chanjoongx.com` (consistency with SECURITY.md, PRIVACY.md, CODE_OF_CONDUCT.md — all other surfaces use `cj@chanjoongx.com`).
- **`.gitignore`**: added explicit `.env.production`, `.env.staging`, `.env.test`, `.env.development` entries to plug the gap left by `.env.*.local`. Without this, a dev creating `.env.production` with credentials would have been tracked.
- **`tsconfig.json`**: added `src/example/**` to `exclude` array. The D6 dogfood baseline `src/example/dummy.ts` was being compiled into `dist/src/example/dummy.{js,d.ts,d.ts.map,js.map}` and shipped in 0.1.3 tarball as a non-functional artifact (4 surplus files). Now excluded from the build → tarball production-clean.
- **`src/opus-reflection.ts`**: API call now uses `config.effort` (driven by `REFLECT_EFFORT` env var) instead of hardcoded `"high"`. The env var was documented in CLI help (`reflect --help`) but ignored at request time — silent override bug.
- **`docs/getting-started.md`**: Steps 2/3/4 install paths updated from `node_modules/reflect/...` (unscoped) → `node_modules/@chanjoongx/reflect/...` (scoped). The unscoped paths would have failed for users following docs literally since the package name is scoped.
- **`ARCHITECTURE.md`** §5 cost section: cold $0.049 → $0.0486 (precision match to `docs/measurements.md`), theoretical $0.093 → $0.095 (math match to `docs/api-cost-economics.md`). Eliminates the cross-file drift a thorough reviewer would spot in 30s.
- **`README.md`** how-it-works cost line: explicit `(measured D2)` labels added for both cold and warm; cache hit refined to `95.9% L1 cache hit` (was rounded to `95%` without the precise cite).
- **`bin/reflect.ts`** `cmdManual`: now calls `pruneOldEntries()` at trigger entry when log is enabled. The 168h auto-prune contract documented in `src/logger.ts` is now enforced in code (was previously only callable via `reflect log --prune`, contradicting docs claim of "called on session start").
- **`src/logger.ts`**: comment block on `next_turn_acted_on_adjustment` and `next_turn_summary` fields clarifies that v1 reserves the schema; v1.1 wires the next-turn correlation tooling needed to compute the Phase 2 trigger condition.
- **`docs/troubleshooting.md`**: "Manual /brain-reflect doesn't work" section now explicitly distinguishes plugin pattern (auto-detect via `.claude-plugin/plugin.json`) from standalone pattern (manual `cp` of `commands/` + `agents/` from `node_modules/@chanjoongx/reflect/`). Ends the documentation gap where standalone users had no path to install the slash command.

### Internal

- 5-surface version sync `0.1.3` → `0.1.4`: `package.json`, `package-lock.json` (root + `packages.""`), `.claude-plugin/plugin.json`, `bin/reflect.ts` `--version`, `.github/ISSUE_TEMPLATE/bug.yml` placeholder. Verified by the publish workflow's `Verify 5-surface version sync` step.
- Tarball file count: 0.1.3 had 49 files (with 4 surplus dummy files); 0.1.4 ships 45 files (parity with 0.1.0–0.1.2 baseline) post `tsconfig.json` exclude.

### Notes

- 8-agent parallel audit perspectives: Boris (code) + Cat (production) + Thariq (cost consistency) + Lydia (DX) + Ado (OSS hygiene) + .gitignore specialist + doc cross-consistency + plugin spec compliance. 10 fixes from this round, plus 2 deferred to v0.2 (countTokens pre-flight, Windows native PowerShell hook routing).
- `npm publish --provenance` continues via OIDC trusted publisher (set up for 0.1.3); 0.1.4 publish triggers the same SLSA v1 attestation pipeline.

---

## [0.1.3] — 2026-04-29

### Changed
- `README.md`: removed `## Demo` section. Video URL stays out of the public README; demo link is reserved for marketplace and hackathon submission contexts (author privacy preference).
- `README.md` "Why Opus 4.7 specifically" details block: `Ablation results: experiments/` → `Methodology + decision log: experiments/` — accurately describes what the `experiments/` folder contains (v1.1-deferred ablation decision log, not run results).
- `commands/brain-reflect.md` (and `.claude/commands/brain-reflect.md` mirror): cost figures updated from theoretical (cold ~$0.09 / warm ~$0.04) to measured (cold ~$0.05 / warm ~$0.01, 95.9% L1 cache hit) — matches `README.md` and `docs/api-cost-economics.md`. Eliminates the cross-file inconsistency a marketplace reviewer would catch on cross-check.

### Internal
- 5-surface version sync `0.1.2` → `0.1.3`: `package.json`, `package-lock.json` (root + `packages.""`), `.claude-plugin/plugin.json`, `bin/reflect.ts` `--version` output, `.github/ISSUE_TEMPLATE/bug.yml` placeholder.
- Plugin manifest verified against the official Claude Code plugin docs (`code.claude.com/docs/en/plugins`): `hooks/hooks.json` is auto-detected from the plugin root, so an explicit `hooks` field in `plugin.json` is not required. Current `commands` + `agents` arrays remain (they parallel the auto-detect pattern but are also valid as explicit declarations).
- No runtime code changes. `dist/` regenerated from the same TypeScript source as `0.1.2`.

### Notes
- Prepares for Anthropic plugin marketplace submission (stetkeep parity in supply-chain hygiene). OIDC trusted publisher setup — for SLSA v1 provenance on the next publish — happens out-of-band before the actual `npm publish` of this version.

---

## [0.1.2] — 2026-04-25

### Fixed (post 9-agent exhaustive audit — root docs / docs folder / source code / hooks / plugin manifest / web Viewer / experiments / CI infra / hackathon docs / live npm registry vs repo)
- `SECURITY.md` email contact: `cj@stetkeep.com` → `cj@chanjoongx.com` (consistency with PRIVACY.md and CODE_OF_CONDUCT.md; both `cj@*.com` are public-facing but unifying for clarity)
- `SECURITY.md` supported-versions table: dropped misleading `(alpha)` label (we ship `0.1.x` stable, not alpha — see `[0.1.0]` pivot below)
- `SECURITY.md` `npm view` example: scoped name `@chanjoongx/reflect`
- `.claude-plugin/plugin.json` version: stale `0.1.0` → `0.1.2` (was missed in `[0.1.1]` patch — Claude Code plugin marketplace would have shown wrong version)
- `bin/reflect.ts` `--version` output: hardcoded `0.1.0` → `0.1.2` (matches `package.json` version)
- `bin/reflect.ts` `cmdStatus` typing: `let state: any` → `let state: ShellState | null` with proper inline type matching the on-disk shape (shell hooks write flat `cum_x100`, not the `SessionState.signals` array — that's reference-impl only)
- `bin/reflect.ts` `cmdStatus` output: `signals_in_window: N` (wrong shape, would always print 0 since shell-written state has no `signals` key) → `cum_x100: N / 240 threshold` (matches production state shape and is far more useful for users running `npx reflect status`)
- `package-lock.json` root version field drift (was `0.1.0` after `[0.1.1]` patch since `npm install` wasn't re-run — would not have broken `npm ci` but is now properly synced to `0.1.2`)
- `.github/ISSUE_TEMPLATE/bug.yml` version placeholder: `0.1.0` → `0.1.2`
- `web/components/Nav.tsx`: Roadmap route link added — `/roadmap` page existed but was reachable only via direct URL, not Nav (4 of 5 documented routes were navigable)
- `commands/brain-reflect.md` + `.claude/commands/brain-reflect.md` (mirror): added explicit `name: brain-reflect` to frontmatter (was relying on filename inference; explicit declaration is more defensive)
- `docs/getting-started.md`: install description removed hardcoded `current release 0.1.0` — now points to `CHANGELOG.md` so future patches don't drift the doc

### Internal — 9-agent audit
- Root public docs (Agent A): 1 BLOCKER (email mismatch fixed) + minors (cache hit rounding accepted as intentional `≈ 95%` vs measured `95.9%`)
- docs folder (Agent B): 1 MAJOR (getting-started version, fixed) + cross-doc consistency verified across 16 axes
- Source code (Agent C): 1 MAJOR (`state: any`, fixed) + 1 MINOR (version output, fixed) + spec-code alignment 98% (TODO retry-with-backoff, ablation roadmap intentional)
- Hooks (Agent D): bash/PowerShell parity verified across 4 hook files; security minor (UUID-bounded SESSION_ID, defensive escape deferred to v0.2)
- Plugin/agents/commands/mirror (Agent E): 1 BLOCKER (plugin.json version, fixed) + 1 MINOR (frontmatter name, fixed) + mirror byte-identity verified
- Web Viewer (Agent F): 1 MINOR (Nav Roadmap, fixed) + security/type/fallback/PII all clean
- Experiments (Agent G): 0 issues; decision-logs hold up to skeptical review
- CI/infra (Agent H): 1 BLOCKER (lockfile drift, fixed) + 1 MINOR (bug.yml, fixed)
- Hackathon docs (Agent I): 1 MAJOR (EXECUTION-PLAN header HEAD stale, fixed) — internal only, not in npm tarball
- Live npm registry vs repo (Agent J): published 0.1.1 verified via `npm view`, gitHead matches, lockfile drift is the only repo-side issue (now resolved here)

False positives correctly identified by validation: 2 (PRIVACY.md timestamp — content unchanged so timestamp legitimate; README cache hit `≈95%` — uses approximation symbol, intentional rounding from measured 95.9%).

## [0.1.1] — 2026-04-24

### Added
- `docs/diagrams/architecture.svg` — static SVG flowchart for npm.com and other markdown viewers without Mermaid support. Generated via kroki.io public render service from the same Mermaid source.
- `docs/diagrams/architecture.mmd` — Mermaid source backup (single source of truth for both the README codeblock and the SVG).
- `.gitignore`: `.npmrc` defense layer (prevents publish-token leakage if a user puts a token there during local publishing).

### Changed
- `README.md` How-it-works section: SVG image embedded inside a collapsed `<details>` block as a fallback for npm.com / non-Mermaid viewers. The Mermaid codeblock remains the default rendering on GitHub (preserves native theme + zoom + interactive layout).
- `README.md` install paragraph: removed the hardcoded "current version `0.1.0`" — points to CHANGELOG.md instead, so future patches don't drift README.

### Internal
- No runtime code changes. `dist/` is regenerated from the same TypeScript source as `0.1.0`.
- Tarball remains ~62.5 kB, 45 files (no functional surface added).

## [0.1.0] — 2026-04-24

### First npm publish
- `@chanjoongx/reflect@0.1.0` published to npm registry: scoped, public, `latest` tag.
- 45 files, ~62.5 kB packed / ~203 kB unpacked.
- Bare `npm install @chanjoongx/reflect` works (matches sister package `stetkeep@0.4.6` install pattern).

### Pivot from prerelease label
- Initially scaffolded as `0.1.0-alpha.1` (D1 baseline). Pre-publish review: pivoted to `0.1.0` after observing that `stetkeep` (sister npm package by same author) ships bare, and that `0.x` semver itself already signals "expect changes before 1.0" — making the explicit `-alpha.N` suffix redundant honesty + adding install-command friction (`@alpha` tag required for prerelease).
- All install commands across README, docs, and Viewer install page updated to bare `npm install @chanjoongx/reflect`.

### Pre-publish hardening
- 5 missing files added to `package.json` `files` field: `.env.example`, `.claude/settings.example.json`, `.claude/rules/reflect-rules.md`, `hooks/reflect-utterance.{sh,ps1}`. Without these, README's post-install copy instructions would silently fail.
- Removed `main` and `types` fields (CLI-only package; pointing to non-existent `dist/index.js` would have been misleading).
- Removed `bin/` from `files` field (kept `dist/` only — no need to ship the TypeScript source duplicate of `dist/bin/reflect.js`).
- Korean-language drift in 6 tracked files translated to English (CHANGELOG entries + docs footers + `src/opus-reflection.ts` critical comment + `.gitignore` section headers). GitHub text files now 100% English (`ripgrep` Hangul range = 0 matches across `git ls-files`).

### See [0.1.0-alpha.1] section below for full D1-D5 build progress.

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

- ✅ Attended Tarek AMA (Discord #hackathon-stage)
- ✅ Directly verified Anthropic API spec (platform.claude.com fetch) — `output_config.effort` accepted, `thinking.effort` rejected (extended-thinking page outdated)
- ✅ L1 token padding 4,741 (≥ 4,096 cache floor) — resolved D1 silent cache miss (2,736 < 4,096)
- ✅ Cache hit rate 95.9% measured (D2 Entry #003) + cost $0.009 warm
- ✅ `src/revert-detector.ts` Tier 1+2 production shell impl (canonical)
- ✅ `src/context-assembler.ts` real data sources (no stubs)
- ✅ First real E2E (DOGFOOD #004): full cycle hook → trigger → API call → guidance.md write
- ✅ Hook cross-platform fix: Windows git-bash missing jq+bc — pure-bash integer arithmetic (weights × 100) + grep/sed fallback rewrite

### D3 Progress (2026-04-23)

- ✅ Attended Michael Cohen Managed Agents session → Q12 decision: Option B (raw API + single-shot)
- ✅ `hooks/reflect-utterance.sh` + `.ps1` — Tier 3 utterance regex (UserPromptSubmit hook, NOT PostToolUse)
- ✅ `src/guidance-injector.ts` completed + lifecycle (overwrite on trigger, delete on session end)
- ✅ `src/logger.ts` opt-in `.reflect/session-log.jsonl` + 168h auto-prune
- ✅ All `bin/reflect.ts` CLI subcommands working (init/status/manual/log/off/on)
- ✅ FAILURE-MODES Scenario 1 (cold-start sessions) analysis complete — Two-layer safety net + 5 edge cases + mock test seq

### D4 Progress (2026-04-24)

#### D4 morning (3 commits pushed)
- ✅ `4c39193` — ARCHITECTURE drift 10 items + README v1.0 (4-section + 6 details) + REFLECT.md `output_config.effort` fix (removes judges copy-paste 400-error risk) + spec-reality alignment
- ✅ `c12db62` — CI hook smoke-test env-var prefix fix + state.json content assertion + Tier 3 step
- ✅ `9e67b14` — new `docs/measurements.md` + 14 public MD links repointed to hackathon/ (prevents GitHub 404)
- ✅ Ablation 1 prompt Alt #1 swap (3-file cross-file truncation, 8 sites, no L1 cache landmine) — original D4-PREP "shared prompt-building helpers" was contrived per 3-round agent verification reject
- ✅ GitHub repo state fix: Linguist detected (TS 46K / Shell 29K / PS 23K / JS 11K), description + 15 topics set, `[branch "main"]` tracking config wired

#### D4 catch-up session (5:08-7:00 PT, 1 commit pushed)
- ✅ `01ed845` — `experiments/ablation-with-without.md` sync to D4 reality (Cond A/B labels FIXED + early-shift schedule + coin flip seed `$RANDOM=21483` odd → Run 1=Cond B / Run 2=Cond A)
- ✅ Coin flip + ablation prep: `.env` `REFLECT_DISABLED=1` + `REFLECT_LOG_ENABLED=1` set, `.reflect/` cleared, ablation files synced
- ✅ 19 hackathon/*.md drift fix sweep (~50 Edits) — DEMO/COST/SUBMISSION/ACCEPTANCE-MATRIX/EXECUTION-PLAN/D4-PREP/FAILURE-MODES/DOGFOOD/CLAUDE/6-LAB/SUBMISSION-CHECKLIST/PII-AUDIT/HACKATHON/JUDGES/APPLICATION/OFFICE-HOURS/DISCORD-INTEL/RESEARCH-FINDINGS/NEXT_SESSION
- ✅ New `hackathon/BRAIN-CHECKSUM.md` — cross-file spec consistency map (17 row Tier 1/2/3) + verification commands + self-limitations + v1.1 path
- ✅ Cross-file consistency reconciled (10 axis): DOGFOOD count / Cost figures / Cache hit / output_config.effort / Auto mode / Managed Agents Option B / Ablation A/B scenarios / D4 morning commits / ACCEPTANCE 19/30 / D5 deferrals

#### D4 catch-up second-pass (post-push, 1 commit pushed)
- ✅ `ec3cd2e` — 21 un-swept .md file audit (root + docs + .claude + commands + agents + experiments) + 5 critical fix (CHANGELOG + docs/measurements + docs/api-cost-economics + docs/reflection-prompt-design + experiments/ablation-components)

#### D4 catch-up third-pass final (1 commit pushed)
- ✅ `314f858` — .gitignore review + 3 safety-net entries (.claude/projects/ for PII, *.tgz, .npm/)

#### D4 afternoon — Ablation-drop pivot (1 commit pushed)
- ✅ `0d6e8d1` — Ablation 1+2 deferred to v1.1 with unified methodological decision-log at top of `experiments/ablation-with-without.md` + companion note in `ablation-components.md`. Rationale: vibecoding workflow mismatches revert-per-hour metric + same-task assumption breaks + N=2 self-experiment unfalsifiable + 6h opportunity cost > qualitative evidence ROI
- ✅ Cascaded across 9 hackathon/*.md: EXECUTION-PLAN D4 header + NEXT_SESSION D5 rewrite + DEMO-SCRIPT Scenario B single-path + ACCEPTANCE-MATRIX T1 recast + BRAIN-CHECKSUM T3.2 RESOLVED + SUBMISSION-WRITEUP 3 fills + COST-REPORT D4 revised + SUBMISSION-CHECKLIST §9 updated + PII-AUDIT incident log + DOGFOOD F4 dev-finding
- ✅ `.env REFLECT_DISABLED=1` removed → reflect ON for remainder of week

#### D4 evening — /web/ Viewer build (3 commits pushed)
- ✅ `decca11` — Localhost-only Next.js 16 Viewer (5 routes: /, /reflections, /patterns, /install, /roadmap). 58 files, 4139 insertions. Built via 6-Lab parallel agent dispatch. Stack: Next.js 16.2.4 + React 19.2.4 + Tailwind v4 + framer-motion. Security: `next dev -H 127.0.0.1`, CSP, server-only file reads, static filename allowlist, PII redactor on every read, rehype-sanitize markdown
- ✅ `639fe6a` — Added `npm run viewer` root alias (build+prod mode, RAM-safe) + `viewer:dev` (dev mode, RAM-heavy)
- ✅ `53e75ca` — CSP dev-mode fix (unsafe-eval + ws) for Turbopack HMR — React Fast Refresh compatibility
- ✅ **E2E verified D4 10:18 PT on CJ live session** — 3× `git restore README.md` → cum_x100 0→100→200→fire+reset+cooldown5 → session-guidance.md generated → Opus 4.7 correctly identified "manual bypass, empty diff, not user pushback" + FT-high safety net engaged. **DOGFOOD Entry #005 (first organic hook fire, not smoke test)**

### D5 Progress (2026-04-25 — partial, D6 ongoing)

#### D5 — Scenarios 2/3 real-session + DEMO-SCRIPT fill + Korean-to-English translation (1 commit pushed)

- ✅ **Scenario 2 (FAILURE-MODES §2) real-session — FIRE at T5, FT:high confirmed** (DOGFOOD #006)
  - Session `e9d9fca8-...`, cum climbed 0 → 50 (T3 "Wait,") → 150 → 200 (T5 "No,") → 300 → **FIRE** at T5 PostToolUse
  - Reflection output: causal pattern + question-framed adjustment + confidence medium (honest under-claim) + FT **high**
  - Cost $0.0647 cold, latency 5296ms
  - **NEW finding (v0.2 roadmap)**: path-scoped rule delivery gap — guidance file generated correctly but not auto-loaded for root-level files. `.claude/rules/reflect-rules.md` targets `src/**, lib/**, app/**, packages/**` only; README.md is repo-root → rule auto-load did not trigger → Claude did not read `.reflect/session-guidance.md`. **Delivery gap, not content gap.** Fix candidates: broader rule scope, session-start banner when session-guidance.md exists, Claude Code native "latest guidance" surface
  - Bonus: Claude cited reflect mechanism during T6 (read README.md during T1) — self-aware harness demo narrative material
- ✅ **Scenario 3 (FAILURE-MODES §3) real-session — BLOCKED by Claude pre-execution reasoning** (DOGFOOD #007)
  - Session `5843868a-...`, hook never fired (cum=50 end, Tier 3 "Wait," only). Claude (Opus 4.7) refused 4 of 7 prompts before tool execution:
    - T2: "Markdown has no $THRESHOLD interpolation — extracting literal makes doc factually wrong"
    - T3/T5/T7: "git restore would wipe the literal you just said to keep — contradiction"
  - Root cause: Scenario 3 design flaw — Markdown file target made env-var extraction semantically meaningless; T2 refusal cascaded to subsequent contradiction detections
  - **Unexpected finding**: "Two complementary safety layers" narrative
    - Layer 1 = Claude intrinsic pre-execution reasoning (catches turn-visible contradictions, semantic mismatches)
    - Layer 2 = reflect post-hoc metacognition (catches multi-turn-only accumulated patterns)
    - Scenario 2 demonstrated Layer 2; Scenario 3 accidentally revealed Layer 1. Complementary, not redundant
  - Domain-awareness test deferred to v1.1 with specific rerun plan (real code fixture `experiments/fixtures/kyc-validator.ts`, internally consistent sequence)
- ✅ DEMO-SCRIPT 02:00-02:30 `[N]` placeholder filled with actual counts: **6 reflections total** (1 changed next move, 1 blocked by delivery gap, 4 smoke tests + 1 complementary-layers scenario)
- ✅ DOGFOOD #006 + #007 + F4 dev-finding all filled
- ✅ FAILURE-MODES §2 + §3 real-session experiment-result blocks filled + experiment-design caveats added (honest framing of prompt-injection concerns)
- ✅ `587d7bc` — Korean-drift-to-English translation pushed (CHANGELOG D2-D4 progress + docs footers + src/opus-reflection critical comment + .gitignore 4 lines). **GitHub repo text files 100% English verified** (ripgrep Unicode Hangul range `[\u{AC00}-\u{D7A3}]` = 0 matches across git ls-files)
- ✅ README.md working tree restored clean post-Scenario-3

### Honest gaps (D5 afternoon, D6 remaining)

- ⏳ Demo recording + edit + PII scrub + YouTube unlisted upload (D6 morning/afternoon)
- ⏳ SUBMISSION-WRITEUP Demo URL fill + Problem Statement final + How-heard final (D6 afternoon)
- ⏳ Submission form (D6 15:30-17:00 PT, 5 PM PT deadline)
- ⏳ Michal session attendance if possible (D6, timing TBD)
- ⏳ npm publish (post-hackathon decision, not submission blocker)

### Status: pre-alpha, hackathon D5 afternoon (working code + Viewer + 2 real-session experiments + all repo text files English, 11 D4 + 1 D5 commits all pushed `587d7bc`)

**Acceptance**: ~22-23/30 fully + 3 partial effective (C1 Scenario 2 real-session done w/ FT:high + Scenario 3 complementary-layers finding documented; C3/T4 DOGFOOD 7 real entries + 4 dev findings = 11 total, close to 12 target; D6 recording pushes to 25+).
**Cumulative cost**: D3 EOD $18.78 / $500. D4 actual ~$25-35 (console reconciliation pending). D5 so far ~$1-2 (Scenario 2 reflect fire $0.0647 + Claude Code sessions ~$1.18). Well under budget with ~$450+ remaining.
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
