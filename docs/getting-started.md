# Getting started

This page takes you from install to your first reflection. The rest of the time reflect runs in the background and you do not need to touch it.

## What you need

- Claude Code 2.1.275 or later. Older versions work with the two-step install below.
- `node` 20 or later on your `PATH`. The hook is a bundled file with nothing to install.
- An Anthropic API key, or an `ant auth login` profile. The judge and the reflection call the Anthropic API directly and are billed to that key. A Claude subscription login on its own is not enough for the automatic path; without a key you can still use `/reflect:brain-reflect`, and the agent writes the reflection itself.

## 1. Install the plugin

In Claude Code:

```
/plugin install reflect --marketplace chanjoongx/reflect
```

On versions before 2.1.275:

```
/plugin marketplace add chanjoongx/reflect
/plugin install reflect@chanjoongx
```

When you enable the plugin, Claude Code asks for three settings:

| setting | default | |
|---|---|---|
| Anthropic API key | empty | Kept in your system's credential store. Leave it empty if `ANTHROPIC_API_KEY` is already set in your environment or in the project's `.env`, or if you use `ant auth login`. |
| Reflection model | `claude-opus-5-5` | The model that writes the note. The judge is always Claude Haiku 5.5 unless you set `REFLECT_JUDGE_MODEL`. |
| Spend cap per session (USD) | `0.5` | reflect stops calling the API in a session once its calls there have cost this much. |

## 2. Check the setup

From the project directory, in a terminal:

```bash
npx @chanjoongx/reflect doctor
```

On a fresh project with no key in the environment, it prints something like:

```
ok    node >= 20               24.13.0
warn  credentials              none in env; the SDK may still find an `ant auth login` profile
ok    enabled here             <your project directory>
warn  sessions recorded        none yet (normal before the first prompt)
```

A `warn` on `sessions recorded` is normal before the first prompt. A `warn` on `credentials` is fine if you set the key in the plugin settings or use `ant auth login`; `doctor` cannot see either from a terminal. When a key is found it says `API key found (env, .env or plugin setting)`.

## 3. Work as usual

Each message you send after the agent's first reply is judged in the background: Claude Haiku 5.5 reads it next to what the agent had just done and labels it. Your prompt is never delayed by this.

When two of your messages within six turns are pushback (a correction, a rejection or a report that something is broken), Claude Opus 5.5 reads those two turns and writes a short note. The agent receives it at its next tool call or your next message. It starts like this:

```
reflect: the developer has pushed back on 2 of their last 6 turns (turns <a>, <b>). An outside reviewer read those turns and suggests:
```

followed by the pattern, what the pushback is about, an adjustment for the next few turns, a check to run first, and how the note might be wrong. If the reviewer's confidence is low, the note tells the agent to ask you before acting on it. Your own words in the current turn always take precedence over the note.

A copy for you is written to `.reflect/session-guidance.md`.

## 4. See what reflect saw

```bash
npx @chanjoongx/reflect status
```

```
reflect 0.2.0 · session <session id>
  developer turns   <n>
  judged            <n> (skipped <n>: no prior agent turn, budget, or similar)
  pushback          <n>  [<labels>]
  reflections       <n> (fires <n>, policy k2w6)
  spent             $<amount> of $0.5000 cap
```

If a note is waiting or still in force, `status` prints it under `Guidance waiting to be delivered:` or `Guidance in force:`. If anything went wrong it adds an `errors` line with the last message; see [troubleshooting](troubleshooting.md).

## 5. Ask for a reflection yourself

Inside Claude Code:

```
/reflect:brain-reflect
/reflect:brain-reflect 10
```

This sends your last N judged messages (default 6, at most 12) to the reflection model right away, whether or not the trigger fired, and tells it some of them may not be pushback. The agent then tells you what the pattern is and what it will change. With no key, or before any message has been judged, the command prints `No outside reflection is available, so write one yourself from this conversation instead (see below).` and the agent writes the reflection from the conversation.

From a terminal, `npx @chanjoongx/reflect manual --turns 10` does the same and prints the note.

## 6. Turn it off

```bash
npx @chanjoongx/reflect off   # reflect is off for this project. `reflect on` turns it back on.
npx @chanjoongx/reflect on
```

`off` writes `.reflect/disabled`, which every hook checks first. Setting `REFLECT_DISABLED=1` in the environment does the same for every project.

## Without the plugin system

```bash
npm install -g @chanjoongx/reflect
reflect init
```

`reflect init` prints the hook settings to merge into `.claude/settings.local.json`. They have the same shape as the plugin's `hooks/hooks.json`, with an absolute path to the installed bundle, because hook arguments do not pass through a shell:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node", "args": ["<bundle>/hooks/reflect-hook.mjs", "session-start"], "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [
      { "type": "command", "command": "node", "args": ["<bundle>/hooks/reflect-hook.mjs", "prompt"], "timeout": 10 },
      { "type": "command", "command": "node", "args": ["<bundle>/hooks/reflect-hook.mjs", "judge"], "async": true }
    ] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node", "args": ["<bundle>/hooks/reflect-hook.mjs", "tool"], "timeout": 10 }] }]
  }
}
```

Then run `reflect doctor` in the project and restart Claude Code. Without the plugin there is no settings dialog, so the key has to come from `ANTHROPIC_API_KEY` or the project's `.env`, and `/reflect:brain-reflect` is not installed; use `reflect manual` instead.

## What reflect writes

Everything goes under `.reflect/` in the project:

| path | what |
|---|---|
| `.reflect/.gitignore` | `*`, written on first use, so nothing here is committed by accident |
| `.reflect/sessions/<session id>/events.jsonl` | One JSON line per event: each prompt, verdict, skip, fire, note and delivery. Session folders older than 7 days are deleted when a new session starts. |
| `.reflect/session-guidance.md` | The latest note, for you to read |
| `.reflect/disabled` | Present only after `reflect off` |

Costs are estimated in [cost.md](cost.md). How the pieces fit is in [ARCHITECTURE.md](../ARCHITECTURE.md).
