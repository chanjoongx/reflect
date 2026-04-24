# Korean community launch playbook

> A 4-week post-hackathon rollout plan for reflect in the Korean developer community. Written bilingual — English overview for judges and international readers; Korean post drafts for each platform. Executed by [Chanjoong Kim](https://github.com/chanjoongx) (native speaker, Toss mini-app developer, Kookmin University).

---

## Why Korea, specifically

Three reasons reflect ships a Korean launch first:

1. **Author language match** — I write Korean natively. First-user community should be one I can support in their first language.
2. **Claude Code adoption curve** — Korean dev community early-adopts AI coding tools but underserved in *local-language tooling discussion*. A Korean-first launch captures the gap between "I use Claude Code" and "I understand what to do when it drifts."
3. **Compact, high-signal communities** — GeekNews, Disquiet, Toss Slash, 당근 Tech are small enough that substantive posts get read by people who'll actually file issues. Different from a generic HN post.

---

## Schedule (D+1 through D+28)

| Day | Platform | Post type | Goal |
|---|---|---|---|
| D+1 | GeekNews (`news.hada.io`) | News link + comment-thread explainer | Reach general KR dev audience |
| D+3 | Disquiet (`disquiet.io`) | Maker showcase | Reach Korean indie-maker community |
| D+5 | Toss Slash `#ai-tools` channel (if access) | Practitioner-to-practitioner share | Reach fintech engineers |
| D+7 | 당근 Tech blog (guest post pitch) | Long-form engineering article | Reach Karrot engineering network |
| D+14 | LinkedIn Korean post | Career-context share | Reach wider KR professional network |
| D+21 | Reddit `r/programming` + HN (English) | Cross-post with English tutorial | Reach global audience, cite Korean posts for community evidence |
| D+28 | Personal blog tutorial | Deep-dive tutorial | The canonical long-form reference (already drafted in `docs/tutorial.md`) |

Each platform has a different voice register. GeekNews is terse + commented by engineers. Disquiet is warmer, community-oriented. 당근 Tech is long-form engineering with measured metrics. LinkedIn is career-context. Reddit/HN is blunt technical.

Drafts below are first-draft starting points, not final copy. CJ edits before posting.

---

## D+1 — GeekNews post draft

**제목 (Title)**:
> reflect — Claude Code 를 위한 session-local metacognition harness (Opus 4.7 해커톤 빌드)

**본문 (Body, ~200 words)**:
```
Claude Code 를 /loop 모드로 장시간 돌리면 어느 순간부터 같은 실수를 반복하는 drift 가 생깁니다. 3시간 세션의 마지막 1시간이 보통 그렇습니다. 이 drift 는 어느 한 turn 만 봐서는 안 보입니다 — revert 들이 clustering 되는 걸 여러 turn 에 걸쳐 봐야 signal 이 드러납니다.

reflect 는 이 clustering 을 post-hoc 으로 감지합니다. PostToolUse hook 이 git revert / restore / rm 같은 Tier 1/2 signal + UserPromptSubmit 의 Tier 3 utterance ("no wait", "undo that") 를 누적해서, cum_x100 >= 240 crossing 시 background 에서 Opus 4.7 에게 "최근 20 tool call + active rule + rolled-back diff" 를 넘겨서 single-shot 로 reflection JSON 을 받습니다. 이 JSON 이 다음 turn 의 path-scoped rule 을 통해 Claude 에 주입되어 behavior 가 조정됩니다.

Session-local 입니다. Persistence 없습니다. 의도적입니다 — v1 은 "한 session 안에서 작동하는 하나의 loop" 만 검증하고, Phase 2 persistence 는 useful_rate > 60% 의 실제 signal 이 있을 때만 갑니다.

Boris Cherny 의 "4.7's biggest edge is long-running work" thesis 에 대응하는 tool 의 첫 시도입니다. stetkeep (정적 prevention) 과 composition 으로 쓰입니다.

MIT. GitHub: chanjoongx/reflect. 설치: npm install @chanjoongx/reflect@alpha
```

**Expected engagement**: 20-40 comments if picked by curator, 5-15 otherwise. High-quality commenters. Primary goal is "Korean Claude Code power-users know this exists."

---

## D+3 — Disquiet 메이커 showcase post draft

**제목**:
> AI 코딩 장시간 세션의 drift 를 잡는 reflect — session-local 설계가 왜 중요한가

**본문 (~400 words, 메이커 voice)**:
```
안녕하세요. 김찬중 (chanjoongx) 입니다. 미국 어바인에서 J-1 비자로 거주 중인 국민대 3학년 AI 전공 학생이고, Toss 미니앱 20개를 출시했습니다. 기존에 stetkeep 이라는 Claude Code plugin 을 npm + Anthropic marketplace 로 올렸고, 그 위에 reflect 를 쌓았습니다.

reflect 를 만든 이유는 단순합니다. Claude Code 를 /loop 으로 3시간 돌리면 첫 90분은 완벽한데, 2시간쯤부터 같은 실수를 반복합니다. 제가 revert 합니다. 다시 비슷하게 합니다. 제가 또 revert 합니다. 세 번째 revert 시점에 신호가 명백한데, Claude 는 그 clustering 을 못 봅니다 — context window 는 이미 앞으로 움직였고, 각 turn 을 독립적으로 판단합니다.

reflect 는 이 clustering 을 감지해서 Opus 4.7 에 post-hoc 으로 질문합니다: "지난 20 tool call 동안 뭘 하려던 거고, 왜 revert 당한 건가?" 답이 오면 다음 turn 의 guidance 로 주입됩니다.

중요한 결정: **session-local 만 한다**. 업계 전체가 cross-session learning (Devin, Cline) 방향인데, 저는 반대로 갔습니다. 이유는 (1) privacy — 오전 regulatory code 와 저녁 개인 프로젝트가 같은 memory 에 섞이는 건 실무에서 좋지 않음, (2) cost — 모든 session 이 cross-session retrieval 비용 지불할 필요 없음, (3) drift 의 compounding — 잘못된 reflection 이 silently persist 되는 게 session 내 잘못된 reflection 보다 훨씬 위험.

v1 이 이 철학의 검증입니다. Phase 2 persistence 는 50 users × 10 sessions, useful_rate > 60% 일 때만 ship 합니다.

해커톤 week 에 발견한 것: reflect 를 Markdown 에 regulatory literal (FinCEN $10,000) 시나리오로 테스트했더니, 의외로 Opus 4.7 이 pre-execution 에서 대부분의 contradiction 을 미리 차단했습니다. reflect 가 fire 할 필요가 없었습니다. 이게 **two complementary safety layers** 입니다 — Claude intrinsic (turn-visible contradiction) + reflect post-hoc (multi-turn accumulated pattern). 서로 보완적이고, 겹치지 않습니다.

설치: `npm install @chanjoongx/reflect@alpha`. MIT. github.com/chanjoongx/reflect

피드백 환영합니다. 특히 failure-mode report (reflect 가 fire 했는데 bad guidance 를 준 경우) 을 가장 감사히 받습니다.
```

**Expected engagement**: 5-10 upvotes + 3-5 substantive comments. Makers who try it and file issues.

---

## D+5 — Toss Slash practitioner-to-practitioner share (if channel access)

**Post** (Slack-style, casual):
```
@here Claude Code 오래 돌리시는 분들. 3시간 넘어가면서 drift 느낀 적 있으면 reflect 한번 깔아보세요.

기존 stetkeep (prevention) 은 이미 설치하신 분들 많죠? reflect 는 거기에 post-hoc reasoning 레이어 추가한 거예요. 같은 패턴 revert 3회 넘으면 Opus 4.7 한테 "뭐가 문제였나" 질문 보내고, 답이 다음 turn 에 주입됩니다.

session-local 이고 persistence 없어서 팀 tool 로 안 어울릴 수 있는데, 개인 세션에서는 유용하실 거예요. 특히 새벽에 /loop 돌려놓고 자고 일어나서 git diff 보다가 머리 잡는 경험 해보신 분이면.

`npm install @chanjoongx/reflect@alpha` + `npx reflect init` 하시면 됩니다. github.com/chanjoongx/reflect

해커톤 출품작인데 honest gotchas README 에 다 적어뒀어요. 버그 발견하시면 issue 열어주세요.
```

**Expected engagement**: 3-5 DMs from colleagues who try it. Most valuable signal — practitioners with real workflows.

---

## D+7 — 당근 Tech blog guest post pitch

**Pitch email (to 당근 Tech blog editor):**
```
안녕하세요, 당근 엔지니어링 블로그 에디터 팀.

저는 Chanjoong Kim (chanjoongx) 입니다. 국민대 AI 전공 3학년이고, 작년 Built with Opus 4.7 해커톤에서 reflect (session-local metacognition harness for Claude Code) 를 만들어 제출했습니다. 기존 작업인 stetkeep (Anthropic 공식 마켓 심사 중) 과 composition 으로 작동합니다.

당근 Tech blog 에 "Claude Code 장시간 세션의 drift 를 어떻게 감지하고 완화하나" 라는 주제로 guest post 를 제안드립니다. 약 3,000 단어, 섹션 구성:

1. Boris Cherny 의 "4.7 is long-running work" thesis 를 한국 dev 관점에서 재해석
2. 실제 drift 의 3-tier signal taxonomy (hard / inferred / utterance)
3. Single-shot Opus 4.7 reflection 의 3-layer prompt cache 설계 (cold $0.05, warm $0.01)
4. "Two complementary safety layers" — Claude intrinsic reasoning + reflect post-hoc (해커톤 week 에 발견한 architectural insight)
5. v1 session-local 결정의 privacy/cost/drift rationale
6. 실제 failure-mode report (cold-start, intent-shift, regulatory domain)

당근 엔지니어링이 AI 도입에 전향적이고, practitioner audience 가 많아서 이 주제가 잘 맞을 것 같습니다. Draft 는 1주일 안에 보내드릴 수 있습니다.

github.com/chanjoongx/reflect — MIT, npm @chanjoongx/reflect

감사합니다.
Chanjoong Kim
cj@chanjoongx.com
```

**Expected outcome**: 30% acceptance (당근 Tech blog is selective). If accepted, ~5,000 page views, 50+ long-tail inbound links from KR dev community.

---

## D+14 — LinkedIn Korean post

**한국어 본문 (~150 words)**:
```
지난 주 Built with Opus 4.7 해커톤에 reflect 를 제출했습니다.

Claude Code 로 /loop 모드 장시간 세션 돌리면 drift 가 생기는데, 이걸 post-hoc 으로 감지하는 harness 입니다. Revert clustering 이 threshold 넘으면 Opus 4.7 에 "지난 20 tool call 맥락에서 뭐가 틀렸나" 묻고, 답을 다음 turn 에 주입합니다.

v1 은 session-local 만 합니다 — 의도적 선택입니다. Privacy + cost + drift compounding risk 세 가지 이유로 cross-session learning 을 v2 로 미룹니다.

기존 stetkeep (prevention) 위에 쌓은 두 번째 Claude Code tool 입니다. stetkeep 은 Anthropic 공식 마켓 심사 중이고, reflect 는 npm @chanjoongx/reflect 로 배포했습니다.

Built in 6 days. MIT. github.com/chanjoongx/reflect

해커톤 심사 결과는 4/28 에 발표됩니다. 한국 dev 커뮤니티에서 피드백 주시면 v0.2 에 반영하겠습니다.

#ClaudeCode #AI #OpenSource #해커톤
```

**Expected engagement**: 20-40 reactions, 3-5 comments. Career-context share — seen by potential employers + collaborators.

---

## D+21 — Reddit `r/programming` + HN (English cross-post)

**HN title**: "Show HN: reflect – session-local metacognition harness for Claude Code (Opus 4.7)"

**Body** (HN + Reddit same draft):
```
Built during the Built with Opus 4.7 hackathon (Anthropic + Cerebral Valley, 2026-04-21 to 04-26).

TL;DR: When Claude Code drifts over a multi-hour session — same misjudgment repeated 3+ times in 10 tool calls — reflect hands the recent tool history to Opus 4.7 in a single-shot background call, gets back a structured reflection (pattern / signal / adjustment), and writes it to `.reflect/session-guidance.md` for the next turn to pick up via a path-scoped rule.

Three design choices that differ from most of the space:

1. **Session-local only.** No cross-session memory. v1 privacy/cost/drift-risk decision. Phase 2 persistence gated on useful_rate > 60% across 50+ users × 10+ sessions.

2. **Three-tier signal taxonomy.** Hard reverts (git revert/restore), inferred reverts (rm of user file), utterance negation ("no wait"). Weighted threshold at 2.4 of 10 turns. All measured in `cum_x100` integer math so shell hook needs no `bc` or `jq`.

3. **Three-layer prompt cache.** L1 stable (1h TTL, 4,741 tok) + L2 medium (5m) + L3 ephemeral. Cold call $0.05, warm $0.01 with 95%+ cache hit. Opus 4.7's 4,096-token cache floor caught me silently on the first call — padded L1 to 4,741 with calibration examples.

Honest failure modes documented: cold-start sessions, intent-shift false triggers, regulatory domains. One hackathon-week finding: Claude's own pre-execution reasoning catches some cases before reflect can fire — complementary safety layers, not redundant.

`npm install @chanjoongx/reflect@alpha`. MIT. Tutorial at github.com/chanjoongx/reflect/blob/main/docs/tutorial.md.

Source: github.com/chanjoongx/reflect
```

**Expected engagement on HN**: 20-80 points if picked; 30-100 comments. Peak exposure. Cite Korean community posts in comments for "international builder" angle.

---

## D+28 — Personal blog tutorial

Already drafted at `docs/tutorial.md`. Publish to personal site + dev.to + Medium. Canonical long-form reference.

---

## Metrics (post-launch tracking)

| Metric | Target (D+30) | Stretch (D+90) |
|---|---|---|
| GitHub stars | 100 | 500 |
| npm weekly downloads | 50 | 300 |
| Real installs (via telemetry opt-in, if we add) | n/a (v1 no telemetry) | 30 with opt-in in v0.2 |
| Issues filed (failure mode reports preferred) | 3 | 10 |
| PRs (community contribution) | 1 | 5 |
| Korean dev community mentions | 3 platforms | 6 platforms |

These are aspirational. Honest calibration: most hackathon projects get 10-30 stars and 2 issues in the first month. reflect's differentiator (session-local + stetkeep composition + honest failure modes) may or may not move those numbers.

---

## Anti-goals

- **No paid promotion.** Organic community engagement only. Korean dev community smells sponsored posts immediately.
- **No over-claiming.** useful_rate, cost, and cache-hit numbers are honest single-subject measurements. Never extrapolate to "this will save you X hours per week."
- **No Phase 2 promises.** Persistence is gated on v1 signal. Do not pre-announce persistence to drive adoption.
- **No cross-session memory as marketing hook.** The whole point of v1 is that we don't do that.

---

*Last updated: 2026-04-24 D5 afternoon, post-Scenarios 2/3. Executed post-submission — CJ will adapt drafts to whatever the demo + submission look like after 2026-04-26 5 PM PT deadline.*
