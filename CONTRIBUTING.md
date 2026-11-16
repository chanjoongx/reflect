# Contributing to reflect

The contributions that help most right now are cases where reflect got it wrong, written up so they can be checked.

## Most useful contributions

### 1. Misjudged messages and bad notes

Use the [reflection quality issue template](.github/ISSUE_TEMPLATE/reflection_quality.yml). Useful reports include:

- a message the judge called pushback that was not, or real pushback it missed (with the npm command, copy the `verdict` line from `.reflect/sessions/<id>/events.jsonl`, after removing anything private; the plugin keeps no record, so describe the message and what the agent had just done);
- a note that was generic, wrong or harmful, with what it should have said.

The benchmark behind reflect's numbers comes from one developer's sessions, so cases from other people and other languages are worth more than anything else here.

### 2. Running the benchmark on your own sessions

[`bench/README.md`](bench/README.md) explains how to build a corpus from your own Claude Code transcripts and score the judge on it. Labelling calls the API and costs money (about $25 for a full five-run pass over ~840 pairs). If you do this, please share the aggregate results, not the transcripts.

### 3. Changes to the judge or the reflection prompt

The judge's rubric and rendering are part of `judgeFingerprint()` in `src/detect/judge-prompt.ts`. Changing them invalidates every cached label, so a rubric change needs new benchmark numbers in the PR (precision, recall and F0.5 per turn, plus the session replay from `npm run bench:sim`). A change to the reflection prompt in `src/reflect/reflection-prompt.ts` needs before-and-after notes on the same pushback turns. Both prompts go into the plugin's module and the npm command alike.

PRs that change either prompt without that evidence are unlikely to merge.

## Local development

```bash
git clone https://github.com/<your-username>/reflect.git
cd reflect
npm install
npm test               # typecheck and node:test, 157 tests; the model calls are faked
npm run build          # writes plugin/hooks/reflect.ts (the plugin) and dist/ (the npm command)
npm run check:bundle   # fails if plugin/hooks/reflect.ts is stale or the plugin breaks a rule
npm run smoke          # runs the npm bundle under plain node, as hand-wired hooks run it, with no API key
npm run mirror-check   # src/redact.ts must match web/lib/redact.ts
```

The mod's tests are in `src/mod/reflect.test.ts` and run it against a fake engine.

To try your working copy in a real session, run `claude --plugin-dir ./plugin` from the repository root. Claude Code may lay type files in `plugin/.claude-plugin/types/` when it loads the mod; that folder is gitignored. Hooks wired by hand in a gitignored `.claude/settings.json` should point at `dist/reflect.mjs` after `npm run build`. The plugin's module is not a command and cannot be wired that way.

None of these commands calls a model. A session started with `--plugin-dir` sends the plugin's calls through that session, and they count toward its cost. With hooks wired by hand, put a key in your environment; the cost lands on that key.

### Rules for the plugin's module and the npm bundle

- Edit `src/`. Never edit `plugin/hooks/reflect.ts` by hand: `npm run build` generates it from `src/mod/reflect.ts` and the `src/` modules it imports.
- After any change under `src/`, run `npm run build` and commit the regenerated module with the source change. A plugin install copies `plugin/` with no build step, so the committed module is what users run. CI runs `check:bundle` and fails on a stale one.
- The mod may import only `src/` modules. The build places each one before the modules that use it and removes its imports and export keywords, so the generated file is one scope: a name declared in two of those modules fails the build.
- `check:bundle` also fails if any plugin file is outside Markdown, text, JSON, YAML and images plus the module, starts with `#!` or reaches 256 KiB, or if the module uses `process`, `Buffer`, `require`, `import()`, `node:` modules, `fetch`, `eval`, a URL, `$.fs`, `$.process`, `$.http` or `$.store`, transcript messages or a fork, calls an engine function other than `$.model.complete`, `$.clock.after`, `$.ui.log` and `$.session.usage`, or exports anything but `register`. Code that the mod reaches must take its settings as an argument, not from `process.env`. The CLI (`src/cli/`) and the `.env` loader (`src/hook/project-env.ts`) are for the npm command only.
- The plugin bundles no third-party code, and the npm package has no runtime dependencies. In the npm command the Anthropic SDK is bundled into chunks under `dist/lib/` that only the judge and the reflection load. Keep it that way, because the `prompt` and `tool` hooks run on every message and tool call.
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
- **Hooks never fail a turn.** In the npm command a failure becomes an `error` event in the session log, and every mode exits 0. In the mod, a hook that throws passes its event on unchanged.

## What we will reject

- Cross-session memory that bypasses the session-local design
- Prompt changes without benchmark evidence
- Telemetry, or any data leaving the machine beyond the judge and reflection calls (through the session's client in the plugin, to the Anthropic API in the npm command)
- State the plugin writes to disk, or state the npm command writes outside the project's `.reflect/` directory
- Hooks that block a prompt or a tool call (reflect observes; blocking is a different tool's job)
- New runtime dependencies, or third-party code in the plugin
- PRs that raise per-call cost by more than 20% without a matching quality gain

## Governance

- Solo maintainer (Chanjoong Kim) until traction warrants more
- All decisions traceable through issues and PR comments
- Benchmark results published openly, including the ones that went badly

## Code of Conduct

Be direct. Be kind. Assume good faith. The project's own origin (a human iterating with an AI that kept proposing bad refactors) is a reminder that being wrong is normal.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.
