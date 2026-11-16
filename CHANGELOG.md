# Changelog

All notable changes are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Semver: MAJOR.MINOR.PATCH.

---

## [Unreleased]

### Measured, not shipped

- My own answers on the 78 benchmark turns where the reference labels and a judge disagree (`bench/variants.ts --adjudicated`): with them, 111 of the 837 turns are pushback, not 141. The 0.4 request finds 85 (plugin) and 89 (npm) at 85.0% and 85.6% precision, and the 0.3 request finds 75 at 96.2%. 0.4's "same precision" holds against the model labels only; against these answers its F0.5 is 4 to 6 points lower (intervals include zero), and 21 of the npm command's 30 trigger fires rest on real pushback against 20 of 21 before. FINDINGS §16.
- `bench/note-effect.mjs --script subtle`: the pushback names only the files to undo and never states a rule, and the project's `CLAUDE.md` invites the agent to stray. With a Haiku 5.5 agent (22 runs per arm, $2.09), the note went out in 21 of 22 sessions with the plugin, and after a compaction the agent changed only the named file in 63 of 66 tasks, against 28 of 63 without the plugin; 10 of 21 sessions without it went back to the CLAUDE.md checklist and none with it did (p = 0.0002). With an Opus 5.5 agent (9 runs per arm, $19.33), 7 of 9 runs without the plugin strayed again after the first correction and none of the 9 with it did (p = 0.0023), so no note was written; a new arm `commands` (the plugin's command list, no hooks; $10.09) strayed in 5 of 9, so the `/brain-reflect` description alone does not explain it. `--max-usd` stops starting runs at a spending cap.

---

## [0.4.0] 2026-11-16

The judge finds more of the pushback: 98 to 101 of the benchmark's 141 turns, up from 76, at the same precision. The plugin gains `/reflect-status`, and the npm command can wire its own hooks.

### Changed

- **The judge's schema travels in the message for both forms.** The npm command used to ask for the verdict through structured output (`output_config.format`). On the 837-turn benchmark that found 76 of 141 pushback turns with 2 false alarms (97.4% precision, 53.9% recall). The same rubric with the schema at the end of the message, read tolerantly, found 101 with 3 false alarms (97.1%, 71.6%), F0.5 +6.8 points (95% interval +3.2 to +10.8, resampled by session). The plugin's request, which also carries Claude Code's identity line, found 98 with 2 (98.0%, 69.5%), +6.7 (+3.5 to +10.4). The rubric itself is unchanged. `judgePair` takes `format: "schema" | "prompt"`; the hooks send `prompt`, and `bench/label.ts` keeps `schema` so its cached labels stay comparable.
- **The plugin's judge runs at effort low**, as the benchmark measured it. 0.3.0 left the effort to the model's default.
- With the 0.4 requests the default trigger fires 26 times (plugin, 25 on real pushback) or 30 times (npm, 29) over the benchmark and reaches 18 or 20 of the 26 sessions that should get a note, against 21 fires and 17 sessions before.

### Added

- **`/reflect-status`** in the plugin: messages counted and judged, pushback by kind, notes written, spend against the cap, the note in force and how many more messages it lasts, and why reflect stopped if it did. It reads memory only and calls no model. The plugin now calls five engine functions; the fifth is `$.command.register`.
- **`reflect init --write`** merges the npm command's hooks into the project's `.claude/settings.local.json`, keeping other settings and hooks, replacing reflect entries from an earlier install and leaving a `.bak` copy. `--remove` takes them out. It warns when the bundle path points into npm's temporary cache and when git does not ignore the file.
- `bench/variants.ts` and `bench/judge-variants.ts`: judge the benchmark with a named rubric and request shape, split the sessions into a dev half and a held-out half by a hash of the session id, and write the misses of a run as a sheet to read.
- `bench/note-effect.mjs`: scripted live sessions with and without the plugin, to see whether a note changes what the agent does after a compaction.

### Fixed

- A judge answer the plugin could not read stopped reflect for the rest of the session. It now skips that one message and says so in the debug log.
- The plugin judged a bare slash command such as `/review` as if it were the developer answering the agent. A slash command with nothing typed after it is now passed on unjudged.

### Measured, not shipped

- Three rubric edits aimed at the misses that remain, mostly messages that call the delivered work not good enough and ask for more, were tried on the dev half only. They raised recall there from 71.9% to between 76.6% and 81.3%, but precision fell from 97.9% to between 87.5% and 91.1% and F0.5 dropped. The reference labels themselves split on such messages. The rubric stays as it was, and the held-out half was not used to choose anything.
- Scripted live sessions with and without the plugin (`bench/note-effect.mjs`) showed no difference. With a Haiku 5.5 agent corrected twice on code style and then compacted, all 15 new functions followed the developer's rules in each arm (5 runs each), because Claude Code's compaction summary kept the rules. One Opus 5.5 run without the plugin, corrected twice on which files to touch, kept to the named files after compaction on its own. Whether notes help in long sessions with implicit pushback is still unmeasured. Details in `bench/FINDINGS.md` §15.

---

## [0.3.0] 2026-11-16

The plugin directory refused 0.2.3 because its hooks were of type command and its code was `.mjs` files, both of which it now takes only from Verified organizations. 0.3.0 rebuilds the plugin as a mod, which Claude Code loads and runs itself. The npm package works as before.

### Changed

- **The plugin is a mod.** `plugin/hooks/hooks.json` names one module, `hooks/reflect.ts`, and declares no hooks of any type. Nothing runs under `node`, no process is started, and the plugin no longer needs Node.js. The module hooks five events (`session.start`, `session.end`, `prompt.submit`, `tool.call`, `turn.complete`) and calls four things in Claude Code: `$.model.complete`, `$.clock.after`, `$.ui.log` and `$.session.usage`.
- **No API key.** The judge and the reflection run through Claude Code's own model client for the session, on the session's account and provider. Claude Code counts the calls in the session's cost, and `/usage` shows the share from mods. The `anthropic_api_key` setting is gone; the reflection model and the spend cap remain. If a model's full id is not allowed, reflect retries once with its alias.
- **Nothing on disk.** The plugin keeps its state in memory for the session and drops it at the end: labels, the last 12 judged messages with their summaries, the agent's current turn and the current note. It writes no `.reflect/` folder. A resumed session starts fresh.
- **Developer messages only.** Background task notifications, scheduled prompts, messages from other sessions and prompts other plugins queue are passed on unjudged, as are subagents' tool calls and answers.
- **Compaction without the transcript.** While a note is in force, a drop of the session's context size below half (from at least 20,000 tokens) sends it again. 0.2 learned of a compaction from a `SessionStart` hook.
- **One generated file.** `npm run build` writes `plugin/hooks/reflect.ts` from `src/mod/reflect.ts` and the 11 `src/` modules it imports, unminified, so the plugin judges and reflects with the same prompts, trigger and redaction as the npm package. `npm run check:bundle` fails if that file is stale, if any plugin file is a type the directory does not take, or if the module reaches for Node, the network, files, processes, the environment, stored data or the transcript.
- The judge's JSON schema now travels in the prompt, because the engine's completion call has no structured-output option, and the answer is parsed with a code fence or a sentence around it allowed.
- The plugin folder is 8 files and 109 KB (0.2.3: 23 files, 546 KB).

### Removed

- `plugin/hooks/reflect-hook.mjs`, `plugin/hooks/lib/` and `plugin/hooks/THIRD_PARTY_LICENSES.txt`: the plugin bundles no third-party code. `src/plugin-entry.ts` and `src/api/credentials.plugin.ts` went with them.
- For the plugin, `.reflect/disabled` and the `REFLECT_*` variables, which a mod cannot read. Disable the plugin in `/plugin`, or for one project under `enabledPlugins` in `.claude/settings.local.json`. The npm command still honors them.

### Verified

- 157 tests, 15 of them the mod against a fake engine. `claude plugin validate --strict` passes for `plugin/` and the marketplace.
- A live `claude -p --plugin-dir ./plugin` session of four messages: three Claude Haiku 5.5 judgements (0.9 to 2.0 s), one Claude Opus 5.5 reflection (9.1 s, $0.0248), and the note delivered with the fourth message, shown to the developer as a transcript line.

## [0.2.3] 2026-11-16

Changes from the plugin directory's validation report for 0.2.2.

### Changed

- **The plugin is now `chanjoongx-reflect`.** The directory reserves `reflect` for an existing connector of that name. The command is `/chanjoongx-reflect:brain-reflect`. If you installed `reflect@chanjoongx`, remove it in `/plugin` and install `chanjoongx-reflect@chanjoongx`. The npm package and the repository keep their names, and the notes still start with `reflect:`.
- **Two bundles.** The plugin's hooks are built from `src/plugin-entry.ts` and hold no CLI code. The npm package's `reflect` command is built from `src/entry.ts` into `dist/reflect.mjs` when the package is packed, and the package no longer contains `plugin/`. If you wired the hooks by hand, run `reflect init` again for the new path.
- **Named environment reads.** The plugin's hooks read 13 environment variables, each by name: the ones Claude Code passes a plugin's hooks and reflect's optional `REFLECT_*` switches. The build fails if the plugin's bundle reads any other.
- **No credential code in the plugin.** In the plugin's copy of the Anthropic SDK, the build replaces the modules that read environment variables, token files and login profiles. The key from the plugin's settings is the only one it can use, and it goes only to `https://api.anthropic.com`.
- **`/chanjoongx-reflect:brain-reflect`** is a prompt with no shell line and no `allowed-tools`. The agent reflects from the conversation, starting from reflect's latest note if one was delivered.
- **Icon.** `plugin/icon.png` replaces `plugin/icon.svg`, a file type the directory will stop accepting. The SVG source moved to `docs/diagrams/icon.svg`.
- The plugin folder is 23 files and 546 KB (0.2.2: 24 files, 572 KB), and none of its files starts with `#!`.

### Removed

- `reflect manual --plugin`, which only the old `/reflect:brain-reflect` used.

## [0.2.2] 2026-11-16

A review against the plugin directory's policy, before the new submission.

### Changed

- **No transcript.** The hooks no longer open the session transcript. The `tool` hook records each tool call's name and target, two new hooks record failed calls (`PostToolUseFailure`) and the agent's final reply (`Stop`, from `last_assistant_message`), and the judge reads that record once and deletes it. Tool output and file contents are never recorded. Subagent tool calls are ignored. A bare `/compact` no longer counts as the developer answering, so the turn stays open across it.
- **Less kept.** `events.jsonl` no longer holds message text. The judged message, the turn summary and the judge's quote go to `turns/<prompt id>.json`, and only the developer's last 12 messages keep theirs, the most a reflection or `/reflect:brain-reflect` reads back. An agent turn no judge reads is deleted after a day.
- **Plugin settings.** As a plugin, reflect does not read the project's `.env`, its settings take precedence over `REFLECT_MODEL` and `REFLECT_MAX_USD_PER_SESSION`, and it removes every `ANTHROPIC_*` variable from its own process before the first API call, so the SDK cannot pick up custom headers or another endpoint.
- **The whole note.** The message the developer sees carries the full note the agent received, and says so when a note is sent again after a compaction.
- **`/reflect:brain-reflect`** runs only its own command (`allowed-tools` is narrowed to it) and never calls the API, whatever key is around.
- **Redaction** matches any email address and US and international phone numbers. The shipped redactor no longer contains anything specific to the author.
- **Viewer.** `web/` reads a verdict's text from `turns/` when the log line has none.

### Removed

- The SDK's agent toolset module, which reflect never calls and which carries shell and download code, is replaced by an empty module in the bundle.
- `export-subst` and other content rewriting attributes in `.gitattributes`, which stop the plugin directory from validating the repository.

## [0.2.1] 2026-11-16

Changes for Anthropic's plugin directory, which declined 0.1.4.

### Changed

- **The plugin is the `plugin/` folder.** Claude Code installs only that folder: the manifest, the hook bundle, the `/brain-reflect` command, a README and the privacy policy. The source, the benchmark, the viewer and the dev tooling stay in the repository. Installing no longer pulls the 75 MB of build tools that Claude Code fetched because `package.json` and `package-lock.json` sat at the plugin root.
- **One credential as a plugin.** The hooks use only the API key from the plugin's setting and send it only to `https://api.anthropic.com`. They ignore `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `.env` keys and `ant auth login` profiles. Hooks wired by hand and the CLI keep the old order.
- **You see every note.** When the agent receives a note, the hook also shows it to the developer as a message with the pattern and the adjustment.
- **`/reflect:brain-reflect` makes no API call.** Claude Code does not pass a plugin's key to its commands, so the command lists which recent messages read as pushback and the agent writes the reflection. The command no longer passes its argument to a shell. `reflect manual` in a terminal still calls the reflection model.
- **Smaller bundle.** The SDK is loaded in three pieces, so the bundle keeps only what reflect calls: 530 KB in 19 files, the largest 154 KB, where 0.2.0 had a 1 MB chunk. The build fails if any file reaches 256 KiB.

### Added

- `plugin/icon.svg` for the directory listing.

## [0.2.0] 2026-11-16

0.1.4 never fired. Over 109 real sessions in July it triggered zero reflections, and on a labelled benchmark of 837 developer turns it found 0 of the 141 that were pushback ([`bench/FINDINGS.md`](bench/FINDINGS.md)). 0.2 replaces the detector, the reflection and the delivery.

### Changed

- **Detection.** Each developer message after the agent's first reply is judged with the agent's previous turn beside it (read from the session transcript) by Claude Haiku 5.5 with structured output. Labels follow SWE-chat: correction, rejection and failure report count as pushback. The git and regex signals are gone. Against Claude Opus 5 labels on the 837-turn benchmark it reaches 97.4% precision and 53.9% recall per turn (76 of 141 pushback turns found, 2 false alarms), against 0 of 141 for 0.1.4. The Haiku 4.5 judge measured in August reached 87.0% and 47.5%.
- **Trigger.** A sliding window replaces the weighted counter: two pushbacks within six developer turns, then a three-turn cooldown (`REFLECT_POLICY` picks another policy). Replayed over the benchmark with the Haiku 5.5 verdicts it fires 21 times in 17 sessions, all on turns the reference calls pushback, and reaches 17 of the 26 sessions where the reference labels trip it (`npm run bench:sim -- --run h55`).
- **Reflection.** Claude Opus 5.5 with adaptive thinking reads exactly the turns that tripped the trigger, including the developer's words and the judge's evidence. It runs in a detached worker process, so it survives `claude -p` ending the hook when the agent answers. Two live runs took about 10 s and cost $0.020 and $0.029. The output adds a counter-hypothesis, a check to run first, and an expiry of 3 to 12 turns.
- **Delivery.** The note reaches the agent once, as `additionalContext` on its next tool call or the developer's next prompt, and is re-delivered after compaction while it is in force. 0.1 wrote a file and relied on a path-scoped rule to load it.
- **One implementation.** The two bash and two PowerShell hooks and the TypeScript reference are replaced by `src/`, bundled into the committed `hooks/reflect-hook.mjs`. A plugin install needs only `node` 20. The Anthropic SDK sits in a chunk that only the model calls load, so the hooks that run on every tool call stay light.
- **State.** An append-only event log per session in `.reflect/sessions/`, a lock around firing, a claim file so that parallel tool calls deliver a note once, `.reflect/.gitignore`, and pruning 7 days after a session's last event. A verdict that arrives late cannot fire a second reflection on turns that already fired.
- **Models and SDK.** `@anthropic-ai/sdk` 1.5 (bundled; no runtime dependencies). Pricing table updated to 2026-11-16 rates.
- **Viewer.** The local Next.js viewer in `web/` reads the 0.2 session logs: each turn with its verdict, the trigger window, fires, notes and how each was delivered, and spend against the cap.
- **CLI.** `reflect status`, `manual`, `doctor`, `init`, `on`, `off`. `/brain-reflect` works without an API key by asking the agent to reflect on its own context.

### Added

- `bench/`: the correction-detection benchmark (extract, label, score, report, review) and `bench/session-sim.ts`, which replays trigger policies over cached verdicts without API calls.
- Plugin `userConfig` for the API key (kept in the system credential store), the reflection model and a per-session spend cap (default $0.50).
- `.claude-plugin/marketplace.json`, so `/plugin install reflect --marketplace chanjoongx/reflect` works.
- `hooks/THIRD_PARTY_LICENSES.txt` for the bundled packages.
- CI on Linux (node 20, 24) and Windows (node 24): unit tests, bundle freshness, and a smoke test that runs the bundle under plain `node`.

### Fixed

- On Windows, Node 24 aborted with a libuv assertion (`!(handle->flags & UV_HANDLE_CLOSING)`) when the hook exited right after an API call. The entry point now sets the exit code and lets the process end on its own.
- `<ide_opened_file>` and `<ide_selection>` blocks were left in developer messages, because the pattern in `src/transcript/parse.ts` was built in a template literal that dropped its backslashes. The August benchmark data contains none of these tags, so its numbers are unchanged.

### Removed

- `hooks/*.sh`, `hooks/*.ps1`, `bin/reflect.ts`, `src/{context-assembler,opus-reflection,guidance-injector,logger,revert-detector,types}.ts`.
- The `reflection-orchestrator` agent, the `.claude/` mirrors, `.claude/rules/reflect-rules.md` and `.claude/settings.example.json`.
- Runtime dependencies `dotenv` and `stetkeep`.
- The `bin/` directory at the repository root, which Claude Code treats as plugin executables.

### Known gaps

- No human has checked the reference labels yet, and the rubric, gate and trigger were all chosen on the benchmark corpus.

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
