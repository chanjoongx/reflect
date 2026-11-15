# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.2.x | Yes |
| 0.1.x | No (its detector is retired; upgrade to 0.2) |

## Reporting a vulnerability

Email **cj@chanjoongx.com** with a subject starting with `[security]`. Include:

- A clear description of the vulnerability
- Steps to reproduce (or a minimal proof of concept)
- The affected version (`reflect version`, or the git commit SHA)
- Your preferred disclosure timeline

You will receive an acknowledgment within **72 hours**. Critical issues are patched with priority; we aim to publish a fix within 14 days of acknowledgment when feasible.

Please do **not** open public GitHub issues for security reports until a fix is released.

## Runtime attack surface

- **No runtime dependencies**: the official Anthropic SDK (`@anthropic-ai/sdk`) is bundled into `plugin/hooks/lib/`. Licenses of everything bundled are in `plugin/hooks/THIRD_PARTY_LICENSES.txt`.
- **No network calls** beyond the Anthropic Messages API: one judge call (Claude Haiku 5.5) per judged developer message, and one reflection call (Claude Opus 5.5 by default) when the trigger fires or you run `reflect manual` from a terminal. As a plugin, reflect uses only the API key from its own setting and sends it only to `https://api.anthropic.com`
- **The hooks are one Node.js bundle**: `plugin/hooks/reflect-hook.mjs`, built from `src/` by `scripts/build-hook.mjs`. CI fails if the committed bundle does not match the source. The hooks read JSON from stdin and the session transcript Claude Code points them to, and write only under `.reflect/` in the project. They never block a prompt or a tool call. Review `src/hook/run.ts` before adopting.

## Data sent to Anthropic

For each judged message, the following is sent to the Anthropic API:
- The developer's message (up to 2,500 characters)
- A summary of the agent's previous turn: its last 14 tool calls with their file or command targets, and the last 1,400 characters of what it said

When a reflection runs, it sends the turns that triggered it: for each, the agent-turn summary (up to 1,500 characters), the developer's message (up to 1,500 characters) and the span the judge quoted as evidence.

Before anything is sent, `src/redact.ts` replaces home directory paths, email addresses at common providers, phone numbers and common API key and token formats with placeholders. A secret in some other format that appears in a message or in the agent's text would be sent as is.

NOT sent:
- File contents, except what appears in the developer's message or the agent's visible text
- Environment variables (the API key travels only in the request's authentication header)
- Data from other sessions (each call is independent)

See [`plugin/PRIVACY.md`](plugin/PRIVACY.md) for full data handling.

## Scope

In scope for security reports:
- Any path that exfiltrates user code, prompts, or environment to a third party
- API key leakage through filesystem or network
- Hooks that modify files outside the declared `.reflect/` directory
- Injection attacks through hook input parsing
- Tampering with `.reflect/` state by an external process (the hooks hand guidance from it to the agent)

Out of scope:
- Behavioral outcomes of the Claude models reflect calls (model errors are not reflect vulnerabilities)
- Deliberate user actions (e.g., `git commit --no-verify` bypassing pre-commit)
- Theoretical weaknesses in upstream Anthropic infrastructure

## Best practices for users

- Use the plugin's API key setting, which Claude Code keeps in your system's credential store; the plugin uses no other credential. If you wire the hooks by hand with a project `.env`, never commit it
- Verify `.env` is gitignored (`git check-ignore .env`)
- Rotate API key on any suspected exposure
- For team use, each member uses their own key. Never share one
- Run `reflect doctor` to confirm `.reflect/` is ignored by git
