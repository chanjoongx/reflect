# Troubleshooting

Common issues + fixes for reflect.

---

## Setup

### `ANTHROPIC_API_KEY is not set`
1. Ensure `.env` exists in your project root
2. `.env` contains: `ANTHROPIC_API_KEY=sk-ant-...`
3. If using `npx reflect`, the env may not load — try `npm run reflect` or `dotenv -e .env npx reflect`

### `npm install reflect` fails
- Node 20+ required: `node --version`
- Try `npm install --no-optional` if peer deps issue

### Hook doesn't fire after reverts
1. Check `.claude/settings.json` exists with `hooks.PostToolUse` block
2. Test hook manually:
   ```bash
   echo '{"tool_name":"Bash","tool_input":{"command":"git restore foo.ts"},"session_id":"test"}' | bash .claude/hooks/reflect-trigger.sh
   ```
3. Verify hook executable: `ls -la .claude/hooks/reflect-trigger.sh` should show `x` permissions

### Path-scoped rule not loading
- Check `.claude/rules/reflect-rules.md` exists
- Check the `paths:` frontmatter matches your file paths
- Restart Claude Code (rules load at session start)

---

## Triggering

### Reflection never fires
- Check signal accumulation: `cat .reflect/state.json` after a few reverts
- If `signals` array is empty, hook isn't detecting reverts
- Try lower threshold: `REFLECT_TRIGGER_THRESHOLD=1.5 npx reflect manual`

### Reflection fires too often
- Raise `REFLECT_TRIGGER_THRESHOLD` to 3.0+
- Raise `REFLECT_COOLDOWN_TURNS` to 10+

### Manual `/brain-reflect` doesn't work
- Verify subagent installed: `ls .claude/agents/reflection-orchestrator.md`
- Verify command installed: `ls .claude/commands/brain-reflect.md`
- Restart Claude Code (commands + agents load at session start)

---

## API issues

### 400 — `thinking.budget_tokens not supported`
You're hitting Opus 4.7 with old API shape. reflect's `src/opus-reflection.ts` uses `{ type: "adaptive" }` correctly. If you see this, you may have an outdated SDK or local override.

```bash
npm install @anthropic-ai/sdk@latest
```

### 400 — `temperature not supported`
Same as above — you're setting non-default sampling. reflect doesn't set sampling params. Check for environment variable or override.

### 429 — rate limit
- reflect doesn't have built-in retry yet (v1.1 TODO)
- Workaround: increase cooldown to space out triggers

### Reflection JSON parse fails
- Set `REFLECT_DEBUG=1` and inspect stderr
- Opus 4.7 may occasionally wrap output in fences — parser handles this
- If still failing, the model may have hit max_tokens — increase `maxOutputTokens` in code

---

## Cost surprises

### Daily cost > $1
- Check if trigger threshold too low
- Check if cooldown not decrementing (`.reflect/state.json`)
- See `docs/api-cost-economics.md` for tuning

### Cache hit rate stays at 0%
- First call always 0% (cold)
- If still 0% after multiple calls in same hour:
  - Check L1 ≥ 4096 tokens (Opus 4.7 floor)
  - Verify `usage.cache_creation_input_tokens > 0` on first call
  - Check session_id consistency in `.reflect/state.json`

---

## API key management

### Best practices
- Store key only in `.env` (never commit)
- `.gitignore` includes `.env` (verify with `git check-ignore .env`)
- Rotate key if exposed: platform.claude.com → API Keys → create new + delete old
- For team: each member uses own key (not a shared one)

### If key is exposed
1. **Immediately**: rotate at platform.claude.com (delete + recreate)
2. Update `.env` with new key
3. If pushed to public repo: BFG repo-cleaner or `git filter-repo` to scrub history
4. Force push (only if no provenance attestations affected)
5. Check Anthropic dashboard for unexpected usage

---

## Storage / filesystem

### `.reflect/` directory not writable
- Hook needs write access to project root
- On Windows: ensure no antivirus blocking
- Workaround: `mkdir -p .reflect && chmod 755 .reflect`

### `.reflect/state.json` corrupted
- Delete it: `rm .reflect/state.json`
- Hook will recreate on next call

### Session-log.jsonl growing too large
- Default opt-in only (`REFLECT_LOG_ENABLED=1`)
- Auto-pruned at 168h
- Manual prune: `npx reflect log --prune`

---

## Conflict with stetkeep

### Both reflect and stetkeep installed — which fires first?
- stetkeep = PreToolUse (before tool runs)
- reflect = PostToolUse (after tool runs)
- They never conflict. Order: stetkeep blocks → tool runs (or doesn't) → reflect observes

### stetkeep blocks an edit, does reflect see it?
No. If stetkeep blocks, the tool doesn't run, and PostToolUse doesn't fire. reflect simply doesn't see a signal.

This is correct behavior — reflect should only react to actual revert events.

---

## Windows-specific

### PowerShell ExecutionPolicy
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Or use `npx reflect` which bypasses policy.

### Bash script doesn't work
On native Windows, use `.ps1` version:
```json
"command": "powershell -File $CLAUDE_PROJECT_DIR/.claude/hooks/reflect-trigger.ps1"
```

### Git Bash routing
Native `bash` in PowerShell may route to WSL. Solution: use Git Bash directly, or use `.ps1` hook.

---

## Performance

### Hook adds noticeable latency to tool calls
The hook itself is fast (<100ms). The reflection call (when triggered) runs **in background** — doesn't block.
If hook itself is slow:
- Check `jq` is installed (otherwise grep fallback is slower)
- Check disk I/O on `.reflect/state.json`

### Reflection takes 10+ seconds
Opus 4.7 with `effort: high` typically 2-5s. If slower:
- Check network
- Verify region (use closest API endpoint)
- Try `effort: medium` for faster response

---

## Privacy / data

### What does reflect send to Anthropic?
- The 3 prompt layers (L1 + L2 + L3)
- Recent tool calls (truncated string fields)
- Rolled-back diff (if available)
- Active rules content (CLAUDE.md, .claude/rules/*.md)

NOT sent:
- Files outside the project root
- API keys, secrets, environment variables (unless they appear in tool calls)
- Historical session data (each call is independent)

### Can I see what was sent?
Set `REFLECT_DEBUG=1` and the SDK may log requests. Or set up an HTTP proxy to inspect.

---

## Asking for help

If your issue isn't covered:
- Search existing issues: https://github.com/chanjoongx/reflect/issues
- Open a new issue with:
  - Output of `npx reflect status`
  - Contents of `.reflect/state.json` (redact session_id if private)
  - Hook output: `REFLECT_DEBUG=1 bash .claude/hooks/reflect-trigger.sh < test-input.json`
  - Expected vs actual behavior
