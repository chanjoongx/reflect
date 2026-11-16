<div align="center">

# reflect

**A Claude Code plugin that notices when you keep pushing back on the agent, works out why, and tells the agent before its next step.**

[![License: MIT](https://img.shields.io/badge/License-MIT-A78BFA.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@chanjoongx/reflect?color=D4A27F)](https://www.npmjs.com/package/@chanjoongx/reflect)
[![CI](https://github.com/chanjoongx/reflect/actions/workflows/ci.yml/badge.svg)](https://github.com/chanjoongx/reflect/actions/workflows/ci.yml)

</div>

```
/plugin install chanjoongx-reflect --marketplace chanjoongx/reflect
```

---

## Why 0.2 exists

I built reflect 0.1 in April 2026 at the Built with Opus 4.7 hackathon. It counted `git revert`, `git restore`, deleted files and English phrases like "no wait", and when the count passed a threshold it asked Opus 4.7 why the session was going wrong.

Then I measured it on my own work. Across 109 real sessions in July it fired zero times. In August I pulled 837 developer turns from 224 sessions and had Claude Opus 5 label them; 141 were pushback on the agent. The shipped detector caught none of them.

People rarely push back with git. They type "only the parser, please" or "that's not what I asked", often in their own language, right after the agent did something. The signal is in the relation between what the agent just did and what you say next, and 0.1 looked at neither. The full write-up is in [`bench/FINDINGS.md`](bench/FINDINGS.md).

0.2 is rebuilt around that pair.

## What it does

1. **Judges each message.** For every message you send after the agent's first reply, reflect takes the agent's previous turn (its tool calls and its final reply, which reflect records as the turn happens) and asks Claude Haiku 5.5 one question: is this message a correction, a rejection or a failure report, or is it a normal instruction or question? The judge runs on a timer after your message has gone through, so it never holds up your prompt.
2. **Waits for a pattern.** One pushback is normal. When two land within six of your messages, Claude Opus 5.5 reads exactly those turns and writes a short note: what the agent keeps doing, what your pushback is about, what to change for the next few turns, and how the note could be wrong.
3. **Tells the agent once.** The note rides on the agent's next tool result or on your next message. It stays in force for 3 to 12 turns and comes back after a compaction. When the reviewer is unsure, the note tells the agent to ask you before acting on it. Your own words always win.

This is what the agent sees (an example; the wording comes from the reviewer each time):

```text
reflect: the developer has pushed back on 2 of their last 6 turns (turns 4, 6). An outside reviewer read those turns and suggests:

Pattern: Each fix also reformats or renames code in files the developer did not mention.
What the pushback is about: Twice the developer narrowed the change back to src/parser.ts ("only the parser", "leave the tests alone").
Adjustment for the next 6 turns: Edit only the files the developer names. If another file seems to need a change, say so and ask first.
Before applying it: Before the next edit, list the files you are about to touch and check each one was named.

Confidence high, false-trigger likelihood low. It may be wrong if: The developer may want the wider cleanup later, as a separate commit.
Apply the adjustment.

The developer's own words in the current turn take precedence over this note.
```

You see each note too. When the agent receives one, reflect adds the whole note to your transcript in a line that starts with "reflect sent the agent this note:".

The plugin writes nothing to disk. While the session runs it holds in memory the judge's labels, the redacted text of your last 12 judged messages with their summaries, the agent's current turn and the current note, and it drops all of it when the session ends. reflect never opens the session transcript. Nothing is shared between sessions. The npm command keeps the same things on disk, in `.reflect/` in your project, which ignores itself in git; there a session's log (labels, notes, costs) is deleted after 7 days.

## How well it works

The benchmark is 837 turns from 224 of my own Claude Code sessions, collected in August 2026 and labelled by Claude Opus 5. 141 of the turns are pushback. In November I reran the judge on the same turns with the model reflect now ships, Claude Haiku 5.5. Both judges skip turns that have no agent turn before them.

| detector | pushback found (of 141) | false alarms | precision | recall |
|---|---:|---:|---:|---:|
| 0.1.4 as shipped (git reverts + English phrases) | 0 | 0 | n/a | 0.0% |
| judge on Claude Haiku 4.5 (August) | 67 | 10 | 87.0% | 47.5% |
| **0.2 and 0.3: judge on Claude Haiku 5.5** | **76** | **2** | **97.4%** | **53.9%** |

On the same turns Haiku 5.5 scores 9.3 F0.5 points above Haiku 4.5 (95% interval 2.5 to 18.5, resampled by session). Turning on adaptive thinking did not help (93.6% precision, 51.8% recall), so it stays off.

What matters in use is whether a session gets a note at all. Replayed over the benchmark, the default trigger (two pushbacks within six turns) fired 21 times in 17 sessions, and every fire landed on turns the reference labels call pushback. Of the 26 sessions where the reference labels trip the same trigger, it reached 17. With the Haiku 4.5 judge it was 17 good fires of 20, in 15 of the 26 sessions. `npm run bench:sim -- --run h55` repeats the replay without API calls.

The agent's previous turn is what makes this work. In the August runs, hiding it cost the Haiku 4.5 judge 10.3 F1 points (clustered bootstrap interval 1.2 to 19.8; 6.8 once the turns where the judge declined to answer are left out). Showing it the previous turn of a different pair cost 27.6.

I also ran the plugin end to end on 2026-11-16. In a run of the 0.2 plugin, two corrections in a row fired the trigger, Opus 5.5 wrote the note in 10.3 seconds for $0.020, and the agent's next turn did the check the note asked for. The 0.3 mod ran under `claude -p --plugin-dir` with four messages in one process: three Haiku 5.5 judgements took 0.9 to 2.0 seconds each, Opus 5.5 wrote the note in 9.1 seconds for $0.0248, and the note reached the agent with the fourth message and showed up in the transcript.

What these numbers do not tell you:

- The labels come from a model, and no human has checked them yet. Review sheets for that are in `bench/`.
- The rubric and the trigger were chosen on this same corpus. There is no held-out set.
- 21 good fires out of 21 is a small sample: the 95% interval for that rate runs from 85% to 100%.
- It is one developer's corpus, and only 286 of the 837 turns follow an edit to code. The rest is writing and research done in Claude Code.
- Recall is the weak side. The judge tends to read a correction as a new instruction, so about half of real pushback goes unnoticed. That is the safer way to be wrong for a tool that interrupts a working agent, but it is a real limit.

## Install

In Claude Code:

```
/plugin install chanjoongx-reflect --marketplace chanjoongx/reflect
```

You can also add the marketplace first: `/plugin marketplace add chanjoongx/reflect`, then `/plugin install chanjoongx-reflect@chanjoongx`. The plugin needs a Claude Code version that runs mods (function hooks). It was tested on 2.1.325.

There is no API key to set. The plugin is a mod: Claude Code loads its code itself, and its model calls go through `$.model.complete`, Claude Code's own client for the session. They reach whatever the session uses (the Anthropic API, Amazon Bedrock, Google Vertex AI or a gateway) under the session's sign-in. Claude Code counts them in the session's cost, and `/usage` shows the share from mods. On a subscription they count toward your usage like the session's own requests.

The plugin needs no `node`, declares no command hooks, runs no program and starts no process. It is the [`plugin/`](plugin/) folder of this repository: one generated code file, `hooks/reflect.ts`, the command, and the plugin's own [README](plugin/README.md).

Without the plugin system:

```bash
npm install -g @chanjoongx/reflect
reflect init     # prints the hook settings to paste into .claude/settings.local.json
reflect doctor   # checks node, the key and the wiring
```

The npm command runs as command hooks under `node` 20 or later and calls the Anthropic API with your own key, taken from `ANTHROPIC_API_KEY`, the project's `.env` or an `ant auth login` profile.

## Cost

| call | when | measured |
|---|---|---|
| judge, Claude Haiku 5.5 | each message after the agent's first reply | $0.00023 per call on average (4,806 tokens in, 98 out, 1.4 s), over the 837 benchmark turns |
| reflection, Claude Opus 5.5 | only when two pushbacks land within six messages | $0.020 and $0.029 in two live runs of 0.2, $0.0248 in one of 0.3, about 10 s each |

A 200-message session with three notes would cost about $0.05 for the judge and under $0.10 for the notes. Three reflections are not much of a sample, and a reflection that reads longer turns costs more. [`docs/cost.md`](docs/cost.md) has the details.

reflect stops calling models in a session once its calls there have cost $0.50 at API list prices. Change that with the plugin's spend cap setting, or with `REFLECT_MAX_USD_PER_SESSION` for the npm command. When the plugin stops, it says so once in the transcript: "reflect stopped for this session: ...".

## Commands

| command | what it does |
|---|---|
| `/chanjoongx-reflect:brain-reflect` | Has the agent look back at your recent messages and say what it keeps getting wrong, starting from reflect's latest note if there is one. No API call, and it runs nothing |
| `reflect status` | What reflect has seen in the latest session: turns judged, pushbacks, notes, spend, errors |
| `reflect manual [--turns N]` | From a terminal: the reflection model reads your last N judged messages (default 6) and writes a note, whether or not the trigger fired |
| `reflect doctor` | Checks node, credentials, the hook bundle and `.reflect/` |
| `reflect off`, `reflect on` | Turns the npm command's hooks off or on for this project |
| `reflect init` | Prints hook settings for use without the plugin |

The `reflect` commands come with the npm package, not the plugin, and they work on the npm command's hooks and its `.reflect/` folder. The plugin keeps nothing on disk for them to read. Run them as `npx @chanjoongx/reflect <command>`.

## Configuration

The plugin has two settings, shown when you enable it and in `/plugin`:

| setting | default | |
|---|---|---|
| Reflection model (`reflection_model`) | `claude-opus-5-5` | The model that writes the note. The judge is always Claude Haiku 5.5 |
| Spend cap per session, USD (`max_usd_per_session`) | `0.5` | Priced at API list prices |

If your organization does not allow a model by its full id, the plugin retries once with the alias (`haiku` or `opus`). If the provider refuses a call with a 401 or 403, the plugin stops for the rest of the session and says so in one transcript line. To turn the plugin off in one project, set `"chanjoongx-reflect@chanjoongx": false` under `enabledPlugins` in that project's `.claude/settings.local.json`.

The npm command reads these environment variables, all optional. The plugin reads none of them.

| variable | default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Or `ant auth login`. The plugin needs no key |
| `REFLECT_POLICY` | `k2w6` | Trigger: `k2w4`, `k2w6`, `k2w8`, `k3w8`, `k2w6-med` (medium confidence or above), `each` |
| `REFLECT_MODEL` | `claude-opus-5-5` | The reflection model |
| `REFLECT_EFFORT` | `high` | `low` to `max` |
| `REFLECT_JUDGE_MODEL` | `claude-haiku-5-5` | The per-message judge |
| `REFLECT_MAX_USD_PER_SESSION` | `0.5` | Spend cap per session |
| `REFLECT_DISABLED` | | `1` turns every hook into a no-op |

The npm command also reads a project's `.env`, but only its `ANTHROPIC_API_KEY` and `REFLECT_*` lines, and never overrides the environment.

## What leaves your machine

The plugin sends each request through your Claude Code session's own client, so it goes wherever the session's requests go. The npm command sends it to the Anthropic API with your key. Each judged message sends the message (up to 2,500 characters) and a summary of the agent's previous turn (its last 14 tool names with their file or command, and the last 1,400 characters of its final reply). A reflection sends the turns that triggered it. Before anything is sent, reflect replaces home directory paths, email addresses, phone numbers and common API key formats with placeholders. Details are in [`plugin/PRIVACY.md`](plugin/PRIVACY.md).

## Development

```bash
npm install
npm test               # typecheck and unit tests; the model calls are faked
npm run build          # writes plugin/hooks/reflect.ts (the plugin) and dist/ (the npm command)
npm run smoke          # runs the npm bundle the way hand-wired hooks run it
claude --plugin-dir ./plugin  # try the working copy in a session
```

Claude Code installs only `plugin/`. The source, the benchmark, the viewer and the docs stay out of it. The plugin's module, `plugin/hooks/reflect.ts`, is generated from `src/mod/reflect.ts` and the `src/` modules it imports, without minification. The npm command is built from `src/entry.ts` into `dist/`, which is not committed. The committed module must match `src/`; CI runs `npm run check:bundle`. How the pieces fit is in [`ARCHITECTURE.md`](ARCHITECTURE.md), and the benchmark is in [`bench/`](bench/README.md). The 0.1 documents are kept in [`docs/v0.1/`](docs/v0.1/).

## License

MIT. The plugin bundles no third-party code. The npm package bundles the Anthropic SDK and its dependencies, listed with their licenses in `dist/THIRD_PARTY_LICENSES.txt`.
