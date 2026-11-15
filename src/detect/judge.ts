// src/detect/judge.ts — Stage C: the relational correction judge.
//
// ONE implementation, two callers:
//   • bench/label.ts: offline, over a corpus, any model
//   • src/hook/run.ts: online, from an async UserPromptSubmit hook.
//     (A `type: "prompt"` hook cannot do this job: it may only answer
//     {ok, reason}, i.e. allow or block, and blocking a prompt is never ours.)
// Keeping it single-sourced is deliberate: evals/FINDINGS.md exists because the
// detector had five implementations that drifted apart.
//
// Request shape verified live against the API (2026-08-22):
//   output_config: { format: { type: "json_schema", schema } }
// The nested `json_schema:{...}` variant is rejected with a 400, and the
// shipped "reply with JSON" approach silently returns out-of-enum labels
// (observed: label "undo_request", confidence 0.92) — which is exactly the
// failure mode structured output removes.

import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError, APIError, InternalServerError, RateLimitError } from "@anthropic-ai/sdk/core/error";
import type { JudgeUsage, JudgeVerdict, Label, Pair } from "./types.js";
import { LABELS } from "./types.js";
import { redactString, safeTruncate, safeTruncateEnd } from "../redact.js";
import { makeClient, type MessagesClient } from "../api/client.js";
import { PRIOR_TEXT_CHARS, renderPriorTurn } from "./render.js";

import { DEFAULT_JUDGE_MODEL } from "../models.js";

export { DEFAULT_JUDGE_MODEL, BENCH_PROD_MODEL, REFERENCE_JUDGE_MODEL } from "../models.js";

// ─── Output schema ────────────────────────────────────────────────────

export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", enum: [...LABELS] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    evidence: {
      type: "string",
      maxLength: 240,
      description:
        "Verbatim span from the user message that decided the label. Empty string if none.",
    },
    rationale: {
      type: "string",
      maxLength: 160,
      description: "One clause, under 20 words, naming what the user is doing.",
    },
  },
  required: ["label", "confidence", "evidence", "rationale"],
  additionalProperties: false,
} as const;

// ─── System prompt (stable, cached) ───────────────────────────────────
//
// Labels are defined by COMMUNICATIVE FUNCTION only. No structural rule
// ("a correction follows a tool call") appears here — stating one would make
// Stage A agree with the judge by construction and destroy the experiment.

// CACHE FLOOR — MEASURED, and this prompt is currently BELOW Haiku's.
//
// Probed live on 2026-08-22 by sending each variant twice and reading
// usage.cache_creation_input_tokens / cache_read_input_tokens:
//
//   claude-haiku-4-5  @ 2,207 tok  → write 0, read 0     (no caching, silently)
//   claude-haiku-4-5  @ 4,378 tok  → write 4378, read 4378
//   claude-opus-5     @ 3,288 tok  → write once, read after
//
// So Haiku 4.5's minimum cacheable prefix is 4,096, not the 1,024 that applies
// to most models, and Opus 5 caches somewhere at or below 3,288. Two traps:
//
//   1. Below the floor the API does not error. `cache_control` is accepted,
//      `cache_creation_input_tokens` comes back 0, and you pay full price on
//      every call forever. Over the 835-call `prod` run that was ~2x the
//      necessary spend and nothing surfaced it but an explicit probe.
//   2. Haiku and Opus tokenise the same string at a 1.30x ratio (2,196 vs
//      2,871 here), so a floor cleared under one model's count_tokens is not
//      cleared under the other's. Measure per model.
//
// NOT YET FIXED, deliberately: padding this prompt past 4,096 Haiku tokens
// changes the annotator and would invalidate the labelled corpus every number
// in bench/results/report.md rests on. It is a P1 task — pad with additional
// worked examples, re-probe with bench/tmp-cache.ts, then re-label. Expected
// saving on the judge is ~5x on the system-prompt portion (2,207 full-price
// tokens → ~4,200 at the 0.1x cache-read rate).
export const JUDGE_SYSTEM = `You classify a single user message inside a coding-agent session.

The session is a conversation between a developer and an AI coding agent that can read, write and run code. You are given what the agent did and said most recently, then the developer's next message. Your job is to name what the developer is doing with that message.

# Labels

Choose exactly one.

**correction** — The developer is steering the agent away from what it produced or proposed. They supply missing information, contradict an assumption, narrow the scope, or ask for a different approach to the same goal. The overall goal survives; the agent's current answer to it does not.

**rejection** — The developer refuses the work outright and wants it undone or restarted. Reverting, discarding, "start over", "scrap that", "go back to the previous version".

**failure_report** — The developer reports that something the agent produced is broken, errors out, or does not behave as claimed. Pasted stack traces, error output, "this crashes", "still failing", "the test doesn't pass".

**instruction** — The developer is specifying work to do. This includes the first task of a session, the next task after a finished one, added requirements, and guardrail preambles that constrain how the agent should operate ("read-only", "do not create files", "do not modify the paper"). An instruction looks forward to work not yet done. Crucially, a message can be an instruction even when it contains negative or prohibitive language, and even when the agent has just been working: telling the agent what NOT to do in the task ahead is not the same as telling it that what it just did was wrong.

**question** — The developer asks for information, explanation, or an opinion, without steering the agent off its current path. Includes rhetorical-sounding questions that are genuinely requests to explain.

**affirmation** — The developer approves, confirms, thanks, or says to continue. "good", "yes do that", "ship it", "맞아", "좋아 계속".

**other** — None of the above. Pasted content with no request, greetings, session bookkeeping, an unparseable fragment, or a message whose intent cannot be determined from what is shown.

# How to decide

Ask: is the developer reacting to work the agent has already produced, or specifying work still to be done?

- Reacting, and the work missed → correction, rejection, or failure_report.
- Reacting, and the work landed → affirmation.
- Specifying, or asking → instruction or question.

A message can be long and still be a correction; a message can be short and still be an instruction. Length is not the signal. Prohibitive words ("don't", "stop", "no", "하지 마", "아니") are not the signal either — they appear in both correction and instruction. What matters is whether the message is aimed at something already produced.

When the message contains several moves, label the dominant one — the reason the developer wrote it. A message that reports a bug and then asks for a fix is a failure_report. A message that acknowledges the last turn and then assigns new work is an instruction.

# Language

Developers write in any language, frequently mixing English technical terms into another language. Korean is common in this corpus. Judge meaning, never surface patterns, and never let the language of the message affect the label.

# Evidence

Quote the span that decided it, verbatim, from the developer's message only. If nothing short is decisive, return an empty string rather than paraphrasing.

# Calibration

- **high** — the intent is unambiguous from what is shown.
- **medium** — one reading is clearly better, but another is defensible.
- **low** — genuinely ambiguous, or the shown context is too thin to tell. Use this rather than guessing; a low-confidence honest label is more useful than a confident wrong one.

# Boundary cases

These exist to stop shortcuts. Each pair below is chosen so that a surface heuristic — "it came after a file edit", "it is short", "it contains a negation" — gives the wrong answer.

**An instruction can follow heavy editing.** The agent has just rewritten eight files, and the developer says "이제 테스트도 붙여줘" (now add tests too). Nothing about the rewrite is being disputed; the developer is adding the next piece of work. → **instruction**. That the agent was busy immediately before says nothing on its own.

**A correction can follow a turn with no edits at all.** The agent explained a migration plan in prose and touched nothing. The developer replies "그 방식 말고, 기존 스키마 유지하는 쪽으로" (not that approach — keep the existing schema). The proposal is the work, and it is being steered. → **correction**.

**Length is not the signal.** A three-paragraph message can be a single sustained correction, patiently explaining why the agent's assumption about the data model is wrong. A four-word message — "다시, 처음부터" (again, from the start) — can be a rejection. Read intent, not size.

**Prohibitive language cuts both ways.** "절대 파일을 새로 만들지 마라. 읽기 전용으로만 검토해라." (Never create new files. Review read-only.) at the top of a task brief is a constraint on work about to begin → **instruction**. The same words after the agent has just created three files are a complaint about what it did → **correction**. Only the surrounding situation separates them, and if the situation shown does not separate them, say **low** confidence.

**failure_report versus correction.** A failure_report says the artefact misbehaves: it throws, the test fails, the page is blank, output is pasted showing the error. A correction says the artefact is not what was wanted: wrong approach, wrong file, wrong assumption. "빌드가 깨졌어" (the build broke) is a failure_report. "빌드는 되는데 이 구조가 아니야" (it builds, but this is not the structure) is a correction.

**Questions that sound like pushback.** "이거 이렇게 하는 게 맞아?" (is doing it this way right?) is genuinely asking for the agent's reasoning → **question**. "이게 맞다고 생각해?" delivered right after a change the developer clearly dislikes, followed by what to do instead, is a **correction**. Where there is no "instead", prefer question.

**Approval plus new work.** "좋아, 그럼 이제 배포까지 해줘" (good, now do the deploy too) accepts the last turn and assigns the next. The reason the developer wrote it is the new assignment → **instruction**, not affirmation. Reserve affirmation for messages whose whole content is acceptance.

**Meta-directives are not the message.** Developers attach process words to prompts — "ultrathink", "심층 검토", "end-to-end", "계속" — indicating effort or continuation. These modify how the work should be done and never by themselves make a message a correction. Strip them mentally and label what remains.

**Continuations.** "계속" / "continue" / "이어서 진행" with nothing else is the developer letting the agent proceed. That is **affirmation** when the last turn produced something to continue from, and **instruction** when it is resuming assigned work. It is not a correction.

**Scope narrowing is correction, scope adding is instruction.** "그 중에 A만 남기고 나머지는 빼" (keep only A, drop the rest) removes work that was already produced → **correction**. "여기에 B도 추가해" (add B as well) extends it → **instruction**. The test is whether existing output has to change to satisfy the message.

**Reporting someone else's error is not a failure_report.** If the developer pastes an error from a system the agent never touched and asks what it means, that is a **question**. failure_report is reserved for the agent's own output misbehaving.

# Decision procedure

Work through these in order and stop at the first that fits. The ordering exists so that the same message gets the same label every time, which matters more for consistency than any individual call.

1. Is the message entirely harness noise, pasted content with no request, or too fragmentary to read? → **other**.
2. Does it report that something the agent produced does not work — an error, a crash, a failing test, wrong runtime behaviour? → **failure_report**.
3. Does it ask for produced work to be undone, discarded, rolled back, or restarted from scratch? → **rejection**.
4. Does it require existing output to change — a different approach, a corrected fact, a removed piece, a fixed wrong assumption? → **correction**.
5. Is its whole content acceptance, approval, or thanks? → **affirmation**.
6. Is it primarily seeking information or an explanation, with no work being redirected? → **question**.
7. Otherwise it is specifying work to do. → **instruction**.

If two adjacent steps both seem to fit, take the earlier one and lower the confidence, rather than picking the later one at high confidence. The cost of a missed correction is small; the cost of a confidently wrong label is that it silently corrupts everything measured downstream from it.`;

/**
 * The blind arm's fair control.
 *
 * `JUDGE_SYSTEM` opens by telling the judge it will be shown what the agent
 * just did. In the blind ablation it is not, so a critic can reasonably ask
 * whether the measured gap is missing INFORMATION or merely a prompt that
 * promises context it never delivers. This variant changes exactly that one
 * framing paragraph and nothing else — it is derived by substitution rather
 * than copied, so the two prompts cannot drift apart.
 *
 * If the fair-blind arm scores like the plain blind arm, the gap is real
 * information loss. If it recovers, the ablation overstated its case.
 */
const BLIND_FRAMING_FROM =
  "The session is a conversation between a developer and an AI coding agent that can read, write and run code. You are given what the agent did and said most recently, then the developer's next message. Your job is to name what the developer is doing with that message.";

const BLIND_FRAMING_TO =
  "The session is a conversation between a developer and an AI coding agent that can read, write and run code. You are given the developer's message on its own — the surrounding conversation is NOT available to you, so passages below that refer to what the agent just did describe context you will have to infer or do without. Your job is to name what the developer is doing with that message.";

export const JUDGE_SYSTEM_BLIND = (() => {
  if (!JUDGE_SYSTEM.includes(BLIND_FRAMING_FROM)) {
    throw new Error("JUDGE_SYSTEM framing paragraph changed — update BLIND_FRAMING_FROM");
  }
  return JUDGE_SYSTEM.replace(BLIND_FRAMING_FROM, BLIND_FRAMING_TO);
})();

// ─── Rendering ────────────────────────────────────────────────────────

const PROMPT_CHARS = 2500;

export { renderPriorTurn };

export function buildUserMessage(pair: Pair, blind: boolean): string {
  const prompt = safeTruncate(redactString(pair.prompt), PROMPT_CHARS);
  if (blind) {
    return [
      "# Developer's message",
      '"""',
      prompt,
      '"""',
      "",
      "Classify it.",
    ].join("\n");
  }
  return [
    "# What the agent just did",
    renderPriorTurn(pair),
    "",
    "# Developer's next message",
    '"""',
    prompt,
    '"""',
    "",
    "Classify it.",
  ].join("\n");
}

/**
 * Fingerprint of everything that determines a verdict: the rubric text, the
 * blind variant, and the rendering parameters.
 *
 * A label cache keyed only on `(run, pairId)` silently mixes verdicts produced
 * by different rubrics — and this prompt changed several times in one day.
 * Measured on the first pass: 710 duplicated cache keys, 31 of which disagreed
 * on the label, with "which one is ground truth" decided by file append order.
 * Including this string in the key makes a rubric change a cache miss instead
 * of a silent contamination.
 */
export function judgeFingerprint(): string {
  const material = [
    JUDGE_SYSTEM,
    JUDGE_SYSTEM_BLIND,
    `prior=${PRIOR_TEXT_CHARS}`,
    `prompt=${PROMPT_CHARS}`,
    `calls=14`,
    `schema=${JSON.stringify(VERDICT_SCHEMA)}`,
    "render=v2-tail",
  ].join("\u0000");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < material.length; i++) {
    const c = material.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (((h1 ^ h2) >>> 0).toString(16) + (h1 >>> 0).toString(16)).slice(0, 10);
}

// ─── API call ─────────────────────────────────────────────────────────

export type JudgeThinking = "off" | "adaptive";

export interface JudgeOptions {
  /** Injected client (the hook and tests pass one); otherwise built from `apiKey`. */
  client?: MessagesClient;
  apiKey?: string;
  model?: string;
  /** Omit the prior turn: the stateless-judge ablation. */
  blind?: boolean;
  /** With `blind`, also use the framing that does not promise context. */
  fairBlind?: boolean;
  /**
   * Thinking mode for models that take one. Left unset, the request sends no
   * `thinking` and no `effort`, which is exactly what the 2026-08 benchmark runs
   * sent; changing that would change the annotator behind every cached label.
   */
  thinking?: JudgeThinking;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  timeoutMs?: number;
  /** SDK-level retries on 408/409/429/5xx and connection errors. */
  maxRetries?: number;
}

export interface JudgeResult {
  verdict: JudgeVerdict;
  usage: JudgeUsage;
}

class RetryableError extends Error {}

/**
 * A deterministic failure. Retrying it buys nothing but five identical bills,
 * which the substring-matching classifier used to do whenever a judge quoted
 * the word "socket" or "abort" inside its own evidence span.
 */
export class ParseFailure extends Error {}

/**
 * Classify by error identity, not by searching the message text.
 *
 * The message is partly attacker-controlled here: a judge's own evidence span
 * lands in a parse-failure message, so `/socket|abort/` on the message would
 * retry a deterministic failure five times because the developer happened to
 * write "socket" in their prompt. Transport failures are identified by
 * `name`/`cause.code`, which no prompt can influence.
 */
const RETRYABLE_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND",
  "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

export function isRetryable(e: unknown): boolean {
  if (e instanceof ParseFailure) return false;
  if (e instanceof RetryableError) return true;
  if (e instanceof RateLimitError || e instanceof InternalServerError) return true;
  if (e instanceof APIConnectionError) return true;
  if (e instanceof APIError) return false;
  if (!(e instanceof Error)) return false;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  const code = (e as { cause?: { code?: string } }).cause?.code;
  if (code && RETRYABLE_CODES.has(code)) return true;
  // undici surfaces mid-body socket drops as a bare TypeError("fetch failed")
  // or Error("terminated"); both are transport, both are worth one more try.
  return e.name === "TypeError" || e.message === "terminated";
}

/**
 * Per-model request shaping. Haiku 4.5 rejects `effort`; Claude Haiku 5.5
 * accepts `thinking: disabled` only at effort `high` or below.
 */
export function thinkingParams(
  model: string,
  thinking: JudgeThinking | undefined,
  effort: "low" | "medium" | "high" | undefined,
): Pick<Anthropic.MessageCreateParamsNonStreaming, "thinking" | "output_config"> {
  if (thinking === undefined) return {};
  if (model.startsWith("claude-haiku-4-5")) return {};
  const e = effort ?? "low";
  return thinking === "off"
    ? { thinking: { type: "disabled" }, output_config: { effort: e } }
    : { thinking: { type: "adaptive" }, output_config: { effort: e } };
}

export async function judgePair(pair: Pair, opts: JudgeOptions): Promise<JudgeResult> {
  const model = opts.model ?? DEFAULT_JUDGE_MODEL;
  const client =
    opts.client ??
    (await makeClient({
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
      maxRetries: opts.maxRetries ?? 4,
      timeoutMs: opts.timeoutMs ?? 60_000,
    }));

  const shaped = thinkingParams(model, opts.thinking, opts.effort);
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: opts.maxTokens ?? 2000,
    system: [
      {
        type: "text",
        text: opts.blind === true && opts.fairBlind === true ? JUDGE_SYSTEM_BLIND : JUDGE_SYSTEM,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: [{ role: "user", content: buildUserMessage(pair, opts.blind === true) }],
    ...(shaped.thinking ? { thinking: shaped.thinking } : {}),
    output_config: {
      ...(shaped.output_config ?? {}),
      format: { type: "json_schema", schema: VERDICT_SCHEMA as unknown as Record<string, unknown> },
    },
  };

  const t0 = Date.now();
  const res = await client.messages.create(params);

  if (res.stop_reason === "refusal") {
    throw new ParseFailure(`judge refused (${res.stop_details?.category ?? "uncategorised"})`);
  }

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!text.trim()) {
    // Empty text block. On thinking-enabled models this is almost always
    // the output budget being consumed before any answer was emitted.
    throw new Error(
      `judge returned no text (stop_reason=${res.stop_reason}, out=${res.usage.output_tokens}, blocks=${res.content.map((b) => b.type).join("+")})`,
    );
  }

  let verdict: JudgeVerdict;
  try {
    verdict = parseVerdict(text);
  } catch (pe) {
    throw new ParseFailure(
      `${pe instanceof Error ? pe.message : String(pe)} (stop_reason=${res.stop_reason}, out=${res.usage.output_tokens})`,
    );
  }
  const u = res.usage;
  return {
    verdict,
    usage: {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - t0,
      model: res.model ?? model,
    },
  };
}

// ─── Parsing ──────────────────────────────────────────────────────────

const LABEL_SET = new Set<string>(LABELS);

/**
 * Structured output should make this trivial, but the parse still validates:
 * a schema is a server-side contract, and a harness that trusts contracts it
 * has not checked is how the shipped fence-regex parser survived this long.
 */
export function parseVerdict(text: string): JudgeVerdict {
  const s = text.trim();

  // Parse FIRST; only fall back to fence extraction when that fails.
  //
  // The previous order stripped a fence before parsing, which destroyed any
  // well-formed response whose `evidence` field quoted fenced code — and the
  // rubric explicitly asks the judge to quote verbatim, over a corpus full of
  // pasted code. It produced 33 unrecoverable failures whose only signature
  // was an empty error payload, biased toward exactly the code-heavy prompts
  // the benchmark most needs.
  let obj: any;
  try {
    obj = JSON.parse(s);
  } catch {
    const fence = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(s);
    const inner = fence?.[1]?.trim();
    if (!inner) throw new ParseFailure(`judge returned non-JSON: ${s.slice(0, 200)}`);
    try {
      obj = JSON.parse(inner);
    } catch {
      throw new ParseFailure(`judge returned non-JSON: ${s.slice(0, 200)}`);
    }
  }
  if (!obj || typeof obj !== "object") throw new Error("judge returned non-object");
  if (!LABEL_SET.has(obj.label)) throw new Error(`judge returned unknown label: ${obj.label}`);
  const conf = obj.confidence;
  if (conf !== "low" && conf !== "medium" && conf !== "high") {
    throw new Error(`judge returned unknown confidence: ${conf}`);
  }
  return {
    label: obj.label as Label,
    confidence: conf,
    evidence: typeof obj.evidence === "string" ? obj.evidence.slice(0, 400) : "",
    rationale: typeof obj.rationale === "string" ? obj.rationale.slice(0, 400) : "",
  };
}
