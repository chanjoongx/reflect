# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.3.x | Yes |
| 0.2.x | No (upgrade to 0.3) |
| 0.1.x | No (its detector is retired; upgrade to 0.3) |

## Reporting a vulnerability

Email **cj@chanjoongx.com** with a subject starting with `[security]`. Include:

- A clear description of the vulnerability
- Steps to reproduce (or a minimal proof of concept)
- The affected version (the plugin's version in `/plugin`, `reflect version` for the npm command, or the git commit SHA)
- Your preferred disclosure timeline

You will receive an acknowledgment within **72 hours**. Critical issues are patched with priority; we aim to publish a fix within 14 days of acknowledgment when feasible.

Please do **not** open public GitHub issues for security reports until a fix is released.

## Runtime attack surface

### The plugin

The plugin is one mod. `plugin/hooks/hooks.json` is `{ "modules": ["./reflect.ts"] }`, and Claude Code loads `plugin/hooks/reflect.ts` itself. The plugin declares no command hooks, needs no `node`, runs no program, starts no process and bundles no third-party code. The module calls `$.model.complete`, `$.clock.after`, `$.ui.log`, `$.session.usage` and `$.command.register`, and nothing else in Claude Code. `$.command.register` adds the `/reflect-status` command, which reads only what reflect holds in memory and calls no model. It has no network access, key or account of its own. Its model calls go through Claude Code's own client for the session, so they reach whatever the session uses (the Anthropic API, Amazon Bedrock, Google Vertex AI or a gateway) under the session's sign-in: one judge call (Claude Haiku 5.5) per judged developer message, and one reflection call (Claude Opus 5.5 by default) when the trigger fires.

It reads the text of messages the developer sent, main-loop tool names with their file or command and whether they failed, the agent's final reply per turn, and the session's context size. It never reads the transcript, files, Claude's memory or environment variables, and it writes nothing to disk. Its state lives in memory and is dropped when the session ends. Its hooks never block a prompt or a tool call.

`scripts/build-hook.mjs` generates the module, unminified, from `src/mod/reflect.ts` and the `src/` modules it imports. CI fails if the committed file does not match the source, or if the module uses `process`, `Buffer`, `require`, `import()`, `node:` modules, `fetch`, `eval`, a URL, `$.fs`, `$.process`, `$.http` or `$.store`, transcript messages or a fork, or calls an engine function outside those five. Review `src/mod/reflect.ts` before adopting.

### The npm command

- **No runtime dependencies**: the official Anthropic SDK (`@anthropic-ai/sdk`) is bundled into `dist/lib/`. Licenses of everything bundled are in `dist/THIRD_PARTY_LICENSES.txt`.
- **No network calls** beyond the Anthropic Messages API: one judge call per judged developer message, and one reflection call when the trigger fires or you run `reflect manual` from a terminal. The key comes from `ANTHROPIC_API_KEY`, the project's `.env` or an `ant auth login` profile.
- **Command hooks you wire yourself**: `reflect init` prints them, and they run `dist/reflect.mjs` under `node`. They read only the JSON Claude Code passes on stdin (they never open the session transcript) and write only under `.reflect/` in the project. They never block a prompt or a tool call. Review `src/hook/run.ts` before adopting.

## Data sent to the model provider

For each judged message, the following is sent, through the session's client for the plugin and to the Anthropic API for the npm command:
- The developer's message (up to 2,500 characters)
- A summary of the agent's previous turn: its last 14 tool calls with their file or command targets, and the last 1,400 characters of what it said

When a reflection runs, it sends the turns that triggered it: for each, the agent-turn summary (up to 1,500 characters), the developer's message (up to 1,500 characters) and the span the judge quoted as evidence.

Before anything is sent, `src/redact.ts` replaces home directory paths, email addresses, phone numbers and common API key and token formats with placeholders. A secret in some other format that appears in a message or in the agent's text would be sent as is.

NOT sent:
- File contents, except what appears in the developer's message or the agent's visible text
- Environment variables (the plugin holds no key; the npm command's key travels only in the request's authentication header)
- Data from other sessions (each call is independent)

See [`plugin/PRIVACY.md`](plugin/PRIVACY.md) for full data handling.

## Scope

In scope for security reports:
- Any path that exfiltrates user code, prompts, or environment to a third party
- The plugin's module reaching beyond its five engine calls, reading the transcript, or writing to disk
- API key leakage by the npm command through filesystem or network
- The npm command's hooks modifying files outside the declared `.reflect/` directory
- Injection attacks through hook input parsing
- Tampering with `.reflect/` state by an external process (the npm command's hooks hand guidance from it to the agent)

Out of scope:
- Behavioral outcomes of the Claude models reflect calls (model errors are not reflect vulnerabilities)
- Deliberate user actions (e.g., `git commit --no-verify` bypassing pre-commit)
- Theoretical weaknesses in upstream Anthropic infrastructure

## Best practices for users

- The plugin needs no API key; its calls use your Claude Code session's sign-in. If you wire the npm command's hooks by hand with a project `.env`, never commit it
- Verify `.env` is gitignored (`git check-ignore .env`)
- Rotate API key on any suspected exposure
- For team use, each member uses their own key. Never share one
- Run `reflect doctor` to confirm `.reflect/` is ignored by git
