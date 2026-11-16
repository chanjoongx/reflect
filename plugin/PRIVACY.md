# Privacy

**Last updated: 2026-11-16, for reflect 0.3.0**

reflect comes in two forms. The Claude Code plugin (`chanjoongx-reflect`) is a mod that runs inside Claude Code. The npm package (`@chanjoongx/reflect`) is a command-line tool whose hooks you wire into a project yourself. Neither has a server, an account, telemetry or analytics.

## The plugin

### Where requests go

The plugin makes no network connection of its own and holds no API key. It asks Claude Code to run each model call on the session's own client, so the request goes wherever your session's requests go (the Anthropic API, Amazon Bedrock, Google Vertex AI or a gateway your organization set up), under the same sign-in and the same terms. Claude Code counts the calls in the session's cost and usage.

### What is sent, and when

**Each judged message** (Claude Haiku 5.5). Sent for every message you type in a session, except the first one and any message that does not follow an agent turn:

- your message, cut to 2,500 characters;
- a summary of the agent's turn just before it: the names of its last 14 tool calls with the file or command each one touched (each cut to 120 characters), whether each changed a file or failed, and the last 1,400 characters of the agent's final reply.

**Each reflection** (Claude Opus 5.5 by default, or the model you set). Sent only when two of your messages within six are judged pushback:

- those messages, each with the summary of the agent's turn before it, each cut to 1,500 characters;
- the short phrase the judge quoted as evidence for each one.

Before either request is made, reflect replaces these with placeholders: home directory paths (`C:\Users\<you>`, `/Users/<you>`, `/home/<you>`), email addresses, phone numbers, Anthropic, GitHub, npm, Hugging Face, Slack and AWS keys, and private key blocks. The replacement is pattern matching, so a secret in an unusual format can get through. Do not paste secrets into a Claude Code prompt.

### What it reads

The plugin works from what Claude Code hands its hooks and keeps only this: the text of each message you send yourself, the name of each tool the agent calls in the main conversation with the file, command or address it touched and whether it failed, the agent's final reply for each turn, and the session's context size as a number. It never reads the session transcript, other sessions, Claude's memory, your files or your environment variables. It never records tool output or the contents of files the agent writes. It ignores subagents and messages it did not get from you: background task notifications, scheduled prompts, other sessions' messages and prompts other plugins queue.

### What it keeps

Nothing is written to disk. During the session it holds in memory the judge's label for each of your messages, the redacted text of your last 12 judged messages with their summaries, the agent's current turn and the current note. All of it is dropped when the session ends.

### Turning it off

Disable or uninstall the plugin in `/plugin`, or disable it for one project with `enabledPlugins` in that project's `.claude/settings.local.json`.

## The npm package

The `reflect` command and the hooks it wires make their model calls to the Anthropic API (`https://api.anthropic.com`) with your own key, taken from `ANTHROPIC_API_KEY` in the environment or the project's `.env`, or from the Anthropic SDK's own login profile. The calls are billed to that key and governed by Anthropic's terms for it and its privacy policy: https://www.anthropic.com/legal/privacy

It sends the same two requests as the plugin, with the same limits and the same redaction. `reflect manual` also sends a reflection when you ask for one.

Its hooks read the fields Claude Code passes to each hook and keep the same things the plugin keeps, but on disk, under `.reflect/` in the project:

| file | contents | removed |
|---|---|---|
| `.reflect/sessions/<session>/events.jsonl` | one line per event: each message's length and the judge's label, the notes, costs and errors | when a new session starts and the session is more than 7 days old |
| `.reflect/sessions/<session>/agent/` | the agent's turn after one of your messages: tool names with their file or command, whether each failed, and the final reply (up to 4,000 characters), redacted | when your next message is judged, or when a session starts more than a day later |
| `.reflect/sessions/<session>/turns/` | for a judged message: the message (up to 1,500 characters), the agent-turn summary (up to 2,000) and the judge's quote and reason, redacted | as soon as it is no longer among your last 12 messages, and with the session after 7 days |
| `.reflect/session-guidance.md` | the latest reflection, for you to read | overwritten by the next one |
| `.reflect/.gitignore` | `*`, so none of this is committed | |
| `.reflect/disabled` | present only after `reflect off` | `reflect on` |

It writes nothing outside `.reflect/`, never prints, logs or stores a key, and stops before reading anything when `.reflect/disabled` exists or `REFLECT_DISABLED=1` is set. Delete the folder at any time and reflect starts fresh.

## Contact

Email cj@chanjoongx.com or open an issue at https://github.com/chanjoongx/reflect/issues. Changes to this policy are committed to this file; its git history is the record.
