# Troubleshooting

reflect comes in two forms, and you look in different places for each. The plugin is a mod that keeps nothing on disk: its transcript lines and Claude Code's debug log are the record. The npm command's hooks keep a log under `.reflect/`, which `reflect doctor` and `reflect status` read.

## The plugin

**No notes ever arrive.** Run Claude Code with `--debug` and look for lines from `chanjoongx-reflect`: each model call is logged with its result. If the provider refuses a call (401 or 403), reflect says so in the transcript and stops for that session. If calls are made but no note follows, see [A pushback but no note](#a-pushback-but-no-note).

**The plugin does not load.** reflect needs a Claude Code version that runs mods (function hooks). It was tested on 2.1.325. Check in `/plugin` that it is installed and enabled, and that the project's `.claude/settings.local.json` does not set `"chanjoongx-reflect@chanjoongx": false` under `enabledPlugins`.

**`reflect stopped for this session: ...`** The line says why. Either the session's calls reached the spend cap (see [Spend](#spend)), the provider refused a call with a 401 or 403, or the judge model could not be called even under its alias. reflect makes no more model calls in that session, and a new session starts over.

**`reflect doctor` or `reflect status` shows nothing.** Those commands come with the npm package and read the npm command's `.reflect/` folder. The plugin never writes there.

## A pushback but no note

The default policy `k2w6` needs 2 pushback verdicts within 6 of your messages, and after a fire it waits 3 messages before it can fire again. The first message of a session is never judged, because there is no agent turn yet to push back on, and neither is a message sent before the agent replied to the previous one. The judge also misses about half of real pushback in the benchmark, mostly by reading a correction as a new instruction ([`bench/FINDINGS.md`](../bench/FINDINGS.md) §9).

To get a note now, run `/chanjoongx-reflect:brain-reflect` and the agent reflects on its own, or, with the npm command's hooks, run `reflect manual` from a terminal. The plugin always uses `k2w6`. With the npm command, `REFLECT_POLICY=each` makes the trigger fire on every pushback.

## Nothing seems to happen with the npm command

Start with these two commands, run from the project's root directory:

```bash
npx @chanjoongx/reflect doctor
npx @chanjoongx/reflect status
```

`doctor` checks node, credentials, the npm command's own hook bundle, whether reflect is enabled here and whether `.reflect/` is ignored by git. It exits 1 if node, the bundle, the enabled check or the `.gitignore` check fails. `status` reads the latest session's event log. Drop `npx @chanjoongx/` if you installed the package globally.

**`reflect: no session recorded in this project yet.`** The hooks have not written anything here. Check that the entries `reflect init` printed are in the project's `.claude/settings.local.json`, that `node` 20 or later is on the `PATH` Claude Code runs with, and that you ran `status` from the same directory Claude Code was opened in. The hooks write under `CLAUDE_PROJECT_DIR`, or the session's working directory when that is not set. With only the plugin installed, this message is expected.

**``reflect is OFF for this project (`reflect on` to re-enable).``** Someone ran `reflect off`, which created `.reflect/disabled`. Run `reflect on`. If `REFLECT_DISABLED=1` is set in the environment, every hook is a no-op regardless.

**`judged` stays at 0 and `skipped` goes up.** Session openers and messages sent before the agent replied are logged as `skip` events with reason `session_opener` or `consecutive_user_message`. If every message is skipped, look at the `errors` line instead.

## The `errors` line

This is the npm command's log; the plugin has none. `status` shows the count and the last error, as `errors  N (last, in <where>: <message>)`. Messages are redacted and cut at 400 characters.

| where | what it means | what to do |
|---|---|---|
| `auth` | The judge got a 401 or 403, or found no credentials at all. After this the hooks make no more API calls in the session. | Fix the key (see below) and start a new session. |
| `judge` | The judge call failed for another reason: a timeout (30 s, 2 retries), a rate limit or server error that outlasted the retries, `judge refused (...)`, or `judge returned no text (stop_reason=...)`. That message is not judged; the next one is tried normally. | Usually nothing. If it repeats, check the Anthropic status page and your rate limits. |
| `reflection` | The reflection call failed: `reflection declined by the model`, `reflection returned no text (stop_reason=...)`, a schema parse error, or a network error. The fire is recorded but no note is written. | Run `reflect manual` from a terminal to try again, or `/chanjoongx-reflect:brain-reflect` to have the agent reflect without an API call. |
| `prompt`, `tool`, `tool-failed`, `stop`, `session-start` | Something failed inside a hook that does not call the API, almost always a file under `.reflect/` that could not be read or written. | Check that the project directory is writable. |

A hook never fails your turn. Every error ends up in this log and nowhere else, so `status` is the place to look.

## Credentials

The plugin has no key and reads none. Its calls go through your Claude Code session's own client, under the session's sign-in, to whatever provider the session uses. If the provider refuses a call with a 401 or 403, reflect stops for the session with one transcript line. If your organization does not allow a model by its full id, reflect first retries once with the alias (`haiku` or `opus`).

With hooks wired by hand, or the CLI, the key is taken from the first of these that is set:

1. `ANTHROPIC_API_KEY` in the environment Claude Code runs in.
2. `ANTHROPIC_API_KEY` in the project's `.env`. reflect reads only `ANTHROPIC_API_KEY` and `REFLECT_*` lines from that file and never overrides a value the environment already has.
3. Whatever the Anthropic SDK finds on its own, such as an `ant auth login` profile.

A Claude subscription login gives the npm command's hooks no key.

`doctor` checks the npm command's credentials only. The `status` output after a few messages is the real test: verdicts and no `auth` error mean the key works.

## Spend

**`reflect stopped for this session: it reached its spend cap of $0.50.`** The plugin's calls in this session reached the cap, priced at API list prices. Raise the cap in the plugin's settings.

**`spent $<amount> of $0.5000 cap`, and nothing new is judged.** The npm command's session reached its cap and a `skip` event with reason `budget` was logged. Raise the cap with `REFLECT_MAX_USD_PER_SESSION`. A negative or non-numeric value falls back to 0.5, and 0 stops all API calls.

**The total is a little over the cap.** The cap is checked before each judge call and before each reflection, so a call that started under the cap still finishes. In the npm command, several judge calls can be running when the cap is reached; the plugin makes its calls one at a time. `reflect manual` does not check the cap, though its cost counts toward it. `/chanjoongx-reflect:brain-reflect` makes no API call.

**Spend looks high for a custom model.** Costs come from the price table in `src/pricing.ts`. A reflection model in the plugin's settings, or a `REFLECT_MODEL` or `REFLECT_JUDGE_MODEL`, that the table does not list is charged at the table's highest rate, so the cap still stops it. Add the model's prices to the table if you want an accurate figure.

Expected costs are in [cost.md](cost.md).

## The note arrived late, or more than once

The judge runs after your message has gone through, so it never delays your prompt. The note for a message therefore reaches the agent at its next tool call, which is usually partway through its answer to that same message. If the agent answers without using tools, the note waits for your next message.

Each note is delivered once, even when the agent runs several tools in parallel, and never into a subagent's context. Each time, you see the whole note in a message that starts `reflect sent the agent this note:`. It is delivered again only after a compaction while the note is still in force, because compaction rewrites the context it was delivered into. The plugin notices a compaction when the session's context size falls below half of what it was, from at least 20,000 tokens. The npm command also delivers it again when the session is resumed; in the plugin, a resumed session starts without it. After `expires_after_turns` of your messages (3 to 12, chosen by the reflection model) it is dropped.

## Too many notes, or wrong ones

Every note carries the reviewer's confidence, a false-trigger likelihood and its best guess at how it could be wrong. When confidence is low or the false-trigger likelihood is high, the agent is told to ask you before acting on it.

The plugin's trigger is fixed. To stop it in one project, set `"chanjoongx-reflect@chanjoongx": false` under `enabledPlugins` in that project's `.claude/settings.local.json`, or disable it in `/plugin`. With the npm command, set `REFLECT_POLICY=k3w8` (3 pushbacks in 8 messages) or `k2w6-med` (ignores low-confidence verdicts) to fire less often. `reflect off` stops the npm command's hooks in this project.

## Upgrading from 0.1

0.2 does not use any of the files 0.1 asked you to set up. Remove these by hand:

- Hook entries in `.claude/settings.json` that run `reflect-trigger.sh`, `reflect-trigger.ps1`, `reflect-utterance.sh` or `reflect-utterance.ps1`, and the SessionStart entry that echoes `reflect active.` The scripts they point at no longer exist.
- `.claude/rules/reflect-rules.md`.
- Old files in `.reflect/` such as `state.json`, `trigger.log` and `session-log.jsonl`. 0.2 keeps its own log under `.reflect/sessions/`.

An `ANTHROPIC_API_KEY` line in the project's `.env` works only with hooks wired by hand. The plugin needs no key.

## Upgrading from 0.2.0

0.2.1 moved the plugin into the repository's `plugin/` folder. A marketplace install picks that up on update. If you load a clone with `--plugin-dir`, point it at `plugin/`. As a plugin, reflect no longer reads a key from the environment or `.env`, so enter it in the plugin's settings (until 0.3.0, which needs no key).

## Upgrading from 0.2.1

0.2.2 adds two hooks, `PostToolUseFailure` and `Stop`. The plugin gets them on update. If you wired the hooks by hand, run `reflect init` again and copy the new entries; without them the judge sees the agent's tool calls but not its reply or its failed calls. Logs written by 0.2.0 and 0.2.1 keep message text in `events.jsonl`. They are deleted 7 days after their session like any other log; to remove them sooner, delete `.reflect/sessions/`.

## Upgrading from 0.2.2

0.2.3 renames the plugin to `chanjoongx-reflect`, because the directory reserves `reflect` for an existing connector. An install of `reflect@chanjoongx` does not update to it: remove `reflect` in `/plugin`, then run `/plugin install chanjoongx-reflect@chanjoongx`. The command becomes `/chanjoongx-reflect:brain-reflect`.

0.2.3 also builds the plugin's hooks and the npm command separately. If you wired the hooks by hand, run `reflect init` again: the npm package now runs `dist/reflect.mjs` and no longer contains `plugin/`, so the old path stops working after `npm update`. `/chanjoongx-reflect:brain-reflect` no longer runs a command; the agent writes the reflection from the conversation.

## Upgrading from 0.2.3

0.3.0 rebuilds the plugin as a mod, and it needs a Claude Code version that runs mods (tested on 2.1.325). A marketplace install picks it up on update. The plugin no longer asks for an API key: its calls go through your Claude Code session. It no longer writes `.reflect/` either, so the `.reflect/` folders the 0.2 plugin left in your projects can be deleted. The npm command still uses `.reflect/`, so keep the folder where you wired its hooks by hand.

`.reflect/disabled`, `REFLECT_DISABLED` and the `REFLECT_*` variables now apply only to the npm command. To turn the plugin off in one project, set `"chanjoongx-reflect@chanjoongx": false` under `enabledPlugins` in that project's `.claude/settings.local.json`.

## Asking for help

Open an issue at [github.com/chanjoongx/reflect/issues](https://github.com/chanjoongx/reflect/issues). For the plugin, include your Claude Code version and the `chanjoongx-reflect` lines from a `--debug` run. For the npm command, include the output of `reflect doctor` and `reflect status`. All of these can include your project path and session id, so trim what you do not want public. For security problems, follow [SECURITY.md](../SECURITY.md) instead.
