# Contributing to reflect

Thank you for considering a contribution. The most useful contributions to reflect are **calibration data** — concrete cases where the reflection prompt produced poor output, with a hand-crafted "good" version.

---

## Highest-value contributions

### 1. Reflection quality reports (highest leverage)
Use the [Reflection quality issue template](.github/ISSUE_TEMPLATE/reflection_quality.yml).

Each well-documented case becomes a calibration example in the L1 prompt — improves the model for everyone.

### 2. New revert signal patterns
We currently detect 3 tiers (hard / inferred / soft). If you observe a recurring pattern that should trigger but doesn't, propose:
- Pattern definition (regex or heuristic)
- Tier classification (1, 2, or 3)
- Weight (1.0 / 0.7 / 0.5)
- Reproducer

### 3. Failure mode reports
If you find a session where reflect produces a bad reflection AND the badness was predictable (cold-start, intent change, regulatory domain), report it.

We document failure modes in [`docs/measurements.md`](docs/measurements.md#failure-modes) (and the public `README.md`'s "Honest gotchas" section).

### 4. Language ports
The harness layer is model-agnostic. Python / Rust / Go ports of `bin/reflect.ts` + `src/*` are welcome. Constraints:
- Same external API (PostToolUse hook contract)
- Same .reflect/ filesystem layout
- Strict typing where the language supports it

### 5. Reflection prompt iteration (with ablation evidence)
If you have a candidate prompt change:
1. Implement
2. Run `experiments/ablation-components.md` style test on N≥5 payloads
3. Submit PR with raw results + analysis

PRs without ablation evidence are unlikely to merge.

---

## Process

### Small contributions (issue templates, doc fixes, typo)
1. Fork
2. Edit
3. Open PR

### Medium contributions (new signal pattern, prompt tweak)
1. Open issue first describing the change
2. Wait for ack from maintainer
3. PR with implementation + test

### Large contributions (deep-reflect mode, persistence layer, ports)
1. Open issue with detailed proposal
2. Discussion + scope alignment
3. PR in phases (interface first, implementation second)

---

## Style

- **Honesty first** — never claim mechanical enforcement for prompt-only features
- **Concrete detection rules** — "regex matches `^git revert`" beats "git revert command"
- **Preserve the structured JSON output schema** — it's load-bearing for parser
- **No emojis in prompts or schemas** — they can disrupt parsing in edge cases
- **TypeScript strict** — no `any` without justification, exhaustive switches

---

## What we will reject

- Cross-session memory features that bypass the v1 session-local contract
- Prompt changes without ablation evidence
- Telemetry / data collection outside `.reflect/session-log.jsonl` (opt-in, ephemeral)
- Hooks that block tool execution (reflect is observational, not preventive — that's stetkeep)
- PRs that increase per-call cost > 20% without a corresponding quality justification

---

## Dogfooding layout

The repo contains two copies of plugin directories:

- `commands/`, `agents/`, `hooks/` at root = canonical, marketplace-distributed
- `.claude/commands/`, `.claude/agents/`, `.claude/hooks/` = mirrors

Both must stay byte-identical (CI enforces). When editing:
1. Edit root version first
2. Copy to `.claude/` mirror
3. Verify: `npm run mirror-check`

---

## Local development

```bash
git clone https://github.com/<your-username>/reflect.git
cd reflect
npm install
cp .env.example .env  # fill ANTHROPIC_API_KEY
npx tsc --noEmit
```

### Test the hook
```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git restore foo.ts"},"session_id":"test"}' | bash hooks/reflect-trigger.sh
```

### Test the API call (real Opus 4.7)
```bash
REFLECT_DEBUG=1 npx tsx bin/reflect.ts manual --debug
```

---

## Governance

- Solo maintainer (Chanjoong Kim) until traction warrants more
- All decisions traceable via issues + PR comments
- Ablation results published openly; no selective reporting

---

## Code of Conduct

Be direct. Be kind. Assume good faith. The project's own origin — a human iterating with an AI that kept proposing bad refactors — is a reminder that being wrong is normal.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.
