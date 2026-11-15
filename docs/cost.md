# What reflect costs

reflect makes two kinds of API call, both billed to your Anthropic key. A judge call runs on most of your messages. A reflection runs only when pushback clusters. Every figure below is an estimate: the judge's token counts come from the August 2026 benchmark, which ran Claude Haiku 4.5, and no reflection has yet been measured on Claude Opus 5.5.

Your actual spend is logged. Each `verdict` and `guidance` event in `.reflect/sessions/<id>/events.jsonl` records its cost, `reflect status` shows the session total against the cap, and every note in `.reflect/session-guidance.md` ends with the model and cost of the call that wrote it.

## Prices used

From `src/pricing.ts`, as of 2026-11-16, in USD per million tokens. Check the Anthropic pricing page before relying on them.

| model | role | input | output | cache read | cache write |
|---|---|---:|---:|---:|---:|
| Claude Haiku 5.5 | judge | $0.10 | $0.50 | $0.01 | $0.20 (1 hour) |
| Claude Opus 5.5 | reflection | $4 | $20 | $0.20 | $5 (5 minutes) |

Haiku 5.5's rate rises to $0.50 / $2.50 for prompts over 100K tokens. A judge prompt is far below that.

## The judge

In the August benchmark's `prod` run, Claude Haiku 4.5 judged 837 developer turns. A call averaged about 3,900 input tokens and 90 output tokens, and the run cost $3.63 at Haiku 4.5's prices ($1 / $5). Haiku 5.5 is ten times cheaper on both input and output, so the same tokens cost about $0.36, or $0.00044 per call.

That figure assumes nothing is cached. The judge's system prompt is about 2,200 tokens and is sent with a one-hour cache marker. It cleared no cache on Haiku 4.5, whose minimum cacheable prefix is 4,096 tokens (`bench/FINDINGS.md` §10). Haiku 5.5's floor is 512 tokens (`src/models.ts`), so the prompt should be cached there:

| judge call | arithmetic | estimate |
|---|---|---:|
| nothing cached | 3,900 × $0.10 + 90 × $0.50, per million | $0.00044 |
| system prompt read from cache | 2,200 × $0.01 + 1,700 × $0.10 + 90 × $0.50 | $0.00024 |
| first call in an hour (writes the cache) | 2,200 × $0.20 + 1,700 × $0.10 + 90 × $0.50 | $0.00066 |

Token counts are Haiku 4.5's. Anthropic's model notes say Haiku 5.5's newer tokenizer counts the same text as about 30% more tokens, which raises each row by about that much: $0.00031 to $0.00086 per call. Its caching has not been checked against real usage fields yet.

Not every message is judged. With the gate's one hard rule (no agent turn before the message, no call), the August corpus needed 68 judge calls per 100 messages. On turns that follow code edits the gate skips almost nothing (`bench/FINDINGS.md` §6), so for coding sessions expect a judge call on nearly every message. With the tokenizer adjustment, that puts the judge at roughly $0.02 to $0.06 per 100 messages.

## The reflection

The reflection has not been measured on Opus 5.5. Its cost depends mostly on how long the model thinks, which the code does not fix. What the code does fix is a ceiling:

- **Input.** The system prompt is 2,444 characters. Each turn adds at most 1,500 characters of agent summary, 1,500 of developer message and 240 of evidence, plus a few headings, so about 3,400 characters per turn. A `k2w6` fire sends two turns, about 9,400 characters in all. Counting one token per character, a deliberately pessimistic rate, that is 9,400 tokens, or $0.038.
- **Output.** `max_tokens` is 8,000, thinking included. At $20 per million that is at most $0.16.

So one automatic reflection costs at most about $0.20, and usually less. A manual reflection reads more turns (6 by default, up to 12), which raises the input ceiling to about $0.09 for 6 turns and $0.17 for 12.

How often it runs: replaying the default policy over the August sessions with the Haiku 4.5 verdicts gave 20 fires in 837 developer turns (`bench/results/session-sim-prod.md`), about 2.4 per 100 messages. At the ceiling that is under $0.50 per 100 messages; the typical figure will be lower and is not yet known.

## The cap

reflect stops calling the API in a session once its logged spend reaches $0.50, the default. Change it with the plugin's spend-cap setting or `REFLECT_MAX_USD_PER_SESSION`; 0 turns the API calls off. Four details:

- The cap is checked before each judge call and again before each reflection. Judge calls already running when the cap is reached still finish, so a session can end slightly past it.
- `reflect manual` and `/reflect:brain-reflect` do not check the cap, but their cost counts toward it.
- A model id missing from `src/pricing.ts` is charged at the highest rate in that table, so a custom model still runs into the cap.
- A call that fails is not logged. If the API billed it anyway, that amount is not counted.

## Spending less

- Fire less often: `REFLECT_POLICY=k3w8` (3 pushbacks in 8 messages) or `k2w6-med` (ignores low-confidence verdicts). In the August replay `k3w8` fired 8 times against 20 for `k2w6`, and found fewer of the sessions that needed it.
- Use a cheaper reflection model: `REFLECT_MODEL=claude-sonnet-5-5` is half Opus 5.5's price per token. Its notes have not been compared with Opus 5.5's.
- Lower `REFLECT_EFFORT`. Less thinking means fewer output tokens.

The 0.1 cost model, for the Opus 4.7 reflection call the hackathon build made, is kept in [`docs/v0.1/api-cost-economics.md`](v0.1/api-cost-economics.md). It does not apply to 0.2.
