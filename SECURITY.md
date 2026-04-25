# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x | ✅ |

## Reporting a vulnerability

Email **cj@chanjoongx.com** with a subject starting with `[security]`. Include:

- A clear description of the vulnerability
- Steps to reproduce (or a minimal proof of concept)
- The affected version (`npm view @chanjoongx/reflect version` or git commit SHA)
- Your preferred disclosure timeline

You will receive an acknowledgment within **72 hours**. Critical issues are patched with priority; we aim to publish a fix within 14 days of acknowledgment when feasible.

Please do **not** open public GitHub issues for security reports until a fix is released.

## Runtime attack surface

- **Single external dependency**: `@anthropic-ai/sdk` (official Anthropic SDK)
- **One additional dependency**: `stetkeep` (CJ's other MIT npm package, used for path-scoped rule loading)
- **No network calls** beyond the single Opus 4.7 Messages API call per reflection
- **Hooks are shell scripts** — review `hooks/reflect-trigger.sh` and `hooks/reflect-trigger.ps1` before adopting. They read JSON from stdin, detect signal patterns, write to `.reflect/state.json`, and may invoke `bin/reflect.ts` in background. They do not modify files outside `.reflect/`.

## Data sent to Anthropic

When a reflection fires, the following is sent to the Anthropic API:
- 3-layer prompt (system + active rules + recent tool calls + diff)
- Recent tool call summaries (long string fields truncated)
- Active rule files (CLAUDE.md, .claude/rules/*.md content)

NOT sent:
- Files outside the project root
- API keys, secrets, environment variables (unless they appear in tool calls — sanitize via stetkeep PreToolUse hook)
- Historical session data (each call is independent)

See [`PRIVACY.md`](PRIVACY.md) for full data handling.

## Scope

In scope for security reports:
- Any path that exfiltrates user code, prompts, or environment to a third party
- API key leakage through filesystem or network
- Hooks that modify files outside the declared `.reflect/` directory
- Injection attacks through hook input parsing
- Cache poisoning or guidance file manipulation by external process

Out of scope:
- Behavioral outcomes of Opus 4.7 (model errors are not reflect vulnerabilities)
- Deliberate user actions (e.g., `git commit --no-verify` bypassing pre-commit)
- Theoretical weaknesses in upstream Anthropic infrastructure

## Best practices for users

- Store `ANTHROPIC_API_KEY` only in `.env` (never commit)
- Verify `.env` is gitignored (`git check-ignore .env`)
- Rotate API key on any suspected exposure
- For team use, each member uses own key — never share
- Pre-commit PII scanner is included — verify it's installed and executable
