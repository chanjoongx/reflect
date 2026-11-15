# Getting started

This page takes you from install to your first reflection. The rest of the time reflect runs in the background and you do not need to touch it.

## What you need

- Claude Code 2.1.275 or later. Older versions work with the two-step install below.
- `node` 20 or later on your `PATH`. The hook is a bundled file with nothing to install.
- An Anthropic API key, entered in the plugin settings. The judge and the reflection call the Anthropic API directly and are billed to that key. A Claude subscription login on its own is not enough for the automatic path; without a key you can still use `/chanjoongx-reflect:brain-reflect`, and the agent writes the reflection itself.

## 1. Install the plugin

In Claude Code:

```
/plugin install chanjoongx-reflect --marketplace chanjoongx/reflect
```

On versions before 2.1.275:

```
/plugin marketplace add chanjoongx/reflect
/plugin install chanjoongx-reflect@chanjoongx
```

When you enable the plugin, Claude Code asks for three settings:

| setting | default | |
|---|---|---|
| Anthropic API key | empty | Kept in your system's credential store. The plugin uses only this key. Without it the automatic notes stay off, and `/chanjoongx-reflect:brain-reflect` still works. |
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
warn  credentials              none in the environment; the SDK may still find an `ant auth login` profile
ok    enabled here             <your project directory>
warn  sessions recorded        none yet (normal before the first prompt)
```

A `warn` on `sessions recorded` is normal before the first prompt. A `warn` on `credentials` is expected when the key is in the plugin settings, because `doctor` run from a terminal cannot see it. The `status` output after a few messages is the real test. Outside the plugin, a key it finds shows as `API key found (environment or .env)`.

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
/chanjoongx-reflect:brain-reflect
```

The command is a prompt to the agent. It runs nothing and makes no API call. The agent looks back at your recent messages and what it did before each one, starting from the note reflect last gave it if there is one, and tells you what it has been doing that you keep redirecting and what it will change.

From a terminal, `npx @chanjoongx/reflect manual --turns 10` sends your last 10 judged messages to the reflection model, using a key from your environment, and prints the note.

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

`reflect init` prints the hook settings to merge into `.claude/settings.local.json`. They have the same shape as the plugin's `plugin/hooks/hooks.json`, with an absolute path to the installed bundle, because hook arguments do not pass through a shell:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node", "args": ["<package>/dist/reflect.mjs", "session-start"], "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [
      { "type": "command", "command": "node", "args": ["<package>/dist/reflect.mjs", "prompt"], "timeout": 10 },
      { "type": "command", "command": "node", "args": ["<package>/dist/reflect.mjs", "judge"], "async": true }
    ] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node", "args": ["<package>/dist/reflect.mjs", "tool"], "timeout": 10 }] }],
    "PostToolUseFailure": [{ "hooks": [{ "type": "command", "command": "node", "args": ["<package>/dist/reflect.mjs", "tool-failed"], "timeout": 10 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node", "args": ["<package>/dist/reflect.mjs", "stop"], "timeout": 10 }] }]
  }
}
```

Then run `reflect doctor` in the project and restart Claude Code. Without the plugin there is no settings dialog, so the key has to come from `ANTHROPIC_API_KEY` or the project's `.env`, and `/chanjoongx-reflect:brain-reflect` is not installed; use `reflect manual` instead.

## What reflect writes

Everything goes under `.reflect/` in the project:

| path | what |
|---|---|
| `.reflect/.gitignore` | `*`, written on first use, so nothing here is committed by accident |
| `.reflect/sessions/<session id>/events.jsonl` | One JSON line per event: each prompt, verdict, skip, fire, note and delivery, without message text. Session folders older than 7 days are deleted when a new session starts. |
| `.reflect/sessions/<session id>/agent/` | The agent's turn after one of your messages, recorded by the `tool`, `tool-failed` and `stop` hooks. Deleted once the judge reads it, or after a day. |
| `.reflect/sessions/<session id>/turns/` | The text of a judged message, the agent-turn summary and the judge's quote, for your last 12 messages only. |
| `.reflect/session-guidance.md` | The latest note, for you to read |
| `.reflect/disabled` | Present only after `reflect off` |

Costs are estimated in [cost.md](cost.md). How the pieces fit is in [ARCHITECTURE.md](../ARCHITECTURE.md).
