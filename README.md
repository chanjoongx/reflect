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
| 0.2 and 0.3 npm command: Claude Haiku 5.5, structured output | 76 | 2 | 97.4% | 53.9% |
| **0.4 plugin: Claude Haiku 5.5, schema in the message** | **98** | **2** | **98.0%** | **69.5%** |
| **0.4 npm command: Claude Haiku 5.5, schema in the message** | **101** | **3** | **97.1%** | **71.6%** |

The three Haiku 5.5 rows use the same rubric, with thinking off and effort low. They differ in how the request asks for the answer. Up to 0.3 the npm command asked for structured output. In 0.4 both forms put the verdict's JSON Schema at the end of the message and accept a sentence or a code fence around the answer, and the plugin's request also starts with the identity line Claude Code puts before a plugin's system text. F0.5 went from 83.9% to 90.6% with the plugin's request and to 90.7% with the npm command's: 6.7 points (95% interval 3.5 to 10.4, resampled by session) and 6.8 points (3.2 to 10.8). The judge in the 0.3.0 plugin left effort at the model's default and was never measured.

These labels are a model's. I answered the 78 turns where the reference and a judge disagree myself, without seeing either label. With my answers in place, 111 of the 837 turns are pushback, not 141, and the picture changes: the 0.2 and 0.3 request finds 75 with 3 false alarms (96.2% precision, 67.6% recall), the 0.4 plugin 85 with 15 (85.0%, 76.6%), and the 0.4 npm command 89 with 15 (85.6%, 80.2%). So 0.4 finds more pushback at lower precision, and its F0.5 is 4 to 6 points lower, with intervals that include zero. [`bench/FINDINGS.md`](bench/FINDINGS.md) §16 has the details.

With the 0.2 request, Haiku 5.5 scores 9.3 F0.5 points above Haiku 4.5 on the same turns (95% interval 2.5 to 18.5). Turning on adaptive thinking did not help (93.6% precision, 51.8% recall), so it stays off.

What matters in use is whether a session gets a note at all. Replayed over the benchmark with the 0.4 npm command's labels, the default trigger (two pushbacks within six turns) fired 30 times, and 29 of those fires landed on turns the reference labels call pushback. Of the 26 sessions where the reference labels trip the same trigger, it reached 20. With the plugin's labels it fired 26 times, 25 of them on pushback, and reached 18 sessions. The 0.2 and 0.3 judge made 21 good fires of 21 and reached 17 sessions. The Haiku 4.5 judge made 17 good fires of 20 and reached 15. By my own answers on the disputed turns, 21 of the npm command's 30 fires rest on two real pushback turns, 18 of the plugin's 26, and 20 of the 0.2 judge's 21. `npx tsx bench/variants.ts --score h55,v0-mod,v0-text` repeats the replay without API calls, and `npm run bench:sim -- --run h55` repeats it for the 0.2 and 0.3 labels.

The agent's previous turn is what makes this work. In the August runs, hiding it cost the Haiku 4.5 judge 10.3 F1 points (clustered bootstrap interval 1.2 to 19.8; 6.8 once the turns where the judge declined to answer are left out). Showing it the previous turn of a different pair cost 27.6.

I also ran the plugin end to end on 2026-11-16. In a run of the 0.2 plugin, two corrections in a row fired the trigger, Opus 5.5 wrote the note in 10.3 seconds for $0.020, and the agent's next turn did the check the note asked for. The 0.3 mod ran under `claude -p --plugin-dir` with four messages in one process: three Haiku 5.5 judgements took 0.9 to 2.0 seconds each, Opus 5.5 wrote the note in 9.1 seconds for $0.0248, and the note reached the agent with the fourth message and showed up in the transcript.

Whether a note changes what the agent does next is a separate question, and the evidence so far comes from scripted sessions (`bench/note-effect.mjs`) on one machine. Where the developer states the rule outright, nothing is left for the note to do: Claude Code's compaction summary keeps the rule (a Haiku 5.5 agent followed it in 15 of 15 new functions with the plugin and without it), and an Opus 5.5 agent generalized from two corrections by itself. Where each correction only names files to undo and the project's CLAUDE.md pulls the other way, a Haiku 5.5 agent with the plugin got the note in 21 of 22 sessions and, after a compaction, changed only the file it was asked to in 63 of 66 tasks; without the plugin it did so in 28 of 63, and 10 of 21 sessions went back to the CLAUDE.md checklist (p = 0.0002). With an Opus 5.5 agent in that script, loading the plugin stopped repeat straying after the first correction (0 of 9 sessions, against 7 of 9 without it and 5 of 9 with only the plugin's command list), so no note was needed; why is not known. A run with the plugin's hooks but no note, and long sessions with implicit pushback, have not been tested. [`bench/FINDINGS.md`](bench/FINDINGS.md) §15 has the runs.

What these numbers do not tell you:

- The labels come from a model, and no human has checked them yet. The 78 messages where the reference and the judges disagree are on a blind yes/no sheet that `bench/variants.ts --sheet` writes, and `--adjudicated` rescores everything once it is filled in.
- The rubric and the trigger were chosen on this same corpus. For 0.4 I split the sessions in half by a hash of the session id and tried rubric edits on one half only. On the other half (118 sessions, 464 turns, 77 pushback) the plugin's new request still gains 4.0 F0.5 points over the 0.2 and 0.3 request (95% interval 0.8 to 7.7). The npm command's gains 3.2 there, with an interval from -1.4 to 7.6, so on that half the gain is not clear.
- 29 good fires out of 30 (25 of 26 with the plugin's labels) is a small sample: the 95% interval for that rate runs from 83% to 99% (81% to 99%).
- It is one developer's corpus, and only 286 of the 837 turns follow an edit to code. The rest is writing and research done in Claude Code.
- Recall is the weak side. It is about 70% now, so about 30% of real pushback goes unnoticed. Most of what is left are messages that call the delivered work not good enough and ask for it again. Rubric edits aimed at them raised recall to 77% to 81% on the half I tried them on, but precision fell to 88% to 91% and F0.5 ended below the shipped rubric, so I did not ship them. Missing pushback is the safer way to be wrong for a tool that interrupts a working agent, but it is a real limit.

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
reflect init --write   # in your project: adds the hooks to .claude/settings.local.json
reflect doctor         # checks node, the key and the wiring
```

The npm command runs as command hooks under `node` 20 or later and calls the Anthropic API with your own key, taken from `ANTHROPIC_API_KEY`, the project's `.env` or an `ant auth login` profile.

## Cost

| call | when | measured |
|---|---|---|
| judge, Claude Haiku 5.5 | each message after the agent's first reply | $0.00026 per call on average (about 4,600 tokens in, 105 out, 1.3 s), over the 837 benchmark turns with the 0.4 requests |
| reflection, Claude Opus 5.5 | only when two pushbacks land within six messages | $0.020 and $0.029 in two live runs of 0.2, $0.0248 in one of 0.3, about 10 s each |

A 200-message session with three notes would cost about $0.05 for the judge and under $0.10 for the notes. Three reflections are not much of a sample, and a reflection that reads longer turns costs more. [`docs/cost.md`](docs/cost.md) has the details.

reflect stops calling models in a session once its calls there have cost $0.50 at API list prices. Change that with the plugin's spend cap setting, or with `REFLECT_MAX_USD_PER_SESSION` for the npm command. When the plugin stops, it says so once in the transcript: "reflect stopped for this session: ...".

## Commands

| command | what it does |
|---|---|
| `/reflect-status` | In the plugin: what reflect holds for this session. Messages judged, pushbacks by kind, notes, spend against the cap, the note in force and how many more messages it lasts, and why reflect stopped if it did. It reads memory only and calls no model |
| `/chanjoongx-reflect:brain-reflect` | Has the agent look back at your recent messages and say what it keeps getting wrong, starting from reflect's latest note if there is one. No API call, and it runs nothing |
| `reflect status` | What reflect has seen in the latest session: turns judged, pushbacks, notes, spend, errors |
| `reflect manual [--turns N]` | From a terminal: the reflection model reads your last N judged messages (default 6) and writes a note, whether or not the trigger fired |
| `reflect doctor` | Checks node, credentials, the hook bundle and `.reflect/` |
| `reflect off`, `reflect on` | Turns the npm command's hooks off or on for this project |
| `reflect init` | Prints hook settings for use without the plugin. `--write` merges them into the project's `.claude/settings.local.json` and `--remove` takes them out |

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
