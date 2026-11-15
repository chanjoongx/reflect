# Contributing to reflect

The contributions that help most right now are cases where reflect got it wrong, written up so they can be checked.

## Most useful contributions

### 1. Misjudged messages and bad notes

Use the [reflection quality issue template](.github/ISSUE_TEMPLATE/reflection_quality.yml). Useful reports include:

- a message the judge called pushback that was not, or real pushback it missed (copy the `verdict` line from `.reflect/sessions/<id>/events.jsonl`, after removing anything private);
- a note that was generic, wrong or harmful, with what it should have said.

The benchmark behind reflect's numbers comes from one developer's sessions, so cases from other people and other languages are worth more than anything else here.

### 2. Running the benchmark on your own sessions

[`bench/README.md`](bench/README.md) explains how to build a corpus from your own Claude Code transcripts and score the judge on it. Labelling calls the API and costs money (about $25 for a full five-run pass over ~840 pairs). If you do this, please share the aggregate results, not the transcripts.

### 3. Changes to the judge or the reflection prompt

The judge's rubric and rendering are part of `judgeFingerprint()` in `src/detect/judge.ts`. Changing them invalidates every cached label, so a rubric change needs new benchmark numbers in the PR (precision, recall and F0.5 per turn, plus the session replay from `npm run bench:sim`). A change to the reflection prompt in `src/reflect/reflection.ts` needs before-and-after notes on the same pushback turns.

PRs that change either prompt without that evidence are unlikely to merge.

## Local development

```bash
git clone https://github.com/<your-username>/reflect.git
cd reflect
npm install
npm test               # typecheck and node:test, 143 tests; the model calls are faked
npm run build          # bundles src/ into plugin/hooks/ (the plugin) and dist/ (the npm command)
npm run check:bundle   # fails if the committed bundle does not match src/
npm run smoke          # runs both bundles under plain node, as Claude Code and npm do, with no API key
npm run mirror-check   # src/redact.ts must match web/lib/redact.ts
```

To try your working copy in a real session, run `claude --plugin-dir ./plugin` from the repository root. Hooks wired by hand in a gitignored `.claude/settings.json` should point at `dist/reflect.mjs` after `npm run build`: the plugin's bundle reads its key only from the plugin's settings.

None of these commands calls the API. To exercise the judge or the reflection for real, enter a key in the plugin's settings, or put one in your environment when you wire the hooks by hand; the cost lands on that key.

### Rules for the bundle

- Edit `src/`. Never edit `plugin/hooks/reflect-hook.mjs` or `plugin/hooks/lib/` by hand.
- After any change under `src/`, run `npm run build` and commit the rebuilt bundle with the source change. A plugin install copies `plugin/` with no build step, so the committed bundle is what users run. CI runs `check:bundle` and fails on a stale one.
- The package has no runtime dependencies. The Anthropic SDK is bundled into chunks under `plugin/hooks/lib/` that only the judge and the reflection load. Keep it that way, because the `prompt` and `tool` hooks run on every message and tool call. No bundled file may reach 256 KiB; the build fails if one does.
- The plugin's bundle starts at `src/plugin-entry.ts` and may read only the environment variables it names; the build checks the bundle against `PLUGIN_ENV` in `scripts/build-hook.mjs` and fails on any other read, on a shebang, and on the SDK's credential code. Code that the plugin's hooks reach must take its settings as an argument, not from `process.env`. The CLI (`src/cli/`) and the `.env` loader (`src/hook/project-env.ts`) are for the npm command only.
- Keep everything the plugin runs inside `plugin/`, and keep `package.json` and `package-lock.json` out of it. When a plugin's root has both, Claude Code installs the lockfile's packages on every user's machine.
- `src/redact.ts` is the canonical redactor and `web/lib/redact.ts` is a copy for the viewer. Edit the first and copy it over.
- The version lives in `src/version.ts`, `package.json` and `plugin/.claude-plugin/plugin.json`. A test fails if they disagree.

CI (`.github/workflows/ci.yml`) runs `npm test`, `check:bundle` and `smoke` on Ubuntu with Node 20 and 24 and on Windows with Node 24, and `mirror-check` on Ubuntu.

## Process

### Small contributions (issue templates, doc fixes, typos)
1. Fork
2. Edit
3. Open a PR

### Medium contributions (a prompt change, a new trigger policy)
1. Open an issue first describing the change
2. Wait for an acknowledgment from the maintainer
3. Open a PR with the implementation, tests and evidence

### Large contributions (persistence, new hook events, other agents)
1. Open an issue with a detailed proposal
2. Discuss and agree on scope
3. Send PRs in phases (interface first, implementation second)

## Style

- **Honesty first.** Never claim a behavior the code does not enforce, and report numbers with the model and data they were measured on.
- **Keep the structured output schemas.** The judge's `VERDICT_SCHEMA` and the reflection's `REFLECTION_SCHEMA` are what the parsers rely on.
- **No emojis in prompts or schemas.** They can disrupt parsing in edge cases.
- **TypeScript strict.** No `any` without a reason, and exhaustive switches.
- **Hooks exit 0.** A failure becomes an `error` event in the session log, never a failed prompt or tool call.

## What we will reject

- Cross-session memory that bypasses the session-local design
- Prompt changes without benchmark evidence
- Telemetry, or any data leaving the machine beyond the judge and reflection calls to the Anthropic API
- State written outside the project's `.reflect/` directory
- Hooks that block a prompt or a tool call (reflect observes; blocking is a different tool's job)
- New runtime dependencies
- PRs that raise per-call cost by more than 20% without a matching quality gain

## Governance

- Solo maintainer (Chanjoong Kim) until traction warrants more
- All decisions traceable through issues and PR comments
- Benchmark results published openly, including the ones that went badly

## Code of Conduct

Be direct. Be kind. Assume good faith. The project's own origin (a human iterating with an AI that kept proposing bad refactors) is a reminder that being wrong is normal.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.
