# reflect

reflect watches for the moment you start correcting Claude Code more than once. Each message you send is judged by Claude Haiku 5.5: is it pushback on what the agent just did, or a normal instruction? When two pushbacks land within six of your messages, Claude Opus 5.5 reads exactly those turns and writes a short note for the agent: what it keeps doing, what your pushback is about, and what to change for the next few turns. The agent gets the note before its next step, and you see the same note in your session.

It needs an Anthropic API key, which Claude Code asks for when you enable the plugin. The calls are billed to that key.

## What it runs

Every hook runs one bundled file, `hooks/reflect-hook.mjs`, with `node` 20 or later.

| hook | when | what it does |
|---|---|---|
| `SessionStart` | a session starts, resumes or compacts | On a new session, deletes this project's reflect logs older than 7 days and unread agent turns older than a day. After a resume or a compaction, sends the agent its current note again. |
| `UserPromptSubmit` | you send a message | Records the message's length. If a note is waiting, gives it to the agent. |
| `UserPromptSubmit` (in the background) | you send a message | Summarises the agent's previous turn from what the hooks below recorded, deletes that record, and asks Claude Haiku 5.5 whether your message is pushback. When two pushbacks land within six messages, it starts the same file as a separate background process, which asks Claude Opus 5.5 for the note. |
| `PostToolUse` | the agent finishes a tool call | Records the tool's name and the file or command it touched. If a note is waiting, gives it to the agent. |
| `PostToolUseFailure` | a tool call fails | Records the tool's name and target, marked as failed. |
| `Stop` | the agent finishes its reply | Records the reply (its last 4,000 characters). |

The `/chanjoongx-reflect:brain-reflect` command is a prompt and nothing else: it runs no file and makes no API call. It asks the agent to look back at your recent messages and what it did before each one, starting from reflect's latest note if there is one, and to say what it will change.

reflect downloads nothing and installs nothing. The bundle includes the Anthropic TypeScript SDK; `hooks/THIRD_PARTY_LICENSES.txt` lists it and its dependencies with their licenses. In this copy, the build replaces the SDK's code that reads environment variables and credential files, so the key from the plugin's settings is the only one it can use.

## What it sends, and where

reflect connects to one place: `https://api.anthropic.com`, with the key from the plugin's settings. It uses no other credential, whatever is set in your environment.

- **For each message you send** after the agent's first reply: your message, cut to 2,500 characters, and a summary of the agent's turn just before it. The summary has the names of its last 14 tool calls with the file or command each one touched, and the last 1,400 characters of its final reply. Model: Claude Haiku 5.5.
- **For each note**: the two or more messages that triggered it, each with its summary, cut to 1,500 characters. Model: Claude Opus 5.5, or the model you set.

Before anything is sent, reflect replaces home directory paths, email addresses, phone numbers, private key blocks and the key formats of Anthropic, GitHub, npm, Hugging Face, Slack and AWS with placeholders. This is pattern matching, so a secret in an unusual format can get through.

reflect does not open the session transcript, other sessions, your source files or Claude's memory. It never records tool output or the contents of files the agent writes, and it ignores tool calls made inside subagents.

## What it stores

Everything stays in `.reflect/` inside the project, which contains a `.gitignore` so none of it is committed:

- `sessions/<session id>/events.jsonl`: for each message, its length and the judge's label, plus the notes, costs and errors. Deleted 7 days after the session.
- `sessions/<session id>/agent/`: the agent's turn after each of your messages (tool names and targets, the final reply), redacted. Deleted once your next message is judged, or after a day.
- `sessions/<session id>/turns/`: for each judged message, the message and the agent-turn summary (redacted, up to 1,500 and 2,000 characters) and the judge's quote. Only your last 12 messages keep this.
- `session-guidance.md`: the latest note, for you to read.

Nothing is shared between sessions. A note only ever reaches the session whose messages produced it.

## What you see

Each time the agent receives a note, reflect shows you the whole note in a message that starts with "reflect sent the agent this note:". After a compaction or a resume, the message says the note was sent again. The note tells the agent that your own words in the current turn take precedence over it. When the reviewing model is unsure, the note tells the agent to ask you before acting on it.

## Examples

1. **Edits that spread.** You ask for a fix in `src/parser.ts`. The agent also reformats two other files, you write "only the parser, please", and two messages later "leave the tests alone". The note tells the agent to edit only the files you name and to ask before touching any other.
2. **The same wrong approach twice.** You write "no, use the existing date helper", and after the next attempt "still not using it". The note tells the agent to use the helper you named and to look for an existing one before writing new code.
3. **A check-in on demand.** A long session feels off, so you run `/chanjoongx-reflect:brain-reflect`. The agent quotes the messages where you pushed back, says what it has been doing that you keep redirecting, and says what it will change.

## Settings

| setting | default | |
|---|---|---|
| Anthropic API key | | Needed for the automatic notes. Kept in your system's credential store. |
| Reflection model | `claude-opus-5-5` | The model that writes the note. The judge is always Claude Haiku 5.5. |
| Spend cap per session (USD) | `0.5` | reflect stops calling the API in a session once its calls there have cost this much. |

These settings take precedence over the `REFLECT_MODEL` and `REFLECT_MAX_USD_PER_SESSION` environment variables. The plugin does not read a project's `.env` file.

Measured costs: about $0.00023 per judged message and $0.02 to $0.03 per note. A 200-message session with three notes comes to about $0.05 for judging and under $0.10 for the notes.

## Turning it off

Disable the plugin in `/plugin`. To turn it off for one project only, create an empty file `.reflect/disabled` in that project, or set `REFLECT_DISABLED=1` in the environment. Either way every hook exits before reading anything or calling the API.

## Troubleshooting

- **No notes ever arrive.** Check that the API key is set in the plugin's settings. If the key is missing or rejected, reflect records one `auth` error in the session's `events.jsonl` and stops calling the API for that session. A key you add later takes effect in the next session.
- **Notes stopped partway through a session.** The spend cap was reached; the log has a `budget` line.
- **Hooks fail to start.** Check that `node --version` prints 20 or later in the terminal you start Claude Code from.

## Source

The bundle is built with esbuild from the TypeScript in [`src/`](https://github.com/chanjoongx/reflect/tree/main/src), starting at `src/plugin-entry.ts`, without minification, and no file passes 256 KiB. The build fails if the bundle reads an environment variable other than the ones the plugin uses. CI rebuilds it on every push and fails if the committed files differ. The benchmark behind the detection numbers, and the code that produced them, are in the [repository](https://github.com/chanjoongx/reflect).

Privacy policy: [PRIVACY.md](PRIVACY.md). Questions and bugs: [GitHub issues](https://github.com/chanjoongx/reflect/issues) or cj@chanjoongx.com. License: MIT.
