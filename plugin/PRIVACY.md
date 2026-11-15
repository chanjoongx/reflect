# Privacy

**Last updated: 2026-11-16, for reflect 0.2.1**

reflect runs on your machine as Claude Code hooks and a command-line tool. It has no server, no account, no telemetry and no analytics. The only network calls it makes go to the Anthropic API (`https://api.anthropic.com`), with your own API key, and are billed to that key.

0.2 sends more than 0.1 did. 0.1 called the API only when its trigger fired, which in practice was never. 0.2 sends one small request for each message you type after the agent's first reply.

## What is sent to Anthropic, and when

**Each judged message** (Claude Haiku 5.5). Sent for every message you type in a session, except the first one and any message that does not follow an agent turn:

- your message, cut to 2,500 characters;
- a summary of the agent's turn just before it: the names of its last 14 tool calls with the file or command each one touched (each cut to 120 characters), whether each changed a file or failed, and the last 1,400 characters of what the agent said.

**Each reflection** (Claude Opus 5.5 by default, or the model you configure). Sent only when the trigger fires, or when you run `reflect manual` from a terminal. The plugin's `/reflect:brain-reflect` command sends nothing:

- the developer turns that triggered it (up to 12), each with your message and the summary of the agent's turn before it, each cut to 1,500 characters;
- the short phrase the judge quoted as evidence for each one.

Before either request leaves your machine, reflect replaces these with placeholders: home directory paths (`C:\Users\<you>`, `/Users/<you>`, `/home/<you>`), email addresses, phone numbers, Anthropic, GitHub, npm, Hugging Face, Slack and AWS keys, and private key blocks. The replacement is pattern matching, so a secret in an unusual format can get through. Do not paste secrets into a Claude Code prompt.

reflect never reads your source files. It sees file names only as they appear in the agent's tool calls in the session transcript. It reads only the transcript of the session it runs in, at the path Claude Code passes to its hooks, and never other sessions or Claude's memory.

The requests are governed by Anthropic's terms for your API key and its privacy policy: https://www.anthropic.com/legal/privacy

## What is stored on your machine

Everything is under `.reflect/` in the project:

| file | contents | removed |
|---|---|---|
| `.reflect/sessions/<session>/events.jsonl` | one line per event: each message's length and verdict, the judged message (redacted, up to 1,500 characters) and the agent-turn summary, the reflection, costs, errors | when a new session starts and the session is more than 7 days old |
| `.reflect/session-guidance.md` | the latest reflection, for you to read | overwritten by the next one |
| `.reflect/.gitignore` | `*`, so none of this is committed | |
| `.reflect/disabled` | present only after `reflect off` | `reflect on` |

reflect writes nothing outside `.reflect/`. Delete the folder at any time; reflect starts fresh.

## Credentials

As an installed plugin, reflect uses one credential: the API key you enter in the plugin's settings. Claude Code keeps it in your system's credential store and passes it only to reflect's hook processes. reflect ignores any other key, token or profile on your machine, and sends this key only to `https://api.anthropic.com`. It never prints, logs or stores a key.

Run outside the plugin system, as a command-line tool or with hooks you wire into your settings by hand, reflect can also use the key the Anthropic SDK finds in your environment. The [project README](https://github.com/chanjoongx/reflect#configuration) describes that setup.

## Turning it off

An empty file `.reflect/disabled` in a project (`reflect off` creates it), or `REFLECT_DISABLED=1` in the environment, makes every hook exit without reading anything or calling the API. Disabling or uninstalling the plugin in Claude Code removes the hooks.

## Contact

Email cj@chanjoongx.com or open an issue at https://github.com/chanjoongx/reflect/issues. Changes to this policy are committed to this file; its git history is the record.
