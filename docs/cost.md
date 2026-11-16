# What reflect costs

reflect makes two kinds of model call. A judge call runs on most of your messages. A reflection runs only when pushback clusters. The plugin sends both through your Claude Code session's own client, so they are billed like the session's own requests: Claude Code counts them in the session's cost, `/usage` shows the share from mods, and on a subscription they count toward your usage. The npm command bills them to your Anthropic key. The judge figures below were measured on 2026-11-16 over the 837 benchmark turns with Claude Haiku 5.5. The reflection has three live measurements on Claude Opus 5.5 so far.

For the plugin, `/usage` shows what its calls cost; the plugin itself keeps only a running total in memory, for the cap. With the npm command your actual spend is logged. Each `verdict` and `guidance` event in `.reflect/sessions/<id>/events.jsonl` records its cost, `reflect status` shows the session total against the cap, and every note in `.reflect/session-guidance.md` ends with the model and cost of the call that wrote it.

## Prices used

From `src/pricing.ts`, as of 2026-11-16, in USD per million tokens. These are API list prices, which both forms use for the spend cap; what your session's provider or plan charges can differ. Check the Anthropic pricing page before relying on them.

| model | role | input | output | cache read | cache write |
|---|---|---:|---:|---:|---:|
| Claude Haiku 5.5 | judge | $0.10 | $0.50 | $0.01 | $0.20 (1 hour) |
| Claude Opus 5.5 | reflection | $4 | $20 | $0.20 | $5 (5 minutes) |

Haiku 5.5's rate rises to $0.50 / $2.50 for prompts over 100K tokens. A judge prompt is far below that.

## The judge

The November reruns sent all 837 benchmark turns to Claude Haiku 5.5. With the 0.4 requests, the plugin's and the npm command's, a call averaged $0.00026: about 4,600 input tokens, of which about 2,840 were read from cache, 105 output tokens, and 1.3 seconds. In 0.4 both forms put the verdict schema at the end of the message as text, which adds about 150 uncached input tokens to each call.

The 0.2 and 0.3 request shows how the cache works. A call averaged 4,806 input tokens and 98 output tokens and took 1.4 seconds. Of the input, 3,287 tokens are the system prompt, which is sent with a one-hour cache marker and was read from cache on every call of that run. The other 1,519 are the developer's message and the summary of the agent's previous turn.

| judge call | arithmetic, per million tokens | cost |
|---|---|---:|
| system prompt read from cache (the usual case) | 3,287 × $0.01 + 1,519 × $0.10 + 98 × $0.50 | $0.00023 |
| first call in an hour (writes the cache) | 3,287 × $0.20 + 1,519 × $0.10 + 98 × $0.50 | $0.00086 |
| nothing cached | 4,806 × $0.10 + 98 × $0.50 | $0.00053 |

That run averaged $0.000234 per call. In a session the cache is written once and then read on every message within the hour, so the usual case dominates.

The table's figures come from the 0.2 and 0.3 npm request, which carried a one-hour cache marker and passed the verdict schema as a structured-output format. The plugin marks the same system prompt for caching through Claude Code's client, and since 0.3 it has sent the schema as text, because the engine's completion call has no structured-output option. The $0.00026 average for 0.4 comes from the benchmark, which sends both requests straight to the API.

Not every message is judged. With the gate's one hard rule (no agent turn before the message, no call), the August corpus needed 68 judge calls per 100 messages. On turns that follow code edits the gate skips almost nothing (`bench/FINDINGS.md` §6), so for coding sessions expect a judge call on nearly every message: about $0.02 to $0.03 per 100 messages.

For comparison, the August `prod` run on Claude Haiku 4.5 cost $3.63 for the same 837 turns, $0.0043 per call. Its prompt was below Haiku 4.5's 4,096-token caching minimum, so nothing was cached.

## The reflection

Two reflections were measured on Claude Opus 5.5 on 2026-11-16 with the 0.2 hooks, both on a short scratch session:

| run | turns read | time | cost |
|---|---:|---:|---:|
| automatic, after a `k2w6` fire | 2 | 10.3 s | $0.0197 |
| `reflect manual` | 4 | 10.0 s | $0.0286 |

The same day, a live run of the 0.3 plugin, with the call going through `$.model.complete`, wrote its note in 9.1 s for $0.0248.

Its cost depends mostly on how long the model thinks, which the code does not fix, and on how long the turns it reads are. The code does fix a ceiling:

- **Input.** The system prompt is 2,444 characters. Each turn adds at most 1,500 characters of agent summary, 1,500 of developer message and 240 of evidence, plus a few headings, so about 3,400 characters per turn. A `k2w6` fire sends two turns, about 9,400 characters in all. Counting one token per character, a deliberately pessimistic rate, that is 9,400 tokens, or $0.038. The plugin also appends the reflection's JSON schema to the prompt as text, which adds to that.
- **Output.** `max_tokens` is 8,000, thinking included. At $20 per million that is at most $0.16.

So one automatic reflection costs at most about $0.20, and the three measured ones cost $0.02 to $0.03. A manual reflection (npm command only) reads more turns (6 by default, up to 12), which raises the input ceiling to about $0.09 for 6 turns and $0.17 for 12.

How often it runs: replaying the default policy over the August sessions with the 0.2 and 0.3 judge's verdicts gave 21 fires in 837 developer turns (`bench/results/session-sim-h55.md`), about 2.5 per 100 messages. At the measured cost that is about $0.06 per 100 messages; at the ceiling, about $0.50. The 0.4 judges find more pushback, and the same replay fired 30 times with the npm command's labels and 26 times with the plugin's.

## The cap

reflect stops calling models in a session once its spend there, priced from `src/pricing.ts`, reaches $0.50, the default. Change it with the plugin's spend cap setting, or with `REFLECT_MAX_USD_PER_SESSION` for the npm command, where 0 turns the API calls off. When the plugin reaches the cap, it says so once in the transcript ("reflect stopped for this session: ..."). Four details:

- The cap is checked before each judge call and again before each reflection, so a call that started under the cap still finishes and a session can end slightly past it.
- `reflect manual` does not check the cap, but its cost counts toward it. `/chanjoongx-reflect:brain-reflect` makes no API call.
- A model id missing from `src/pricing.ts` is charged at the highest rate in that table, so a custom model still runs into the cap. The plugin prices an alias it fell back to (`haiku` or `opus`) as the default model it stands for.
- In the npm command, a call that fails is not logged. If the API billed it anyway, that amount is not counted.

## Spending less

- Use a cheaper reflection model: set the plugin's reflection model, or `REFLECT_MODEL` for the npm command, to `claude-sonnet-5-5`, which is half Opus 5.5's price per token. Its notes have not been compared with Opus 5.5's.
- With the npm command, fire less often: `REFLECT_POLICY=k3w8` (3 pushbacks in 8 messages) or `k2w6-med` (ignores low-confidence verdicts). In the replay with the 0.2 and 0.3 judge's verdicts `k3w8` fired 10 times against 21 for `k2w6`, and reached fewer of the sessions that needed a note (56% against 65%). The plugin always uses `k2w6`.
- With the npm command, lower `REFLECT_EFFORT`. Less thinking means fewer output tokens.

The 0.1 cost model, for the Opus 4.7 reflection call the hackathon build made, is kept in [`docs/v0.1/api-cost-economics.md`](v0.1/api-cost-economics.md). It does not apply to 0.2 or later.
