# reflect 0.1 documents

These files describe reflect 0.1.4, the build written during the Built with Opus 4.7 hackathon in April 2026. They are kept as a record. None of them describes how 0.2 works; for that, read [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

The 0.1 detector never fired on real work. Replayed over 109 real sessions in July 2026, it fired zero times ([`evals/FINDINGS.md`](../../evals/FINDINGS.md)). In August it found 0 of 141 reference pushbacks in 837 developer turns from 224 sessions ([`bench/FINDINGS.md`](../../bench/FINDINGS.md) §3). Its weights assumed a developer who undoes work with `git revert` or `git restore`, and its English negation regex matched none of the 837 messages. Version 0.2 replaced it with a judge that reads each message next to what the agent had just done.

Numbers in these files come from April 2026 calls to Claude Opus 4.7 with the 0.1 prompt. They do not carry over to 0.2.

| file | what it was |
|---|---|
| [`REFLECT.md`](REFLECT.md) | The XML-tagged protocol the 0.1 reflection prompt followed |
| [`reflection-prompt-design.md`](reflection-prompt-design.md) | Design principles behind the 0.1 reflection prompt and its JSON schema |
| [`opus-4.7-best-practices.md`](opus-4.7-best-practices.md) | API parameter notes for Opus 4.7 as of April 2026 |
| [`measurements.md`](measurements.md) | Cost, cache hit rate and failure modes measured during the hackathon week |
| [`api-cost-economics.md`](api-cost-economics.md) | Cost model for the 0.1 reflection call, replaced by [`docs/cost.md`](../cost.md) |
| [`tutorial.md`](tutorial.md) | Build diary of the six hackathon days |
| [`benchmark-comparison.md`](benchmark-comparison.md) | How 0.1 compared with neighboring tools |
| [`launch-korea.md`](launch-korea.md) | A post-hackathon launch plan for the Korean developer community |
| [`experiments/`](experiments/) | Two ablation designs, both deferred and never run |

Relative links inside these files were updated for the move. Other things they mention, such as `bin/reflect.ts`, the shell hooks and `.claude/rules/reflect-rules.md`, were removed in 0.2.0.
