# Privacy Policy

**Last updated: 2026-04-21**

## Summary

reflect does not collect, store, or transmit any user data beyond a single, on-demand Opus 4.7 API call per triggered reflection. All operations run on your machine.

## What reflect does

reflect is a local Node.js CLI + Claude Code hook + plugin manifest. When triggered (revert signal cluster), it:
1. Reads recent tool calls + diff + active rules from local files
2. Calls the Anthropic Messages API with this payload (single API call)
3. Writes the structured response to `.reflect/session-guidance.md`
4. Optionally appends to `.reflect/session-log.jsonl` if `REFLECT_LOG_ENABLED=1`

That's it. No telemetry, no analytics, no background sync, no cross-machine sharing.

## Data sent to Anthropic

Per Opus 4.7 reflection call:
- The 3-layer prompt (system + session context + trigger payload)
- Recent tool call summaries (long string fields truncated to 200 chars)
- Active rule files (CLAUDE.md and .claude/rules/*.md contents)
- Rolled-back diff (when applicable)

This data is governed by Anthropic's privacy policy: https://www.anthropic.com/legal/privacy

## Data NOT sent
- Files outside the project root
- API keys, secrets, environment variables (unless they appear in tool calls — use stetkeep PreToolUse to sanitize)
- Historical session data from previous sessions
- Personal identifiers beyond what's in the project files

## Local data storage

reflect writes to:
- `.reflect/state.json` — session state (signal counts, cooldown). Reset on new session.
- `.reflect/session-guidance.md` — current reflection. Overwritten on next trigger. Deleted on session end.
- `.reflect/session-log.jsonl` — opt-in only (`REFLECT_LOG_ENABLED=1`). Auto-deleted after 168 hours.
- `.reflect/trigger.log` — debug log of background invocations. User can delete anytime.

All within your project directory. Nothing is stored elsewhere.

## Third-party services

- **Anthropic API** — for the Opus 4.7 reflection call. Required.
- **stetkeep** (npm package, CJ's other MIT project) — local-only library. No network.
- **No analytics / tracking** services.

## Cookies, tracking, advertising

None. reflect is a CLI / Node library — no web component.

## Children's privacy

Not applicable. reflect is a developer tool with no minor-targeted functionality.

## Contact

For privacy questions, email **cj@chanjoongx.com** or open an issue at https://github.com/chanjoongx/reflect/issues.

## Changes

Any future changes to this policy will be committed to this file. Check git history for revisions.
