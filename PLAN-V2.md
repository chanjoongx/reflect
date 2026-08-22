# reflect v2 — 고도화 플랜

> **⚑ P0 게이트 통과 — 실행·적대적 검토 완료 (2026-08-23).** 이 플랜의 §7 P0는 "종이 위에서 먼저 증명,
> 실패 시 v2를 만들지 않는다"는 조건부였다. 실행했고, 통과했고, 적대적 리뷰를 거쳐 수치를 정정했다.
> 전체는 [`bench/FINDINGS.md`](bench/FINDINGS.md) · [`bench/results/report.md`](bench/results/report.md).
>
> | | 결과 (837 페어 / 224 세션 / 141 pushback) |
> |---|---|
> | B0 출시본 정규식 | **0 TP / 141 FN** — precision 0%, recall 0% |
> | B1 한국어 정규식 | P 32.4% · R 7.8% · F0.5 **19.9%** ← 넘어야 할 기준선 |
> | B5 캐스케이드 θ=0.30 | P **90.3%** · R 46.1% · F0.5 **75.8%** · judge 61/100 |
> | **관계성 — blind** | prior turn 제거 시 F1 **−10.3pt** (clustered CI [1.2, 19.8], P(Δ≤0)=0.015) |
> | **관계성 — shuffled 플라시보** | 컨텍스트를 *틀린 것*으로 교체 시 **−27.6pt**, blind 격차의 **267%** → **정보이지 포맷이 아님** |
> | 게이트 비용 | 31.5% 거부, 진짜 pushback 4건 손실 (ceiling 97.2%) |
>
> **적대적 리뷰가 정정한 것 (전부 본문 반영):**
> - κ·7-way agreement는 **관계성 근거에서 철회** — prior turn이 없는 층에서도 격차가 나타나 shared-input 효과가 섞임
> - rubric의 abstention 채널 보정 시 격차 10.3 → **6.8pt** (여전히 양수, 헤드라인보다 작음)
> - 코퍼스의 **34%만 코딩 트래픽**. 코딩 부분집합에서 pushback 30.4%(SWE-chat 39%에 근접)이고 게이트가
>   **0%**만 거르며 judge 호출이 **98/100** → 비용 우위는 비코딩 세션에서 온 것
> - **버그 12건** 수정 (pairId 충돌, surrogate 절단, head/tail 역전, fence-before-parse, tie-blind AP,
>   미수렴 로지스틱, 10 vs 13 피처, 비용 중복집계, 편향 셔플 …). 테스트 **36 → 86**
> - 손으로 정한 게이트 가중치 10개가 **단일 피처 하나**(`priorMutation>0`, AP 0.272)와 동률 — 재가중이 아니라
>   재설계 대상
>
> P0 exit criteria 충족. 남은 게이트: 사람 라벨(리뷰 시트 3종 생성됨), Corpus A(SWE-chat, gated 401), 커밋.

> **작성**: 2026-08-22 · **기준 HEAD**: `bc4c9cf` (v0.1.4, npm LIVE) · **상태**: 미커밋(untracked) 제안서
>
> 이 문서는 `evals/FINDINGS.md`(2026-07-15, "109 세션 0 fires")에 대한 **응답**이다.
> 기능 추가 목록이 아니라, 그 negative result를 제품의 축으로 삼는 재설계 플랜이다.

---

## 0. 한 문장 요약

**reflect는 잘 만든 하네스에 절대 발화하지 않는 디텍터가 붙어 있다. v2의 과제는 기능을 더하는 게 아니라, 디텍터를 판정기(judge)로 바꾸고, 그 판정기를 외부 공개 코퍼스로 측정 가능하게 만드는 것이다.**

세 개의 테제:

| # | 테제 | 근거 |
|---|---|---|
| T1 | **디텍터는 judge가 되어야 하고, 이제 judge는 사실상 공짜다** | Claude Code 2026 훅에 `type: "prompt"` (모델 호출 훅) + `Stop`의 `last_assistant_message` + `PermissionDenied`가 생겼다 |
| T2 | **평가는 외부 코퍼스로 나가야 하고, 그 코퍼스는 이제 존재한다** | SWE-chat: 6,000 세션 / 63k 프롬프트 / 355k 툴콜, **turn의 39%가 pushback**, CC BY 4.0 |
| T3 | **시각화는 세션 대시보드가 아니라 평가 워크벤치가 되어야 한다** | 현재 뷰어는 라이브 상태만 보여준다. 정작 봐야 할 건 PR curve와 confusion matrix다 |

---

## 1. 현재 상태 정밀 진단

### 1.1 측정된 사실 (evals/FINDINGS.md, 2026-07-15)

```
코퍼스: 1,606 transcripts → 109 main-thread 세션
       17,180 tool calls / 2,275 user prompts (59% 한국어)

Tier 1 (git revert/restore/checkout)  w=1.0 :      1     ← 17,180콜 중 1회
Tier 2 (rm/unlink non-artifact)       w=0.7 :     13
Tier 3 (영어 negation regex)          w=0.5 :      0     ← 2,275 중 0회
FIRES (cum_x100 >= 240)                     :      0 / 109 세션
```

threshold를 1.0(= `git revert` 한 번이면 발화)까지 내려도 **3/109 세션**. 임계값 문제가 아니다.

### 1.2 근본 원인 (FINDINGS §5의 결론)

한국어 정규식을 추가한 counterfactual은 45개 후보를 잡았고, 수동 라벨링 결과 **정밀도 ≈ 56%** (25 true / 5 borderline / 15 FP). 그리고 FP 15개 중 **8개가 프롬프트 서두의 가드레일 지시문**이었다.

```
"수정하지 마라"   새 태스크 서두에서   →  지시 (신호 아님)
"수정하지 마"     Edit 직후에          →  교정 (신호)
```

> **같은 문자열, 반대 의미. 구분자는 어휘가 아니라 "직전에 어시스턴트가 무엇을 했는가"다.**
> 버그는 "정규식이 영어다"가 아니라 **"신호가 관계적(relational)인데 디텍터가 무상태(stateless)다"**.

이 진단은 정확하고, v2 전체가 여기서 파생된다.

### 1.3 코드 레벨 부채 (읽어서 확인한 것)

| # | 문제 | 위치 | 심각도 |
|---|---|---|---|
| D1 | **디텍터 이중 구현** — 프로덕션은 shell, TS는 참조 구현, 둘이 명시적으로 divergent (파일 헤더가 자백함) | `src/revert-detector.ts` vs `hooks/*.sh`/`*.ps1` | 높음 |
| D2 | **상태 파일 read-modify-write 경합** — 두 훅이 같은 `state.json`을 grep/sed로 읽고 통째로 덮어씀. PostToolUse는 병렬 툴콜마다 발화 → lost update | `hooks/reflect-trigger.sh`, `reflect-utterance.sh` | 높음 |
| D3 | **턴 카운트가 틀림** — `turn_count`가 툴콜마다 +1. 진짜 턴 경계가 아님 (UserPromptSubmit은 의도적으로 증가 안 시킴) | 동일 | 중간 |
| D4 | **JSON 파싱이 수제** — fence 정규식 + 손으로 쓴 타입가드. structured outputs 미사용 | `src/opus-reflection.ts:parseReflection` | 중간 |
| D5 | **`next_turn_acted_on_adjustment` 죽은 필드** — 스키마엔 있고 세팅하는 코드 경로가 없음 → `computeUsefulRate()`는 영원히 0 | `src/logger.ts` | 중간 |
| D6 | **테스트 0개** — `npm test`가 `src/**/*.test.ts`를 glob하는데 파일이 없음 | — | 높음 |
| D7 | **가격/모델 하드코딩** — 2026-04 Opus 4.7 단가가 상수로 박힘, 모델도 고정 | `src/opus-reflection.ts` | 낮음 |
| D8 | **주입이 파일 쓰기 한 방향** — `additionalContext`를 쓰지 않고 `.reflect/session-guidance.md`만 씀. 규칙이 로드되길 기대함 | `src/guidance-injector.ts` | 중간 |
| D9 | **compaction 미대응** — 장시간 작업이 테제인데 컨텍스트 압축 시 가이던스가 증발 | — | 중간 |

---

## 2. 외부 리서치 — 무엇이 바뀌었나

### 2.1 Claude Code 훅 표면 (2026-08 기준, ~30 이벤트)

v1 설계 당시엔 없던, 그리고 reflect가 **정확히 필요로 하는** 것들:

| 이벤트 | reflect에게 의미 | 현재 사용 |
|---|---|---|
| **`PermissionDenied`** (+`denial_reason`) | **정답 신호.** 사용자/정책이 특정 툴콜을 거부했다. 추론이 아니라 사실 | ❌ |
| **`Stop`** (+`last_assistant_message`) | **(직전 어시스턴트 행동, 다음 발화) 쌍의 왼쪽 절반** — §1.2가 요구한 바로 그 컨텍스트 | ❌ |
| **`PostToolUseFailure`** (+`tool_error`) | 툴 실패 반복 = thrash. Wink의 "Tool Call Failures" 축 | ❌ |
| **`PostToolBatch`** (툴콜 배열, 블로킹 가능) | **진짜 턴 경계** — D3 해결 | ❌ |
| **`SubagentStop`** | FINDINGS §7의 "sidechain 1,497개 제외" 한계를 닫음 | ❌ |
| **`PreCompact` / `PostCompact`** | 압축 전에 가이던스 재주입 → D9 해결 | ❌ |
| **`type: "prompt"` 훅** (`model` 지정, JSON 반환) | **훅 안에서 모델을 부를 수 있다.** API 키 불필요, 구독 풀 사용 | ❌ |
| `type: "agent"` 훅 (실험적, Read/Grep/Glob 가능) | 깊은 판정 옵션 | ❌ |
| `additionalContext` (10,000자 상한) | 파일 대신 직접 주입 → D8 해결 | ❌ |
| `updatedInput` / `updatedResult` | 개입 옵션 (v2 범위 밖, 기록만) | ❌ |

**핵심 해금**: `type: "prompt"` 훅은 "매 프롬프트마다 모델을 부르면 비싸다"는 v1 설계의 가장 큰 제약을 무너뜨린다. v1의 정규식 트리거는 *비용 회피 설계*였다. 그 회피의 이유가 사라졌다.

> 주의: 2026-06-15 구독 빌링이 Pool 1(인터랙티브) / Pool 2(Agent SDK 크레딧)로 분리됐다. 훅 모델 호출이 어느 풀에 잡히는지는 배포 전 실측 필요 — "공짜"라고 문서에 쓰기 전에 계량한다.

### 2.2 SWE-chat — reflect가 없다고 했던 그 코퍼스

`SALT-NLP/SWE-chat` (arXiv 2604.20779, CC BY 4.0, HuggingFace)

```
6,000 세션 / 200+ repos / 63,000+ 사용자 프롬프트 / 355,000+ 툴콜 / 2.7M 이벤트
에이전트 5종 — Claude Code가 약 85%
PII 제거: Microsoft Presidio + TruffleHog
```

**핵심 수치와 분류 체계:**
- **turn의 39%가 pushback** — 코딩 모드(human-only / collaborative / vibe)와 무관하게 안정적
- hard interruption 3.3–6.0% / 에이전트의 명료화 질문 1.1–2.6% (에이전트는 거의 묻지 않는다)
- **3-class 분류**: `Correction`(방향 수정) / `Rejection`(되돌리기·재시작 요구) / `Failure Report`(깨졌다는 보고)
- 라벨링은 LLM-as-judge를 human gold label로 검증, Cohen's κ 보고, **입력 = "해당 프롬프트 직전의 전체 대화 전사"** — 즉 **관계적 판정**. 우리가 도달한 결론과 동일한 결론에 독립적으로 도달했다
- 별도 지도학습 분류기는 릴리스하지 않음 → **여기가 빈 자리다**

**이것이 FINDINGS §7의 "Single user, single language pair" 한계를 정면으로 해소한다.**

### 2.3 Wink (Meta, arXiv 2602.17037, ACM AIware'26) — 가장 가까운 선행연구

- misbehavior 분류: **Specification Drift / Reasoning Problems / Tool Call Failures**, 전체 trajectory의 **약 30%**에서 발생
- **경량 비동기 자기개입(self-intervention)** 시스템 — reflect와 동일한 아키텍처 형태
- 단일 개입으로 해결 가능한 misbehavior의 **90% 해소**, 10,000+ 실사용 trajectory, 프로덕션 A/B에서 툴 실패·세션당 토큰·엔지니어 개입이 통계적으로 유의하게 감소

**차별점 (방어 가능한 것만):**

| 축 | Wink | reflect v2 |
|---|---|---|
| 관측 대상 | **에이전트의** 오작동 (trajectory 내부) | **사용자의** 거부 (사람↔에이전트 경계) |
| 배포 | Meta 내부 프로덕션 | 로컬 · 오픈소스 · npm/플러그인 |
| 데이터 | 사내 트래픽 | 로컬 전용, 외부 전송 없음 |
| 산출물 | 시스템 | 시스템 **+ 공개 벤치마크** |

Wink는 경쟁자가 아니라 **검증**이다. "비동기 자기개입이 프로덕션에서 유의하게 작동한다"를 Meta가 10k trajectory로 증명했다. reflect는 그 증명을 로컬·오픈·사용자거부 축으로 옮긴다.

### 2.4 컨텍스트 진화 계열 — 옵트인 플레이북의 설계 근거

- **ACE** (arXiv 2510.04618): 컨텍스트를 *진화하는 플레이북*으로. generation → reflection → curation, **delta update**(통째 재작성 금지) + 의미적 중복제거 + grow-and-refine. brevity bias와 context collapse를 회피. agent 태스크 +10.6%
- **GEPA** (arXiv 2507.19457, ICLR 2026 oral): 전체 실행 trace를 읽고 자연어로 진단 → 후보 프롬프트 진화, Pareto frontier 유지. GRPO 대비 **35× 적은 rollout**
- **Reflexion / ExpeL**: 언어적 자기비판을 에피소딕 메모리에 저장 / 성공-실패 대조로 규칙 라이브러리 축적
- **알려진 실패 모드**: **self-reinforcing error** — 한 번 잘못 일반화한 규칙("X는 항상 실패한다")을 뒤집을 증거를 다시는 수집하지 않게 됨. 플레이북을 만들려면 **이걸 먼저 막아야 한다**

### 2.5 관측성 / 하네스 진화

- **Harness engineering**이 2026년의 패러다임 이름 (prompt → context → harness). Karpathy는 "vibe coding"을 폐기하고 **agentic engineering**으로 대체하며 **eval 설계 = loop engineering**을 핵심 기술로 지목: *"프롬프트 튜닝을 멈추고, 루프가 끝났는지 판정하는 verifier를 써라."*
- **Observability-driven harness evolution** (arXiv 2604.25850): 계측 → 실패 패턴 탐지 → 하네스 수정 자동 제안 → A/B. reflect는 이 루프의 "탐지" 칸을 로컬에서 채우는 도구다
- Claude Code는 **OTel을 네이티브로 방출** (`claude_code.token.usage`, `claude_code.cost.usage`, `claude_code.api_request`, `claude_code.tool_result`). GenAI semconv의 agent span은 아직 provisional
- judge cascade 실무 합의: **로컬 분류기가 ~90%를 처리하고 프론티어 judge가 tail만 판정**하면 비용이 한 자릿수로 떨어진다. flash급 judge는 반드시 human label + 프론티어로 캘리브레이션하고, 프로덕션 점수의 5–10%를 교차검증할 것

### 2.6 현재 API 사실 (v1 문서와 어긋나는 부분)

| 항목 | 코드/문서의 값 | 2026-08 현재 |
|---|---|---|
| 기본 모델 | `claude-opus-4-7` 고정 | **`claude-opus-5`** ($5/$25, 1M) — 4.7도 유효 |
| 저비용 모델 | 없음 | **`claude-haiku-4-5`** ($1/$5, 200K) ← judge용 |
| 중간 모델 | 없음 | `claude-sonnet-5` ($3/$15) |
| JSON 출력 | fence 정규식 파싱 | **`output_config: { format: ... }`** + `messages.parse()` |
| 배치 | 미사용 | Batch API **50% 할인** ← 오프라인 eval에 필수 |
| 캐시 최소 prefix | "Opus 4.7 = 4,096 tok" | 일반 가이드는 ~1,024 — **`count_tokens`로 재실측 필요** |
| thinking | `{type:"adaptive"}` ✅ | 동일. `display:"omitted"`가 기본 (Opus 5/4.8/4.7) |
| effort | `output_config.effort` ✅ | 동일, `xhigh`가 코딩/에이전트 권장값 |

D7 수정 시 `docs/api-cost-economics.md`, `docs/measurements.md`, `docs/opus-4.7-best-practices.md` 3개 문서가 함께 움직여야 한다.

---

## 3. v2 아키텍처

```
┌─ Layer 0 ── 신호 버스 (단일 Node 바이너리) ─────────────────────────┐
│  node dist/hook.js <event>    ← shell/PS 4개 구현 폐기 (D1 해결)     │
│                                                                      │
│  PermissionDenied ─┐  PostToolUseFailure ─┐  PostToolUse ─┐         │
│  Stop ─────────────┤  PostToolBatch ──────┤  SubagentStop ┤         │
│  UserPromptSubmit ─┤  PreCompact ─────────┘  SessionStart/End       │
│                    ▼                                                 │
│           .reflect/events.jsonl  (append-only, D2 해결)              │
└──────────────────────────────────────────────────────────────────────┘
                     │
┌─ Layer 1 ── 교정 판정기 (3단 캐스케이드) ───────────────────────────┐
│                                                                      │
│  Stage A  구조 게이트     ~0ms, 0 tok, 언어 무관                     │
│    · 직전 N초 내 파일변경 툴콜이 있었나?  ← 없으면 교정이 아니다      │
│    · 프롬프트가 방금 건드린 경로/심볼을 지칭하나?                     │
│    · 길이·형태 (2,000자 스펙 서두 vs 15자 응답)                      │
│    ⇒ FP 15개 중 8개(가드레일 서두)를 여기서 전부 제거                │
│                            │                                         │
│  Stage B  로컬 임베딩 점수  ~5-15ms, API 0회, 선택적 의존성          │
│    · ONNX multilingual (bge-m3 / multilingual-e5-small)              │
│    · 라벨된 교정 예시의 centroid와 코사인 → 언어 무관 점수           │
│    · 모델 미설치 시 Stage A 특징만으로 폴백                          │
│                            │  (불확실 구간만 통과)                   │
│  Stage C  관계 판정기       Haiku 4.5, 프롬프트의 5-10%만            │
│    · type:"prompt" 훅 (API 키 불필요) 또는 Messages API              │
│    · 입력: (last_assistant_message 요약, 최근 3 툴콜, 프롬프트)      │
│    · 출력: SWE-chat과 동일한 3-class + confidence + evidence_span    │
│    · timeout 8s / 실패 시 Stage B 점수로 폴백 / 절대 블로킹 안 함    │
└──────────────────────────────────────────────────────────────────────┘
                     │
┌─ Layer 2 ── 증거 누산기 (스칼라 → 스레드별 감쇠) ───────────────────┐
│  signal = { type, strength, turn, targets: [path|symbol] }           │
│  targets 겹침으로 "쟁점 스레드" 분리 → 무관한 3건이 합쳐지지 않음     │
│  턴 거리 지수 감쇠 (half-life ≈ 8턴)                                 │
│  발화: 임의 스레드가 θ 돌파  OR  PermissionDenied 1건 (θ_hard 단독)  │
│  θ는 감이 아니라 PR curve에서 선택                                   │
└──────────────────────────────────────────────────────────────────────┘
                     │
┌─ Layer 3 ── 리플렉션 (Opus 5, structured output) ───────────────────┐
│  model: claude-opus-5 / thinking: adaptive / effort: high            │
│  output_config.format = JSON schema  ← fence 정규식 폐기 (D4)        │
│  스키마 확장:                                                        │
│    + evidence[]           어떤 신호가 몇 번 턴에서 (감사 가능성)     │
│    + counter_hypothesis   "이 판단이 틀렸다면 그 이유" ← ExpeL 방어  │
│    + verify               다음 턴이 돌릴 수 있는 값싼 확인           │
│    + expires_after_turns  자동 만료                                  │
└──────────────────────────────────────────────────────────────────────┘
                     │
┌─ Layer 4 ── 주입 ────────────────────────────────────────────────────┐
│  UserPromptSubmit → hookSpecificOutput.additionalContext  (직접, D8) │
│  + .reflect/session-guidance.md 유지 (stetkeep 규칙 소비 경로)       │
│  PreCompact → 압축 직전 재주입  (D9)                                 │
│  expires_after_turns 경과 시 자동 clear                              │
└──────────────────────────────────────────────────────────────────────┘
                     │
┌─ Layer 5 ── 효능 루프 (죽은 필드 살리기) ───────────────────────────┐
│  Stop 훅 → judge: "이번 턴이 adjustment를 반영했나?"                 │
│    ⇒ next_turn_acted_on_adjustment 채움 (D5)                         │
│  + 관측 지표: 해당 쟁점 스레드가 K턴 동안 조용해졌나                 │
│  ※ 관측적 지표다. 인과 주장 아님 — 그건 A/B가 필요하다               │
└──────────────────────────────────────────────────────────────────────┘
                     │
┌─ Layer 6 ── 옵트인 플레이북 (기본 OFF) ─────────────────────────────┐
│  기본값은 session-local 유지 (프라이버시 테제 불변)                  │
│  reflect playbook promote → .claude/rules/reflect-playbook.md        │
│  ACE 방식: delta update만, 의미적 중복제거, grow-and-refine          │
│  각 bullet에 helpful/harmful 카운터 → harmful 누적 시 자동 강등      │
│  --review 로 diff 확인 후에만 기록. 로컬 밖으로 절대 안 나감          │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 왜 단일 Node 바이너리인가 (D1)

현재 하나의 스펙에 구현이 5개다: `reflect-trigger.sh`, `reflect-trigger.ps1`, `reflect-utterance.sh`, `reflect-utterance.ps1`, `src/revert-detector.ts`. 파일 헤더가 divergence를 자백하고 있고, `evals/replay_history.py`는 **shell 쪽을 정본으로 삼아 파이썬으로 6번째 구현**을 했다.

- `engines.node >= 20`은 이미 요구사항이고 플러그인은 npm으로 배포된다 → `dist/`가 이미 동봉된다
- `node` 콜드 스타트 ≈ 25–40 ms. UserPromptSubmit 30초 예산, MessageDisplay 10초 예산 안쪽에서 넉넉
- `npx tsx`는 발화 시점에만 쓰지 말고 아예 제거 (첫 실행 시 수 초 지연 위험)
- shell/PS는 남기더라도 `node dist/hook.js`를 부르는 3줄 런처로만

**결과**: 스펙 구현이 1개가 되고, `evals/replay_history.py`는 실제 프로덕션 코드를 직접 import해서 리플레이한다 (파이썬 재구현 폐기 → 리플레이 결과가 프로덕션과 정의상 일치).

### 3.2 왜 스레드별 감쇠인가 (Layer 2)

현재는 단일 monotonic 정수다. 세 가지가 틀렸다:

1. **감쇠 없음** — 40턴 전의 `rm` 하나가 지금의 짜증과 합산된다
2. **주제 분리 없음** — 서로 무관한 3건이 합쳐져 "아무것도 아닌 것"에 대해 리플렉션이 발화한다
3. **희귀 신호를 저평가** — Tier 1이 17,180콜 중 1회 발생했다. 이 정도로 희귀한 신호는 동료를 기다릴 게 아니라 **혼자 발화**해야 한다 (FINDINGS §6이 이미 지적)

`PermissionDenied`는 추론이 아니라 사실이므로 `θ_hard` 단독 발화 후보다.

### 3.3 캐스케이드 예산 (설계 목표, 측정으로 검증할 것)

| 단계 | 처리 비율 | 단가 | 지연 |
|---|---|---|---|
| A 구조 게이트 | 100% → ~25% 통과 | 0 | < 1 ms |
| B 로컬 임베딩 | ~25% → ~8% 통과 | 0 | 5–15 ms |
| C Haiku judge | ~8% | ~$0.0002/건 | 0.4–1.5 s |
| 리플렉션 (Opus 5) | 세션당 0–2회 | ~$0.01–0.05 | 4–8 s |

프롬프트 100개당 judge 호출 ~8회 = **시간당 1센트 미만**이 목표. 실측 전엔 문서에 쓰지 않는다.

---

## 4. `reflect-bench` — 레버리지가 가장 큰 항목

reflect가 지금 가진 가장 값진 자산은 코드가 아니라 **"내 도구는 3개월간 0번 발화했다"는 정직한 negative result**다. 이걸 벤치마크로 만들면 도구가 아니라 **분야의 기준점**이 된다.

### 4.1 코퍼스

| | Corpus A | Corpus B |
|---|---|---|
| 출처 | SWE-chat (**gated** — HF 로그인 필요, 401. license = ODC-BY, 논문의 CC BY 4.0 표기와 상이) | CJ 로컬 transcripts (비공개) |
| 규모 | 6,000 세션 / 63k 프롬프트 | 109 세션 / 2,275 프롬프트 |
| 언어 | 영어 지배적 | **59% 한국어** |
| 라벨 | LLM-judge silver + human gold (κ 보고됨) | 45건 1차 수동 라벨 (재라벨 필요) |
| 역할 | 주 학습·측정 | **언어 일반화 홀드아웃** |
| 이동 | HF에서 다운로드 | **로컬 밖으로 절대 안 나감** |

Corpus B는 SWE-chat이 못 주는 걸 준다: 정규식이 못 보는 언어에서의 동작. 이 조합이 FINDINGS §7의 두 한계를 동시에 닫는다.

### 4.2 지표 (전부 보고, 코퍼스별·언어별 분할)

- 클래스별 **P / R / F1**, macro-F1 — SWE-chat 3-class 체계 그대로 (비교 가능성)
- **PR-AUC** (prompt 레벨) + **세션 레벨 발화 행동** (fires/session, 첫 발화까지의 턴 수)
- **탐지 1건당 비용**, **프롬프트 100개당 judge 호출 수** ← 캐스케이드의 존재 이유
- **세션 1시간당 오발화 횟수** ← 사용자가 실제로 느끼는 짜증 지표
- UserPromptSubmit 훅 지연 **p50 / p95**

### 4.3 운영점 선택 — 비대칭 손실을 명시한다

놓친 교정의 비용 ≈ 0 (아무 일도 안 일어남). 잘못된 리플렉션의 비용 = 실제 방해 + 토큰 + 신뢰 손실.
따라서 **"recall 하한 고정 하에서 precision 최대화"**로 최적화하고, 그렇게 했다고 문서에 쓴다. 라운드 넘버(2.4 같은)는 쓰지 않는다.

### 4.4 베이스라인 (전부 ablate)

| # | 베이스라인 | 목적 |
|---|---|---|
| B0 | v0.1.4 출시본 정규식 (영어) | 현재 바닥 — Corpus B에서 0 fires 재현 |
| B1 | 한국어 증강 정규식 | FINDINGS의 56% precision counterfactual |
| B2 | Stage A 구조 게이트만 | 어휘 없이 위치만으로 어디까지 가나 |
| B3 | 임베딩만 (A 없이) | 관계 컨텍스트의 기여도 분리 |
| B4 | judge만 (게이트 없이, 전건 호출) | 정확도 상한 + 비용 상한 |
| B5 | **풀 캐스케이드 A→B→C** | 제안 |

B2가 놀랍게 강할 가능성이 실제로 있다 — 그러면 그것 자체가 발표할 만한 결과다.

### 4.5 재현성

```bash
npm run bench            # SWE-chat pinned revision 다운로드 → 캐스케이드 오프라인 실행
npm run bench -- --corpus local --projects ~/.claude/projects   # Corpus B
npm run bench:view       # 정적 리포트 생성
```

judge 단계는 **Batch API(50%)** 로 돌린다. 63k 프롬프트 전건이 아니라 층화 샘플 + 게이트 통과분만.
`evals/replay_history.py`는 프로덕션 코드를 직접 호출하도록 재작성 → 6번째 구현 제거.

### 4.6 정직성 가드

- SWE-chat 라벨은 **silver**다. silver 대비 F1을 gold인 척 보고하지 않는다. 층화 human 재라벨 필수
- FINDINGS의 45건은 105자 미리보기 기준 1차 라벨이다. 전문 기준 재라벨 + 2인 이상 κ
- 여전히 **디텍터를 측정하는 것이지 개입의 효능을 측정하는 게 아니다.** 효능은 A/B가 필요하고 N=1에선 여전히 반증 불가. 이 문장을 리포트에서 빼지 않는다

---

## 5. 시각화 플랜

세 개 표면, 각각 다른 일을 한다.

### S1 — Bench Workbench (신규, 가장 중요)

정적 export, 오프라인, 서버 없음. **세션 상태가 아니라 판정기 품질을 본다.**

| 뷰 | 하는 일 | 왜 |
|---|---|---|
| **드래그 가능한 PR curve** | 운영점을 끌면 아래 전부가 실시간 재계산 (confusion matrix, fires/session, 시간당 비용, 예시) | θ를 감으로 고르지 않게 만든다 |
| **드릴다운 confusion matrix** | FP 셀 클릭 → 실제 발화(레닥션됨)와 **직전 어시스턴트 행동**을 나란히 | §1.2의 통찰을 화면으로 만든다. "이 FP는 직전에 아무 일도 없었다"가 눈에 보임 |
| **언어 / 에이전트 / repo 슬라이스** | small-multiples PR curve | "0 fires"는 전체 평균이 아니라 슬라이스의 이야기다 |
| **캐스케이드 Sankey** | 프롬프트 100 → 게이트 통과 → 임베딩 밴드 → judge → 발화 | 비용이 어디로 가고 recall이 어디서 새는지 |
| **counterfactual 슬라이더** | FINDINGS의 threshold sweep 표를 인터랙티브로 + 코퍼스 전환 | 정적 표 → 만질 수 있는 것 |
| **비용/탐지 프론티어** | judge 호출률 vs macro-F1, 선택한 점 마킹 | 트레이드오프를 명시 |

### S2 — Session Trace (기존 뷰어 업그레이드)

| 변경 | 현재 | v2 |
|---|---|---|
| 타임라인 | 툴콜 리스트 | **턴별 워터폴** — 턴 = 레인, 툴콜 = 블록, 교정 = 수직 마커, 가이던스 = 만료 페이드가 있는 밴드 |
| 누산기 | 단일 cum meter | **스레드별 스택 영역** — *어느* 쟁점이 달아오르는지 보임 |
| 효능 | 없음 | 주입 전후 K턴의 툴콜 구성 비교 |
| 레이아웃 | — | **결정론적** — 같은 trace는 항상 같은 그림 (Langfuse 원칙) |

### S3 — OTel export (상호운용, 저비용)

reflect 자신의 스팬을 GenAI semconv로 방출 (`gen_ai.operation.name` + `reflect.*` 속성). 이미 claude-code-otel / SigNoz / Langfuse를 돌리는 사람이 같은 화면에서 reflect 이벤트를 본다. ~150 LOC. agent span 규약이 provisional임을 명시.

---

## 6. 코드 로직 정리 (D1–D9 매핑, 우선순위 순)

| 우선 | 작업 | 해소 | 규모 |
|---|---|---|---|
| 1 | 단일 `dist/hook.js`로 통합, shell/PS는 런처만, `src/revert-detector.ts`를 정본으로 | D1 | 중 |
| 2 | `.reflect/events.jsonl` append-only + 파생 스냅샷 (또는 원자적 쓰기+락) | D2 | 중 |
| 3 | 디텍터 골든 픽스처 테스트 — 두 코퍼스에서 추출 | D6 | 중 |
| 4 | `output_config.format` 구조화 출력, `parseReflection`/`isReflection` 삭제 | D4 | 소 |
| 5 | `PostToolBatch`/`Stop` + `prompt_id`로 진짜 턴 경계 | D3 | 소 |
| 6 | `additionalContext` 주입 + `PreCompact` 재주입 | D8, D9 | 소 |
| 7 | `Stop` 훅에서 효능 판정 → `next_turn_acted_on_adjustment` | D5 | 중 |
| 8 | 모델/가격 테이블 외부화, 기본 Opus 5, judge는 Haiku 4.5, 3개 문서 동기화 | D7 | 소 |
| 9 | `.reflect/` 스키마 버저닝 + 마이그레이션 (로그가 이제 eval 입력이므로) | — | 소 |
| 10 | `web/lib/redact.ts`를 `src/`로 승격, judge 입력·로그에 기본 적용 | — | 소 |

---

## 7. 단계별 실행 계획

| Phase | 기간 | 내용 | 종료 조건 (Exit Criteria) |
|---|---|---|---|
| **P0** 종이 위에서 증명 ✅ | 실행 완료 2026-08-23 | Corpus B 836 페어 추출 · 3-run 라벨링 · Stage A+judge 캐스케이드 · B0–B6 측정 · 독립 검증 | **충족.** F0.5 19.9% → 78.6%. SWE-chat은 gated(401)라 미연결 — Corpus A는 P1로 이월 |
| **P1** 트리거 재건 | 1–2주 | 단일 Node 훅 바이너리 / `PermissionDenied` 등 신규 이벤트 / 스레드별 감쇠 누산기 / structured output / 테스트. **v0.2.0** | Corpus B에서 캘리브레이션된 운영점으로 실제 발화 + 오발화율 실측치 보유 |
| **P2** 루프 닫기 | ~1주 | additionalContext 주입 + PreCompact 생존 + 효능 상관 배선 + `reflect report` | `computeUsefulRate()`가 진짜 숫자를 반환 |
| **P3** 시각화 | 1–2주 | Bench Workbench (S1) + Session Trace 업그레이드 (S2) + OTel (S3) | `npm run bench && npm run bench:view` 가 공유 가능한 정적 리포트 생성 |
| **P4** 플레이북 | 1주 | ACE 방식 옵트인 로컬 플레이북, 기본 OFF, 리뷰 게이트 | harmful 카운터로 자동 강등이 동작함을 픽스처로 증명 |
| **P5** 발표 | — | `reflect-bench` 공개 + FINDINGS→수정→측정 아크 글 | 외부인이 `npm run bench`로 수치를 재현 |

**P0의 게이트가 이 플랜의 핵심이다.** P0에서 캐스케이드가 정규식을 유의하게 못 이기면, v2는 만들지 않는 게 맞다. 그 결과 자체가 FINDINGS보다 더 강한 발표거리다.

---

## 8. 리스크와 정직한 한계

| 리스크 | 완화 |
|---|---|
| SWE-chat 라벨이 silver — 그걸 gold처럼 보고하는 유혹 | 층화 human 재라벨 + κ 보고. silver 대비 수치는 별도 표기 |
| judge가 UserPromptSubmit 크리티컬 패스에 지연 추가 | 하드 타임아웃 8s, 실패 시 Stage B 폴백, **exit 0 불변 계약**(프롬프트를 절대 지우지 않음) |
| `type:"prompt"` 훅은 Claude Code 표면 전용 — SDK 경로엔 API 폴백 필요 → 또 이중 구현 | judge를 **함수 1개 + 호출자 2개**로 설계. 함수는 shared |
| 플레이북의 self-reinforcing error (ExpeL 알려진 실패) | `counter_hypothesis` 필수 필드 + helpful/harmful 카운터 + 사람 리뷰 게이트 + 자동 강등 |
| 개입 효능은 여전히 N=1에서 반증 불가 | 관측 지표와 인과 주장을 문서에서 분리. A/B는 사용자가 생기기 전엔 불가능하다고 명시 |
| Wink가 Meta에서 10k trajectory 규모로 선행 | 경쟁이 아니라 검증으로 포지셔닝. 축(사용자 거부 vs 에이전트 오작동)과 배포(로컬·오픈)로 차별화 |
| 훅 모델 호출의 빌링 풀(Pool 1 vs 2) 불명확 | 배포 전 실측. 측정 전엔 "공짜"라고 쓰지 않음 |
| 캐시 최소 prefix 4,096 주장이 4.7 시대 값 | `count_tokens`로 재실측 후 `docs/measurements.md` 갱신 |

---

## 9. 하지 않을 것 (명시적 비목표)

- **크로스세션 자동 학습** — 기본값은 계속 session-local. 플레이북은 옵트인·로컬·리뷰필수. privacy 테제는 마케팅이 아니라 설계 제약이다
- **원격 텔레메트리 / 계정 / 대시보드 SaaS** — 전부 로컬. OTel은 *사용자 자신의* 콜렉터로만
- **에이전트 오작동 탐지 전반** — Wink의 영역. reflect는 사람↔에이전트 경계에 집중
- **`updatedInput`/`updatedResult`로 에이전트 행동 직접 개입** — 관측·주입까지가 v2 범위. 개입은 신뢰를 요구하고 신뢰는 벤치마크 다음이다
- **v0.1.4 자산 재작업** — SLSA v1 provenance, OIDC publish, 마켓 제출 상태는 건드리지 않는다. v2는 minor bump로 그 위에 쌓는다

---

## 10. 첫 액션 (P0 착수 시)

1. `evals/` 를 `.gitignore` 정책 관점에서 정리 — 코드(`replay_history.py`, 하네스)는 커밋, 출력(`out/`, `out2/`)과 원문 발화는 로컬
2. SWE-chat pinned revision 다운로드 + 스키마 매핑 (`session → turns → (prompt, prior tool calls, prior assistant message)`)
3. Corpus B 재추출 — 이번엔 `Stop`/`last_assistant_message` 상당물을 transcript에서 복원해 **쌍(pair)** 으로 저장
4. Stage A 구조 게이트를 순수 함수로 구현 + 두 코퍼스에서 B2 측정 ← **가장 먼저 알아야 할 숫자**
5. FINDINGS 45건 전문 재라벨 + 음성 샘플 추가 (recall 측정용 — 현재는 precision만 있다)

---

## 부록 A — 참고 문헌

- SWE-chat: Coding Agent Interactions From Real Users in the Wild — arXiv 2604.20779 · <https://huggingface.co/datasets/SALT-NLP/SWE-chat>
- Wink: Recovering from Misbehaviors in Coding Agents — arXiv 2602.17037 (ACM AIware'26)
- Agentic Context Engineering (ACE) — arXiv 2510.04618
- GEPA: Reflective Prompt Evolution Can Outperform RL — arXiv 2507.19457 (ICLR 2026 oral)
- Agentic Harness Engineering: Observability-Driven Automatic Evolution — arXiv 2604.25850
- Harness Engineering for Agentic AI Coding Tools — arXiv 2602.14690 (AIware'26)
- Claude Code Hooks reference — <https://code.claude.com/docs/en/hooks>
- OpenTelemetry GenAI semantic conventions (agent spans, provisional)
- reflect 자체: `evals/FINDINGS.md`, `experiments/ablation-with-without.md`, `docs/measurements.md`
