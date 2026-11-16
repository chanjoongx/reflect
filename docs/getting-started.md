# Getting started

This page takes you from install to your first reflection. The rest of the time reflect runs in the background and you do not need to touch it.

## What you need

- A Claude Code version that runs mods (function hooks). reflect 0.3 was tested on 2.1.325.
- Nothing else. The plugin needs no `node` and no API key. Its model calls go through your Claude Code session, on the same account and provider as the session's own requests. Claude Code counts them in the session's cost, and `/usage` shows the share from mods. On a subscription they count toward your usage like the session's own requests.

## 1. Install the plugin

In Claude Code:

```
/plugin install chanjoongx-reflect --marketplace chanjoongx/reflect
```

Or add the marketplace first:

```
/plugin marketplace add chanjoongx/reflect
/plugin install chanjoongx-reflect@chanjoongx
```

The plugin has two settings, which you can leave at their defaults:

| setting | default | |
|---|---|---|
| Reflection model | `claude-opus-5-5` | The model that writes the note. The judge is always Claude Haiku 5.5. |
| Spend cap per session (USD) | `0.5` | reflect stops calling models in a session once its calls there have cost this much at API list prices. |

If your organization does not allow a model by its full id, reflect tries once more with the alias (`haiku` or `opus`).

## 2. Check the setup

Run `/plugin` and check that `chanjoongx-reflect` is installed and enabled. The plugin writes no files, so the npm package's `reflect doctor` and `reflect status` cannot see it.

If you want to watch it work, start Claude Code with `--debug` and look for lines from `chanjoongx-reflect`. Each model call is logged with its result.

## 3. Work as usual

Each message you send after the agent's first reply is judged once it has gone through: Claude Haiku 5.5 reads it next to what the agent had just done and labels it. Your prompt is never delayed by this.

When two of your messages within six turns are pushback (a correction, a rejection or a report that something is broken), Claude Opus 5.5 reads those two turns and writes a short note. The agent receives it with its next tool result or your next message. It starts like this:

```
reflect: the developer has pushed back on 2 of their last 6 turns (turns <a>, <b>). An outside reviewer read those turns and suggests:
```

followed by the pattern, what the pushback is about, an adjustment for the next few turns, a check to run first, and how the note might be wrong. If the reviewer's confidence is low, the note tells the agent to ask you before acting on it. Your own words in the current turn always take precedence over the note.

You see the same note in your transcript, in a line that starts with "reflect sent the agent this note:". If the conversation is compacted while the note is still in force, the agent gets it again and the line says so.

## 4. See what reflect saw

The plugin keeps nothing on disk, so its record is your transcript: one line for each note the agent received, and one line if reflect stops for the rest of the session ("reflect stopped for this session: ..."), which happens when the spend cap is reached or the provider refuses a call. `/usage` shows what the plugin's calls cost.

With the npm command's hooks, `status` reads the session log under `.reflect/`:

```bash
npx @chanjoongx/reflect status
```

```
reflect 0.3.0 · session <session id>
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

With the npm command's hooks, `npx @chanjoongx/reflect manual --turns 10` run from a terminal sends your last 10 judged messages to the reflection model, using a key from your environment, and prints the note.

## 6. Turn it off

Disable the plugin in `/plugin`. To turn it off in one project only, set `"chanjoongx-reflect@chanjoongx": false` under `enabledPlugins` in that project's `.claude/settings.local.json`:

```json
{
  "enabledPlugins": {
    "chanjoongx-reflect@chanjoongx": false
  }
}
```

The npm command has its own switch:

```bash
npx @chanjoongx/reflect off   # the npm command's hooks are off for this project. `reflect on` turns them back on.
npx @chanjoongx/reflect on
```

`off` writes `.reflect/disabled`, which every one of its hooks checks first. Setting `REFLECT_DISABLED=1` in the environment does the same for every project. Neither affects the plugin.

## Without the plugin system

```bash
npm install -g @chanjoongx/reflect
reflect init
```

`reflect init` prints the hook settings to merge into `.claude/settings.local.json`. They are command hooks that run the installed bundle under `node` 20 or later, with an absolute path to it, because hook arguments do not pass through a shell:

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

Then run `reflect doctor` in the project and restart Claude Code. On a fresh project with no key in the environment, `doctor` prints something like:

```
ok    node >= 20               24.13.0
warn  credentials              none in the environment; the SDK may still find an `ant auth login` profile
ok    enabled here             <your project directory>
warn  sessions recorded        none yet (normal before the first prompt)
```

A `warn` on `sessions recorded` is normal before the first prompt. A key it finds shows as `API key found (environment or .env)`. The npm command calls the Anthropic API with your own key, taken from `ANTHROPIC_API_KEY`, the project's `.env` or an `ant auth login` profile. `/chanjoongx-reflect:brain-reflect` is not installed without the plugin; use `reflect manual` instead.

## What reflect writes

The plugin writes nothing to disk. It holds its state in memory for the session and drops it when the session ends. The npm command's hooks write everything under `.reflect/` in the project:

| path | what |
|---|---|
| `.reflect/.gitignore` | `*`, written on first use, so nothing here is committed by accident |
| `.reflect/sessions/<session id>/events.jsonl` | One JSON line per event: each prompt, verdict, skip, fire, note and delivery, without message text. Session folders older than 7 days are deleted when a new session starts. |
| `.reflect/sessions/<session id>/agent/` | The agent's turn after one of your messages, recorded by the `tool`, `tool-failed` and `stop` hooks. Deleted once the judge reads it, or after a day. |
| `.reflect/sessions/<session id>/turns/` | The text of a judged message, the agent-turn summary and the judge's quote, for your last 12 messages only. |
| `.reflect/session-guidance.md` | The latest note, for you to read |
| `.reflect/disabled` | Present only after `reflect off` |

Costs are estimated in [cost.md](cost.md). How the pieces fit is in [ARCHITECTURE.md](../ARCHITECTURE.md).
