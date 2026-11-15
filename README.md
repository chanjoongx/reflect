<div align="center">

# reflect

**A Claude Code plugin that notices when you keep pushing back on the agent, works out why, and tells the agent before its next step.**

[![License: MIT](https://img.shields.io/badge/License-MIT-A78BFA.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@chanjoongx/reflect?color=D4A27F)](https://www.npmjs.com/package/@chanjoongx/reflect)
[![CI](https://github.com/chanjoongx/reflect/actions/workflows/ci.yml/badge.svg)](https://github.com/chanjoongx/reflect/actions/workflows/ci.yml)

</div>

```
/plugin install reflect --marketplace chanjoongx/reflect
```

---

## Why 0.2 exists

I built reflect 0.1 in April 2026 at the Built with Opus 4.7 hackathon. It counted `git revert`, `git restore`, deleted files and English phrases like "no wait", and when the count passed a threshold it asked Opus 4.7 why the session was going wrong.

Then I measured it on my own work. Across 109 real sessions in July it fired zero times. In August I pulled 837 developer turns from 224 sessions and had Claude Opus 5 label them; 141 were pushback on the agent. The shipped detector caught none of them.

People rarely push back with git. They type "only the parser, please" or "that's not what I asked", often in their own language, right after the agent did something. The signal is in the relation between what the agent just did and what you say next, and 0.1 looked at neither. The full write-up is in [`bench/FINDINGS.md`](bench/FINDINGS.md).

0.2 is rebuilt around that pair.

## What it does

1. **Judges each message.** For every message you send after the agent's first reply, reflect reads the agent's previous turn from the session transcript (its tool calls and its last words) and asks Claude Haiku 5.5 one question: is this message a correction, a rejection or a failure report, or is it a normal instruction or question? This runs as a background hook and does not hold up your prompt.
2. **Waits for a pattern.** One pushback is normal. When two land within six of your messages, Claude Opus 5.5 reads exactly those turns and writes a short note: what the agent keeps doing, what your pushback is about, what to change for the next few turns, and how the note could be wrong.
3. **Tells the agent once.** The note arrives as hook context on the agent's next tool call or your next prompt. It stays in force for 3 to 12 turns and comes back after a compaction. When the reviewer is unsure, the note tells the agent to ask you before acting on it. Your own words always win.

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

You see each note too. When the agent receives one, reflect shows a message in your session with the pattern and the adjustment.

Everything reflect keeps is in `.reflect/` in your project, which ignores itself in git. Sessions are deleted after 7 days. Nothing is shared between sessions.

## How well it works

The benchmark is 837 turns from 224 of my own Claude Code sessions, collected in August 2026 and labelled by Claude Opus 5. 141 of the turns are pushback. In November I reran the judge on the same turns with the model 0.2 ships, Claude Haiku 5.5. Both judges skip turns that have no agent turn before them.

| detector | pushback found (of 141) | false alarms | precision | recall |
|---|---:|---:|---:|---:|
| 0.1.4 as shipped (git reverts + English phrases) | 0 | 0 | n/a | 0.0% |
| judge on Claude Haiku 4.5 (August) | 67 | 10 | 87.0% | 47.5% |
| **0.2: judge on Claude Haiku 5.5** | **76** | **2** | **97.4%** | **53.9%** |

On the same turns Haiku 5.5 scores 9.3 F0.5 points above Haiku 4.5 (95% interval 2.5 to 18.5, resampled by session). Turning on adaptive thinking did not help (93.6% precision, 51.8% recall), so it stays off.

What matters in use is whether a session gets a note at all. Replayed over the benchmark, the default trigger (two pushbacks within six turns) fired 21 times in 17 sessions, and every fire landed on turns the reference labels call pushback. Of the 26 sessions where the reference labels trip the same trigger, it reached 17. With the Haiku 4.5 judge it was 17 good fires of 20, in 15 of the 26 sessions. `npm run bench:sim -- --run h55` repeats the replay without API calls.

The agent's previous turn is what makes this work. In the August runs, hiding it cost the Haiku 4.5 judge 10.3 F1 points (clustered bootstrap interval 1.2 to 19.8; 6.8 once the turns where the judge declined to answer are left out). Showing it the previous turn of a different pair cost 27.6.

I also ran the plugin end to end in a real `claude -p` session on 2026-11-16. Two corrections in a row fired the trigger, Opus 5.5 wrote the note in 10.3 seconds for $0.020, and the agent's next turn did the check the note asked for.

What these numbers do not tell you:

- The labels come from a model, and no human has checked them yet. Review sheets for that are in `bench/`.
- The rubric and the trigger were chosen on this same corpus. There is no held-out set.
- 21 good fires out of 21 is a small sample: the 95% interval for that rate runs from 85% to 100%.
- It is one developer's corpus, and only 286 of the 837 turns follow an edit to code. The rest is writing and research done in Claude Code.
- Recall is the weak side. The judge tends to read a correction as a new instruction, so about half of real pushback goes unnoticed. That is the safer way to be wrong for a tool that interrupts a working agent, but it is a real limit.

## Install

In Claude Code 2.1.275 or later:

```
/plugin install reflect --marketplace chanjoongx/reflect
```

On older versions, run `/plugin marketplace add chanjoongx/reflect`, then `/plugin install reflect@chanjoongx`.

The automatic path calls the Anthropic API directly, so it needs an API key. Claude Code asks for one when you enable the plugin and keeps it in your system's credential store. The plugin uses that key and no other: it ignores `ANTHROPIC_API_KEY`, `.env` files and `ant auth login` profiles, and it sends the key only to `api.anthropic.com`. A Claude subscription login on its own is not enough for the hooks. `/reflect:brain-reflect` works without a key, because the agent writes the reflection itself.

You need `node` 20 or later on your `PATH`. The plugin is the [`plugin/`](plugin/) folder of this repository: the hook bundle, which has nothing to install, the command, and the plugin's own [README](plugin/README.md).

Without the plugin system:

```bash
npm install -g @chanjoongx/reflect
reflect init     # prints the hook settings to paste into .claude/settings.local.json
reflect doctor   # checks node, the key and the wiring
```

Outside the plugin, reflect takes the key from `ANTHROPIC_API_KEY`, the project's `.env` or an `ant auth login` profile.

## Cost

| call | when | measured |
|---|---|---|
| judge, Claude Haiku 5.5 | each message after the agent's first reply | $0.00023 per call on average (4,806 tokens in, 98 out, 1.4 s), over the 837 benchmark turns |
| reflection, Claude Opus 5.5 | only when two pushbacks land within six messages | $0.020 and $0.029 in two live runs, about 10 s each |

A 200-message session with three notes would cost about $0.05 for the judge and under $0.10 for the notes. Two reflections are not much of a sample, and a reflection that reads longer turns costs more. [`docs/cost.md`](docs/cost.md) has the details.

reflect stops calling the API in a session once it has spent $0.50 there. Change that with the plugin setting or `REFLECT_MAX_USD_PER_SESSION`.

## Commands

| command | what it does |
|---|---|
| `/reflect:brain-reflect` | Lists which of your last six judged messages read as pushback and has the agent reflect on them. No API call |
| `reflect status` | What reflect has seen in the latest session: turns judged, pushbacks, notes, spend, errors |
| `reflect manual [--turns N]` | From a terminal: the reflection model reads your last N judged messages (default 6) and writes a note, whether or not the trigger fired |
| `reflect doctor` | Checks node, credentials, the hook bundle and `.reflect/` |
| `reflect off`, `reflect on` | Turns reflect off or on for this project |
| `reflect init` | Prints hook settings for use without the plugin |

Outside the plugin, run the CLI as `npx @chanjoongx/reflect <command>`.

## Configuration

All optional.

| variable | default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Outside the plugin only, or `ant auth login`. The plugin uses its own API key setting |
| `REFLECT_POLICY` | `k2w6` | Trigger: `k2w4`, `k2w6`, `k2w8`, `k3w8`, `k2w6-med` (medium confidence or above), `each` |
| `REFLECT_MODEL` | `claude-opus-5-5` | The reflection model |
| `REFLECT_EFFORT` | `high` | `low` to `max` |
| `REFLECT_JUDGE_MODEL` | `claude-haiku-5-5` | The per-message judge |
| `REFLECT_MAX_USD_PER_SESSION` | `0.5` | Spend cap per session |
| `REFLECT_DISABLED` | | `1` turns every hook into a no-op |

From a project's `.env`, reflect reads only `REFLECT_*` (and, outside the plugin, `ANTHROPIC_API_KEY`), and never overrides the environment.

## What leaves your machine

Each judged message goes to the Anthropic API with your key: the message (up to 2,500 characters) and a summary of the agent's previous turn (its last 14 tool names with their file or command, and the last 1,400 characters of what it said). A reflection sends the turns that triggered it. Before anything is sent, reflect replaces home directory paths, email addresses, phone numbers and common API key formats with placeholders. Details are in [`plugin/PRIVACY.md`](plugin/PRIVACY.md).

## Development

```bash
npm install
npm test               # typecheck and unit tests; the model calls are faked
npm run build          # bundles src/ into plugin/hooks/reflect-hook.mjs and plugin/hooks/lib/
npm run smoke          # runs the bundle the way Claude Code does
claude --plugin-dir ./plugin  # try the working copy in a session
```

Claude Code installs only `plugin/`, and that folder is also what Anthropic's plugin directory reviews. The source, the benchmark, the viewer and the docs stay out of it. The committed bundle must match `src/`; CI runs `npm run check:bundle`. How the pieces fit is in [`ARCHITECTURE.md`](ARCHITECTURE.md), and the benchmark is in [`bench/`](bench/README.md). The 0.1 documents are kept in [`docs/v0.1/`](docs/v0.1/).

## License

MIT. The bundled Anthropic SDK and its dependencies are listed with their licenses in [`plugin/hooks/THIRD_PARTY_LICENSES.txt`](plugin/hooks/THIRD_PARTY_LICENSES.txt).
