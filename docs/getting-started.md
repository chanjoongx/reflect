# Getting Started — install to first reflection in 10 minutes

This guide gets you from `npm install` to a working `reflect` reflection in under 10 minutes.

---

## Prerequisites

- Node 20+
- Claude Code 2026+ (for hooks + path-scoped rules)
- An Anthropic API key (`sk-ant-...`)
- bash on macOS/Linux/Git Bash, or PowerShell on Windows
- `jq` optional (hook falls back to grep if absent)

---

## Step 1 — Install

```bash
cd /path/to/your-project
npm install reflect
```

This installs `reflect` and its dependency `stetkeep` (used internally for path-scoped rule auto-loading).

---

## Step 2 — Set up your API key

```bash
cp node_modules/reflect/.env.example .env
# Edit .env and replace the placeholder with your actual Anthropic API key
```

Add `.env` to your `.gitignore` if it isn't already.

---

## Step 3 — Wire the PostToolUse hook

```bash
mkdir -p .claude
cp node_modules/reflect/.claude/settings.example.json .claude/settings.json
```

If `.claude/settings.json` already exists (from other tooling), merge the `hooks.PostToolUse` block manually instead of overwriting.

On native Windows PowerShell (no Git Bash), edit the `command` field to:
```
powershell -File $CLAUDE_PROJECT_DIR/.claude/hooks/reflect-trigger.ps1
```

---

## Step 4 — Install the path-scoped rule

```bash
mkdir -p .claude/rules
cp node_modules/reflect/.claude/rules/reflect-rules.md .claude/rules/
```

This file declares that when Claude reads files in `src/**`, `lib/**`, or `app/**`, it should auto-load `.reflect/session-guidance.md` if it exists.

---

## Step 5 — Verify

```bash
npx reflect status
```

Expected output (first run, no triggers yet):

```
reflect: no active session state (no triggers fired yet)
```

---

## Step 6 — Trigger your first reflection

### Option A: Manual (immediate, bypasses threshold)

```bash
npx reflect manual --debug
```

You'll see:
```
[reflect] manual trigger — scope: session
[reflect] cost=$0.0938 cache_read=0 cache_write=6502 latency=4231ms hit_rate=0.0%

## Reflection

pattern:    (stub example — assemble real context for production use)
signal:     ...
adjustment: ...

confidence: medium | scope: this_session | FT: low
cost:       $0.0938 | cache hit: 0.0% | 4231ms
```

The first call writes the L1 + L2 cache (cold). Subsequent calls in the same hour will be ~$0.04 (warm).

### Option B: Auto trigger (real workflow)

In Claude Code, run a coding session that produces revert signals:

1. Ask Claude to refactor a file
2. Revert via `git restore <file>` or undo
3. Repeat until 3 revert signals accumulate within 10 tool calls

The PostToolUse hook will detect the cluster, invoke `bin/reflect.ts` in the background, and write `.reflect/session-guidance.md`.

Verify:
```bash
cat .reflect/session-guidance.md
```

---

## Step 7 — Use the slash command (manual trigger from inside Claude Code)

Inside a Claude Code session, type:

```
/brain-reflect
```

This invokes the `reflection-orchestrator` subagent which calls `bin/reflect.ts manual` and reports the structured reflection back.

---

## Troubleshooting

### "ANTHROPIC_API_KEY is not set"
Ensure `.env` exists in your project root and contains `ANTHROPIC_API_KEY=sk-ant-...`.
If using `npx`, it may not auto-load `.env` — load via `dotenv` or run with `npm run`.

### Hook doesn't fire after reverts
Check `.claude/settings.json` has the `hooks.PostToolUse` block.
Test the hook manually:
```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git restore foo.ts"},"session_id":"test"}' | bash .claude/hooks/reflect-trigger.sh
```

### Cache hit rate is always 0%
- First call is always 0% (cold)
- Subsequent calls within 1h should show >70%
- If still 0% after multiple calls: check `.reflect/state.json` for session_id consistency

### Reflection JSON parse fails
Opus 4.7 may occasionally wrap output in ```` ```json ```` fences. The parser handles this.
If failures persist, set `REFLECT_DEBUG=1` and inspect the raw response.

---

## Next steps

- Read [`REFLECT.md`](../REFLECT.md) for the full protocol spec
- Read [`ARCHITECTURE.md`](../ARCHITECTURE.md) for the harness vs model layer separation
- Read [`docs/opus-4.7-best-practices.md`](opus-4.7-best-practices.md) for API spec details (2026-04 corrections)
- Read [`docs/api-cost-economics.md`](api-cost-economics.md) for cost math + breakeven analysis
- Read [`docs/troubleshooting.md`](troubleshooting.md) for common issues
