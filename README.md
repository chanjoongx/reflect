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

Everything reflect keeps is in `.reflect/` in your project, which ignores itself in git. Sessions are deleted after 7 days. Nothing is shared between sessions.

## How well it works

Measured in August 2026 on 837 turns from 224 of my own Claude Code sessions, scored against labels from Claude Opus 5:

| detector | pushback turns found | precision | recall |
|---|---:|---:|---:|
| 0.1.4 as shipped (git reverts + English phrases) | 0 of 141 | n/a | 0.0% |
| 0.2 (skip turns with no prior agent turn, then the judge) | about half | 87.9% | 49.6% |

At the level that matters to you, whether a session gets a note at all, the default trigger (two pushbacks in six turns) fired in 16 sessions. In 15 of them the reference labels agree there was such a cluster. Of the 26 sessions where the labels show one, it caught 15. The replay that produces these numbers is `npm run bench:sim`, and it makes no API calls.

The prior turn is what makes this work. With the agent's previous turn hidden, the same judge loses 10.3 F1 points (clustered bootstrap interval 1.2 to 19.8; 6.8 points once the turns where the judge declined to answer are left out). Given the prior turn of a different pair instead, it loses 27.6.

Things these numbers do not tell you yet:

- The labels come from a model. No human has checked them. Review sheets for that are in `bench/`.
- They were measured with a Haiku 4.5 judge. 0.2 ships Haiku 5.5; the rerun is pending.
- It is one developer's corpus, and only 286 of the 837 turns follow an edit to code. The rest is writing and research done in Claude Code.
- Recall is the weak side. The judge tends to read a correction as a new instruction, so about half of real pushback goes unnoticed. That is the safer way to be wrong for a tool that interrupts a working agent, but it is a real limit.

## Install

In Claude Code 2.1.275 or later:

```
/plugin install reflect --marketplace chanjoongx/reflect
```

On older versions, run `/plugin marketplace add chanjoongx/reflect`, then `/plugin install reflect@chanjoongx`.

The automatic path calls the Anthropic API directly, so it needs an API key. Claude Code asks for one when you enable the plugin (it is kept in your system's credential store). You can leave it empty if `ANTHROPIC_API_KEY` is already set in your environment or in the project's `.env`, or if you use `ant auth login`. A Claude subscription login on its own is not enough for the hooks. `/reflect:brain-reflect` still works without a key: the agent writes the reflection itself.

You need `node` 20 or later on your `PATH`. The hook is a bundled file in this repository with no dependencies to install.

Without the plugin system:

```bash
npm install -g @chanjoongx/reflect
reflect init     # prints the hook settings to paste into .claude/settings.local.json
reflect doctor   # checks node, the key and the wiring
```

## Cost

These are estimates. The judge's token counts come from the August runs, raised by about 30% for Haiku 5.5's newer tokenizer and priced at Haiku 5.5 rates. The reflection has not yet been measured on Opus 5.5. [`docs/cost.md`](docs/cost.md) has the arithmetic.

| call | when | estimate |
|---|---|---|
| judge, Claude Haiku 5.5 | each message after the agent's first reply (about 3,900 Haiku 4.5 tokens in, 90 out) | $0.0003 to $0.0009 |
| reflection, Claude Opus 5.5 | only when two pushbacks land within six messages | at most about $0.20 |

reflect stops calling the API in a session once it has spent $0.50 there. Change that with the plugin setting or `REFLECT_MAX_USD_PER_SESSION`.

## Commands

| command | what it does |
|---|---|
| `/reflect:brain-reflect [N]` | Reflect on your last N judged messages now (default 6), whether or not the trigger fired |
| `reflect status` | What reflect has seen in the latest session: turns judged, pushbacks, notes, spend, errors |
| `reflect manual [--turns N]` | The same as the slash command, from a terminal |
| `reflect doctor` | Checks node, credentials, the hook bundle and `.reflect/` |
| `reflect off`, `reflect on` | Turns reflect off or on for this project |
| `reflect init` | Prints hook settings for use without the plugin |

Outside the plugin, run the CLI as `npx @chanjoongx/reflect <command>`.

## Configuration

All optional.

| variable | default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Or the plugin setting, or `ant auth login` |
| `REFLECT_POLICY` | `k2w6` | Trigger: `k2w4`, `k2w6`, `k2w8`, `k3w8`, `k2w6-med` (medium confidence or above), `each` |
| `REFLECT_MODEL` | `claude-opus-5-5` | The reflection model |
| `REFLECT_EFFORT` | `high` | `low` to `max` |
| `REFLECT_JUDGE_MODEL` | `claude-haiku-5-5` | The per-message judge |
| `REFLECT_MAX_USD_PER_SESSION` | `0.5` | Spend cap per session |
| `REFLECT_DISABLED` | | `1` turns every hook into a no-op |

From a project's `.env`, reflect reads only `ANTHROPIC_API_KEY` and `REFLECT_*`, and never overrides the environment.

## What leaves your machine

Each judged message goes to the Anthropic API with your key: the message (up to 2,500 characters) and a summary of the agent's previous turn (its last 14 tool names with their file or command, and the last 1,400 characters of what it said). A reflection sends the turns that triggered it. Before anything is sent, reflect replaces home directory paths, email addresses, phone numbers and common API key formats with placeholders. Details are in [`PRIVACY.md`](PRIVACY.md).

## Development

```bash
npm install
npm test               # typecheck and unit tests; the model calls are faked
npm run build          # bundles src/ into hooks/reflect-hook.mjs and hooks/lib/
npm run smoke          # runs the bundle the way Claude Code does
claude --plugin-dir .  # try the working copy in a session
```

The committed bundle must match `src/`; CI runs `npm run check:bundle`. How the pieces fit is in [`ARCHITECTURE.md`](ARCHITECTURE.md), and the benchmark is in [`bench/`](bench/README.md). The 0.1 documents are kept in [`docs/v0.1/`](docs/v0.1/).

## License

MIT. The bundled Anthropic SDK and its dependencies are listed with their licenses in [`hooks/THIRD_PARTY_LICENSES.txt`](hooks/THIRD_PARTY_LICENSES.txt).
