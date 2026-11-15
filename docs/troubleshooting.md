# Troubleshooting

Start with these two commands, run from the project's root directory:

```bash
npx @chanjoongx/reflect doctor
npx @chanjoongx/reflect status
```

`doctor` checks node, credentials, the hook bundle (only when run inside the plugin), whether reflect is enabled here and whether `.reflect/` is ignored by git. It exits 1 if node, the bundle, the enabled check or the `.gitignore` check fails. `status` reads the latest session's event log. Without the plugin, drop `npx @chanjoongx/` if you installed the package globally.

## Nothing seems to happen

**`reflect: no session recorded in this project yet.`** The hooks have not written anything here. Check that the plugin is installed and enabled (`/plugin`), that `node` 20 or later is on the `PATH` Claude Code runs with, and that you ran `status` from the same directory Claude Code was opened in. The hooks write under `CLAUDE_PROJECT_DIR`, or the session's working directory when that is not set.

**``reflect is OFF for this project (`reflect on` to re-enable).``** Someone ran `reflect off`, which created `.reflect/disabled`. Run `reflect on`. If `REFLECT_DISABLED=1` is set in the environment, every hook is a no-op regardless.

**`judged` stays at 0 and `skipped` goes up.** The first message of a session is never judged, because there is no agent turn yet to push back on. Neither is a message sent before the agent replied to the previous one. Both are logged as `skip` events with reason `session_opener` or `consecutive_user_message`. If every message is skipped, look at the `errors` line instead.

**Pushback is recorded but no note arrives.** The default policy `k2w6` needs 2 pushback verdicts within 6 of your messages, and after a fire it waits 3 messages before it can fire again. The judge also misses about half of real pushback in the benchmark, mostly by reading a correction as a new instruction ([`bench/FINDINGS.md`](../bench/FINDINGS.md) §9). To get a note now, run `/reflect:brain-reflect`. To see the trigger fire on every pushback, set `REFLECT_POLICY=each`.

## The `errors` line

`status` shows the count and the last error, as `errors  N (last, in <where>: <message>)`. Messages are redacted and cut at 400 characters.

| where | what it means | what to do |
|---|---|---|
| `auth` | The judge got a 401 or 403, or found no credentials at all. After this the hooks make no more API calls in the session. | Fix the key (see below) and start a new session. |
| `judge` | The judge call failed for another reason: a timeout (30 s, 2 retries), a rate limit or server error that outlasted the retries, `judge refused (...)`, or `judge returned no text (stop_reason=...)`. That message is not judged; the next one is tried normally. | Usually nothing. If it repeats, check the Anthropic status page and your rate limits. |
| `reflection` | The reflection call failed: `reflection declined by the model`, `reflection returned no text (stop_reason=...)`, a schema parse error, or a network error. The fire is recorded but no note is written. | Run `/reflect:brain-reflect` to try again by hand. |
| `prompt`, `tool`, `session-start` | Something failed inside a hook that does not call the API, almost always a file under `.reflect/` that could not be read or written. | Check that the project directory is writable. |

A hook never fails your turn. Every error ends up in this log and nowhere else, so `status` is the place to look.

## Credentials

The key is taken from the first of these that is set:

1. `ANTHROPIC_API_KEY` in the environment Claude Code runs in.
2. `ANTHROPIC_API_KEY` in the project's `.env`. reflect reads only `ANTHROPIC_API_KEY` and `REFLECT_*` lines from that file and never overrides a value the environment already has.
3. The plugin's Anthropic API key setting.
4. Whatever the Anthropic SDK finds on its own, such as an `ant auth login` profile.

A Claude subscription login is not on that list. With only a subscription, the judge logs an `auth` error and the automatic path stays off; `/reflect:brain-reflect` still works because the agent writes the reflection itself.

`doctor` run from a terminal cannot see the plugin setting or an `ant auth login` profile, so it may print `warn  credentials  none in env; ...` while the hooks have a key. The `status` output after a few messages is the real test: verdicts and no `auth` error mean the key works.

## Spend

**`spent $<amount> of $0.5000 cap`, and nothing new is judged.** The session reached its cap and a `skip` event with reason `budget` was logged. Raise the cap with the plugin setting or `REFLECT_MAX_USD_PER_SESSION`; the environment variable wins when both are set. A negative or non-numeric value falls back to 0.5, and 0 stops all API calls.

**The total is a little over the cap.** The cap is checked before each judge call and before each reflection. Judge calls that were already running when the cap was reached still finish. `reflect manual` and `/reflect:brain-reflect` do not check the cap at all, though their cost counts toward it.

**Spend looks high for a custom model.** Costs come from the price table in `src/pricing.ts`. A `REFLECT_MODEL` or `REFLECT_JUDGE_MODEL` that the table does not list is charged at the table's highest rate, so the cap still stops it. Add the model's prices to the table if you want an accurate figure.

Expected costs are in [cost.md](cost.md).

## The note arrived late, or more than once

The judge runs asynchronously so it never delays your prompt. The note for a message therefore reaches the agent at its next tool call, which is usually partway through its answer to that same message. If the agent answers without using tools, the note waits for your next message.

Each note is delivered once, even when the agent runs several tools in parallel, and never into a subagent's context. It is delivered again only if Claude Code compacts or resumes the session while the note is still in force, because compaction rewrites the context it was delivered into. After `expires_after_turns` of your messages (3 to 12, chosen by the reflection model) it is dropped.

## Too many notes, or wrong ones

Every note carries the reviewer's confidence, a false-trigger likelihood and its best guess at how it could be wrong. When confidence is low or the false-trigger likelihood is high, the agent is told to ask you before acting on it. To fire less often, set `REFLECT_POLICY=k3w8` (3 pushbacks in 8 messages) or `k2w6-med` (ignores low-confidence verdicts). `reflect off` stops everything in this project.

## Upgrading from 0.1

0.2 does not use any of the files 0.1 asked you to set up. Remove these by hand:

- Hook entries in `.claude/settings.json` that run `reflect-trigger.sh`, `reflect-trigger.ps1`, `reflect-utterance.sh` or `reflect-utterance.ps1`, and the SessionStart entry that echoes `reflect active.` The scripts they point at no longer exist.
- `.claude/rules/reflect-rules.md`.
- Old files in `.reflect/` such as `state.json`, `trigger.log` and `session-log.jsonl`. 0.2 keeps its own log under `.reflect/sessions/`.

An `ANTHROPIC_API_KEY` line in the project's `.env` still works.

## Asking for help

Open an issue at [github.com/chanjoongx/reflect/issues](https://github.com/chanjoongx/reflect/issues) with the output of `reflect doctor` and `reflect status`. Both can include your project path and session id, so trim what you do not want public. For security problems, follow [SECURITY.md](../SECURITY.md) instead.
