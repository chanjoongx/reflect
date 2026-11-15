# What reflect costs

reflect makes two kinds of API call, both billed to your Anthropic key. A judge call runs on most of your messages. A reflection runs only when pushback clusters. The judge figures below were measured on 2026-11-16 over the 837 benchmark turns with Claude Haiku 5.5. The reflection has two live measurements on Claude Opus 5.5 so far.

Your actual spend is logged. Each `verdict` and `guidance` event in `.reflect/sessions/<id>/events.jsonl` records its cost, `reflect status` shows the session total against the cap, and every note in `.reflect/session-guidance.md` ends with the model and cost of the call that wrote it.

## Prices used

From `src/pricing.ts`, as of 2026-11-16, in USD per million tokens. Check the Anthropic pricing page before relying on them.

| model | role | input | output | cache read | cache write |
|---|---|---:|---:|---:|---:|
| Claude Haiku 5.5 | judge | $0.10 | $0.50 | $0.01 | $0.20 (1 hour) |
| Claude Opus 5.5 | reflection | $4 | $20 | $0.20 | $5 (5 minutes) |

Haiku 5.5's rate rises to $0.50 / $2.50 for prompts over 100K tokens. A judge prompt is far below that.

## The judge

The November rerun sent all 837 benchmark turns to Claude Haiku 5.5. A call averaged 4,806 input tokens and 98 output tokens and took 1.4 seconds. Of the input, 3,287 tokens are the system prompt, which is sent with a one-hour cache marker and was read from cache on every call of that run. The other 1,519 are the developer's message and the summary of the agent's previous turn.

| judge call | arithmetic, per million tokens | cost |
|---|---|---:|
| system prompt read from cache (the usual case) | 3,287 × $0.01 + 1,519 × $0.10 + 98 × $0.50 | $0.00023 |
| first call in an hour (writes the cache) | 3,287 × $0.20 + 1,519 × $0.10 + 98 × $0.50 | $0.00086 |
| nothing cached | 4,806 × $0.10 + 98 × $0.50 | $0.00053 |

The benchmark run averaged $0.000234 per call. In a session the cache is written once and then read on every message within the hour, so the usual case dominates.

Not every message is judged. With the gate's one hard rule (no agent turn before the message, no call), the August corpus needed 68 judge calls per 100 messages. On turns that follow code edits the gate skips almost nothing (`bench/FINDINGS.md` §6), so for coding sessions expect a judge call on nearly every message: about $0.02 to $0.03 per 100 messages.

For comparison, the August `prod` run on Claude Haiku 4.5 cost $3.63 for the same 837 turns, $0.0043 per call. Its prompt was below Haiku 4.5's 4,096-token caching minimum, so nothing was cached.

## The reflection

Two reflections were measured on Claude Opus 5.5 on 2026-11-16, both on a short scratch session:

| run | turns read | time | cost |
|---|---:|---:|---:|
| automatic, after a `k2w6` fire | 2 | 10.3 s | $0.0197 |
| `reflect manual` | 4 | 10.0 s | $0.0286 |

Its cost depends mostly on how long the model thinks, which the code does not fix, and on how long the turns it reads are. The code does fix a ceiling:

- **Input.** The system prompt is 2,444 characters. Each turn adds at most 1,500 characters of agent summary, 1,500 of developer message and 240 of evidence, plus a few headings, so about 3,400 characters per turn. A `k2w6` fire sends two turns, about 9,400 characters in all. Counting one token per character, a deliberately pessimistic rate, that is 9,400 tokens, or $0.038.
- **Output.** `max_tokens` is 8,000, thinking included. At $20 per million that is at most $0.16.

So one automatic reflection costs at most about $0.20, and the two measured ones cost $0.02 to $0.03. A manual reflection reads more turns (6 by default, up to 12), which raises the input ceiling to about $0.09 for 6 turns and $0.17 for 12.

How often it runs: replaying the default policy over the August sessions with the Haiku 5.5 verdicts gave 21 fires in 837 developer turns (`bench/results/session-sim-h55.md`), about 2.5 per 100 messages. At the measured cost that is about $0.06 per 100 messages; at the ceiling, about $0.50.

## The cap

reflect stops calling the API in a session once its logged spend reaches $0.50, the default. Change it with the plugin's spend-cap setting or `REFLECT_MAX_USD_PER_SESSION`; 0 turns the API calls off. Four details:

- The cap is checked before each judge call and again before each reflection. Judge calls already running when the cap is reached still finish, so a session can end slightly past it.
- `reflect manual` does not check the cap, but its cost counts toward it. `/chanjoongx-reflect:brain-reflect` makes no API call.
- A model id missing from `src/pricing.ts` is charged at the highest rate in that table, so a custom model still runs into the cap.
- A call that fails is not logged. If the API billed it anyway, that amount is not counted.

## Spending less

- Fire less often: `REFLECT_POLICY=k3w8` (3 pushbacks in 8 messages) or `k2w6-med` (ignores low-confidence verdicts). In the replay with Haiku 5.5 verdicts `k3w8` fired 10 times against 21 for `k2w6`, and reached fewer of the sessions that needed a note (56% against 65%).
- Use a cheaper reflection model: `REFLECT_MODEL=claude-sonnet-5-5` is half Opus 5.5's price per token. Its notes have not been compared with Opus 5.5's.
- Lower `REFLECT_EFFORT`. Less thinking means fewer output tokens.

The 0.1 cost model, for the Opus 4.7 reflection call the hackathon build made, is kept in [`docs/v0.1/api-cost-economics.md`](v0.1/api-cost-economics.md). It does not apply to 0.2.
