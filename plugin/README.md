# reflect

reflect watches for the moment you start correcting Claude Code more than once. Each message you send is judged by Claude Haiku 5.5: is it pushback on what the agent just did, or a normal instruction? When two pushbacks land within six of your messages, Claude Opus 5.5 reads exactly those turns and writes a short note for the agent: what it keeps doing, what your pushback is about, and what to change for the next few turns. The agent gets the note before its next step, and you see the same note in your session.

Install it in Claude Code:

```
/plugin install chanjoongx-reflect --marketplace chanjoongx/reflect
```

There is no API key to set. reflect is a mod: Claude Code loads its code itself, and its model calls go through your session, on the same account and provider as the session's own requests. Claude Code counts them in the session's cost, and `/usage` shows how much came from mods.

## What it runs

The plugin holds one code file, `hooks/reflect.ts`, which `hooks/hooks.json` names as its module. It declares no command hooks, runs no program and starts no process. It hooks five events:

| event | what reflect does |
|---|---|
| session start | Gets ready for the session and adds the `/reflect-status` command. |
| you send a message | Pairs your message with the agent's turn before it and queues the judge, which runs after the message has gone through. If a note is waiting, gives it to the agent with your message. |
| the agent finishes a tool call | Records the tool's name, the file or command it touched, and whether it failed. If a note is waiting, gives it to the agent with the tool's result. |
| the agent ends its turn | Records the agent's reply (its last 4,000 characters). |
| you run `/reflect-status` | Prints what reflect holds for this session. No model is called. |
| session end | Forgets the session. |

It calls five things in Claude Code and nothing else: one model completion at a time, a timer that runs the judge after your message, a line in your transcript, the session's context size, which tells it when the conversation was compacted, and the registration of its `/reflect-status` command.

`/reflect-status` prints how many of your messages reflect has judged, how many were pushback and of which kind, how many notes it has written, what it has spent against the cap, the note in force and how many more messages it lasts, and why reflect stopped if it did. It reads only what reflect holds in memory. The agent sees the output too, as it does for any plugin command.

The `/chanjoongx-reflect:brain-reflect` command is a prompt and nothing else. It asks the agent to look back at your recent messages and what it did before each one, starting from reflect's latest note if there is one, and to say what it will change.

## What it sends, and where

Every model call goes through your Claude Code session's own client, so it reaches whatever your session uses (the Anthropic API, Amazon Bedrock, Google Vertex AI or a gateway) with the session's sign-in. reflect has no network access, key or account of its own.

- **For each message you send** after the agent's first reply: your message, cut to 2,500 characters, and a summary of the agent's turn just before it. The summary has the names of its last 14 tool calls with the file or command each one touched, and the last 1,400 characters of its final reply. Model: Claude Haiku 5.5.
- **For each note**: the two or more messages that triggered it, each with its summary, cut to 1,500 characters. Model: Claude Opus 5.5, or the model you set.

Before anything is sent, reflect replaces home directory paths, email addresses, phone numbers, private key blocks and the key formats of Anthropic, GitHub, npm, Hugging Face, Slack and AWS with placeholders. This is pattern matching, so a secret in an unusual format can get through.

reflect never reads the session transcript, other sessions, your files, Claude's memory or your environment. It never records tool output or the contents of files the agent writes. It ignores subagents, and it judges only messages you send yourself: a background task's notification, a scheduled prompt or a message from another session is passed on unread, and so is a slash command with nothing typed after it.

## What it keeps

Nothing is written to disk. While the session runs, reflect holds in memory the judge's label for each of your messages, the redacted text of your last 12 judged messages with their summaries, the agent's current turn, and the current note. All of it is gone when the session ends. A resumed session starts with none of it.

## What you see

Each time the agent receives a note, reflect adds the whole note to your transcript in a line that starts with "reflect sent the agent this note:". After a compaction, while the note is still in force, the line says it was sent again. The note tells the agent that your own words in the current turn take precedence over it, and when the reviewing model is unsure, it tells the agent to ask you before acting on it.

If reflect stops for the rest of a session, it says why once: "reflect stopped for this session: ...". `/reflect-status` shows the same reason later.

## Examples

1. **Edits that spread.** You ask for a fix in `src/parser.ts`. The agent also reformats two other files, you write "only the parser, please", and two messages later "leave the tests alone". The note tells the agent to edit only the files you name and to ask before touching any other.
2. **The same wrong approach twice.** You write "no, use the existing date helper", and after the next attempt "still not using it". The note tells the agent to use the helper you named and to look for an existing one before writing new code.
3. **A check-in on demand.** A long session feels off, so you run `/chanjoongx-reflect:brain-reflect`. The agent quotes the messages where you pushed back, says what it has been doing that you keep redirecting, and says what it will change.

## Settings

| setting | default | |
|---|---|---|
| Reflection model | `claude-opus-5-5` | The model that writes the note. The judge is always Claude Haiku 5.5. |
| Spend cap per session (USD) | `0.5` | reflect stops calling models in a session once its calls there have cost this much at API list prices. |

If your organization does not allow a model by its full id, reflect tries once more with the alias (`haiku` or `opus`).

Measured costs: about $0.00023 per judged message and $0.02 to $0.03 per note. A 200-message session with three notes comes to about $0.05 for judging and under $0.10 for the notes. On a subscription plan the calls count toward your usage like the session's own requests.

## Turning it off

Disable the plugin in `/plugin`. To turn it off in one project only, set `"chanjoongx-reflect@chanjoongx": false` under `enabledPlugins` in that project's `.claude/settings.local.json`.

## Troubleshooting

- **No notes ever arrive.** Run `/reflect-status` to see how many messages were judged and how many were pushback. For more, run Claude Code with `--debug` and look for lines from `chanjoongx-reflect`: each model call is logged with its result. If the provider refuses a call (401 or 403), reflect says so in the transcript and stops for that session.
- **Notes stopped partway through a session.** The spend cap was reached, and the transcript says so.
- **The plugin does not load.** reflect needs a Claude Code version that runs mods (function hooks). It was tested on 2.1.325.

## Source

`hooks/reflect.ts` is generated, without minification, from [`src/mod/reflect.ts`](https://github.com/chanjoongx/reflect/blob/main/src/mod/reflect.ts) and the modules it imports from [`src/`](https://github.com/chanjoongx/reflect/tree/main/src), which hold the same prompts, trigger and redaction as the npm package. The build fails if the file reaches for Node, the network, files, processes, the environment, stored data or the transcript, or calls anything in Claude Code beyond the five calls above. CI rebuilds it on every push and fails if the committed file differs. The benchmark behind the detection numbers, and the code that produced them, are in the [repository](https://github.com/chanjoongx/reflect).

Privacy policy: [PRIVACY.md](PRIVACY.md). Questions and bugs: [GitHub issues](https://github.com/chanjoongx/reflect/issues) or cj@chanjoongx.com. License: MIT.
