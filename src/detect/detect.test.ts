// src/detect/detect.test.ts — golden fixtures for the detector.
//
// Debt item D6: `npm test` globbed `src/**/*.test.ts` and matched nothing, so
// the detector shipped untested through four releases. These cases are drawn
// from real transcript shapes measured in the local corpus, with the specific
// regressions that the 2026-08 rebuild fixed pinned so they cannot come back.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  lexicalEn,
  lexicalKo,
  lexicalMultilingual,
  toolTier,
  detectScript,
} from "./lexical.js";
import { extractFeatures, scoreFeatures, structuralGate } from "./structural.js";
import { judgePair, parseVerdict } from "./judge.js";
import type { MessagesClient } from "../api/client.js";
import { stripWrappers, isBookkeeping, targetTokens } from "../transcript/parse.js";
import type { Pair, ToolCall } from "./types.js";
import { isPushback } from "./types.js";
import { redactString, safeTruncate } from "../redact.js";

// ─── helpers ──────────────────────────────────────────────────────────

function call(name: string, target: string, mutating = false, errored = false): ToolCall {
  return { name, target, mutating, errored };
}

function pair(over: Partial<Pair> = {}): Pair {
  return {
    pairId: "s:1",
    sessionId: "s",
    project: "p",
    promptIndex: 1,
    prompt: "ok",
    promptAt: "2026-08-22T10:00:30.000Z",
    prior: {
      text: "Done.",
      toolCalls: [call("Edit", "C:/x/src/foo.ts", true)],
      endedAt: "2026-08-22T10:00:00.000Z",
    },
    recentTargets: [],
    sidechain: false,
    ...over,
  };
}

// ─── B0: the shipped English regex, byte-faithful ─────────────────────

test("lexicalEn matches the anchored negations the shipped hook matched", () => {
  for (const s of ["no wait, that's not it", "No, revert it", "nope, try again", "don't do that", "wait, hold on"]) {
    assert.equal(lexicalEn(s), true, s);
  }
});

test("lexicalEn does not match a bare no or mid-sentence negation", () => {
  for (const s of ["no", "there is no config file", "I don't think so"]) {
    assert.equal(lexicalEn(s), false, s);
  }
});

test("lexicalEn is suppressed by the positive-negation guard", () => {
  assert.equal(lexicalEn("I see why you said no, revert it"), false);
});

test("lexicalEn is blind to Korean — the finding the whole rebuild rests on", () => {
  for (const s of ["아니, 그거 말고", "되돌려줘", "그만해", "하지 마"]) {
    assert.equal(lexicalEn(s), false, s);
    assert.equal(lexicalKo(s), true, s);
    assert.equal(lexicalMultilingual(s), true, s);
  }
});

test("lexicalEn only reads the first 400 chars, as the hook does", () => {
  assert.equal(lexicalEn("x".repeat(500) + " no wait"), false);
});

// ─── Tier 1 / Tier 2 tool signals ─────────────────────────────────────

test("toolTier reproduces the shipped tiering", () => {
  assert.equal(toolTier("Bash", "git revert abc123"), 1);
  assert.equal(toolTier("Bash", "git restore src/a.ts"), 1);
  assert.equal(toolTier("Bash", "git checkout HEAD -- src/a.ts"), 1);
  assert.equal(toolTier("Bash", "rm src/a.ts"), 2);
  assert.equal(toolTier("Bash", "rm -rf node_modules"), 0, "build artefacts excluded");
  assert.equal(toolTier("Bash", "rm -rf dist"), 0);
  assert.equal(toolTier("Edit", "src/a.ts"), 0, "Tier 1/2 are Bash-only in the shipped hook");
  assert.equal(toolTier("Bash", "  git revert abc"), 0, "anchored, leading space does not match");
});

// ─── script detection ─────────────────────────────────────────────────

test("detectScript separates Korean, mixed and latin", () => {
  assert.equal(detectScript("되돌려줘"), "ko");
  assert.equal(detectScript("이 함수 refactor 해줘"), "mixed");
  assert.equal(detectScript("refactor this function"), "latin");
});

// ─── harness stripping (the 20%-contamination fix) ────────────────────

test("stripWrappers removes hyphenated harness blocks", () => {
  assert.equal(stripWrappers("<task-notification>\nstatus: done\n</task-notification>"), "");
  assert.equal(stripWrappers("<system-reminder>note</system-reminder>hello"), "hello");
});

test("stripWrappers keeps user prose that follows an injected context block", () => {
  const s = "<november-context>\nnow: 2026-08-17\n</november-context>\n\n이번 주 배당락일 알려줘";
  assert.equal(stripWrappers(s), "이번 주 배당락일 알려줘");
});

test("stripWrappers leaves ordinary HTML alone — only hyphenated names are harness", () => {
  assert.equal(stripWrappers("use a <div>wrapper</div> here"), "use a <div>wrapper</div> here");
});

test("stripWrappers protects fenced code containing custom elements", () => {
  const s = "fix this:\n```html\n<my-widget>a</my-widget>\n```";
  assert.ok(stripWrappers(s).includes("<my-widget>"));
});

test("stripWrappers handles a truncated leading injection", () => {
  assert.equal(stripWrappers("<task-notification>\nstatus: run"), "");
});

test("isBookkeeping drops compaction summaries and bare UI commands", () => {
  assert.equal(isBookkeeping("/compact"), true);
  assert.equal(isBookkeeping("/clear"), true);
  assert.equal(
    isBookkeeping("This session is being continued from a previous conversation that ran out of context."),
    true,
  );
  assert.equal(isBookkeeping("/undo"), false, "undo is a rejection signal, not bookkeeping");
  assert.equal(isBookkeeping("/compact focus on the API work"), false, "carries user intent");
  assert.equal(isBookkeeping("아니 다시 해줘"), false);
});

// ─── target tokens ────────────────────────────────────────────────────

test("targetTokens yields basename and stem for path matching", () => {
  const t = targetTokens("C:\\Users\\x\\src\\revert-detector.ts");
  assert.ok(t.includes("revert-detector.ts"));
  assert.ok(t.includes("revert-detector"));
});

test("targetTokens ignores short and generic names that would fire on prose", () => {
  assert.deepEqual(targetTokens("a.b"), [], "too short to be distinctive");
  assert.deepEqual(targetTokens("src/index.ts"), ["index.ts"], "generic stem dropped, filename kept");
  assert.deepEqual(targetTokens("src/main.py"), ["main.py"]);
  assert.ok(targetTokens("src/revert-detector.ts").includes("revert-detector"), "distinctive stem kept");
});

// ─── Stage A: the structural gate ─────────────────────────────────────

test("the gate has exactly one hard rule, reported with two populations", () => {
  // Session opener: no prior turn AND promptIndex 0.
  const opener = structuralGate(pair({ promptIndex: 0, prior: null }));
  assert.equal(opener.pass, false);
  assert.equal(opener.reason, "session_opener");

  // Mid-session consecutive user message: no prior turn, promptIndex > 0.
  // This is the slice worth watching — a correction can target work from two
  // turns back and this gate structurally cannot see it.
  const consecutive = structuralGate(pair({ promptIndex: 3, prior: null }));
  assert.equal(consecutive.pass, false);
  assert.equal(consecutive.reason, "consecutive_user_message");
});

test("a session opener with a prior turn is impossible, so promptIndex alone never rejects", () => {
  // Guards against reinstating the unreachable `isSessionOpener` branch that
  // fired once in 836 real pairs while being advertised as a separate rule.
  const g = structuralGate(pair({ promptIndex: 0 }));
  assert.equal(g.pass, true, "prior turn present ⇒ gate must pass regardless of index");
});

test("gate passes after a mutating turn and scores it above the prior", () => {
  const g = structuralGate(pair());
  assert.equal(g.pass, true);
  assert.ok(g.score > 0.5, `expected >0.5, got ${g.score}`);
});

test("a long guardrail preamble scores below a short reply — the FINDINGS false positive", () => {
  const short = structuralGate(pair({ prompt: "아니, 그거 말고 다시" }));
  const preamble = structuralGate(
    pair({
      prompt:
        "읽기 전용 검토만 한다. 어떤 파일도 생성, 수정, 삭제하지 마라. " + "상세 지침: ".repeat(200),
    }),
  );
  assert.ok(
    preamble.score < short.score,
    `preamble ${preamble.score} should score below reply ${short.score}`,
  );
});

test("referencing a path the agent just touched raises the score", () => {
  const base = structuralGate(pair({ prompt: "이거 다시" }));
  const ref = structuralGate(pair({ prompt: "foo.ts 이거 다시" }));
  assert.ok(ref.score > base.score);
  assert.equal(ref.features.referencesPriorTarget, true);
});

test("a stale gap lowers the score, a fast reply raises it", () => {
  const fast = structuralGate(pair({ promptAt: "2026-08-22T10:00:30.000Z" }));
  const stale = structuralGate(pair({ promptAt: "2026-08-22T12:00:00.000Z" }));
  assert.ok(fast.score > stale.score);
});

test("tool errors in the prior turn raise the score", () => {
  const clean = structuralGate(pair());
  const broken = structuralGate(
    pair({
      prior: {
        text: "Done.",
        toolCalls: [call("Bash", "npm test", false, true)],
        endedAt: "2026-08-22T10:00:00.000Z",
      },
    }),
  );
  assert.equal(broken.features.priorErrorCount, 1);
  assert.ok(broken.score > 0);
  assert.ok(clean.features.priorErrorCount === 0);
});

test("the score is a probability", () => {
  for (const p of [pair(), pair({ prompt: "x".repeat(5000) }), pair({ prompt: "" })]) {
    const s = structuralGate(p).score;
    assert.ok(s >= 0 && s <= 1, `${s} out of range`);
  }
});

test("thrash targets are detected across the recent window", () => {
  const f = extractFeatures(
    pair({
      prompt: "revert-detector 계속 이상해",
      recentTargets: ["src/revert-detector.ts", "src/revert-detector.ts", "src/other.ts"],
    }),
  );
  assert.equal(f.referencesThrashTarget, true);
});

test("pasted blobs are recognised", () => {
  const f = extractFeatures(pair({ prompt: "●".repeat(10) + " output dump" }));
  assert.equal(f.looksPasted, true);
});

test("scoreFeatures is monotone in the mutation prior", () => {
  const base = extractFeatures(pair({ prior: { text: "ok", toolCalls: [], endedAt: "2026-08-22T10:00:00.000Z" } }));
  const withMut = extractFeatures(pair());
  assert.ok(scoreFeatures(withMut) > scoreFeatures(base));
});

// ─── judge output parsing ─────────────────────────────────────────────

test("parseVerdict accepts a clean structured response", () => {
  const v = parseVerdict('{"label":"correction","confidence":"high","evidence":"아니","rationale":"steers"}');
  assert.equal(v.label, "correction");
  assert.equal(v.confidence, "high");
});

test("parseVerdict unwraps a fenced response", () => {
  const v = parseVerdict('```json\n{"label":"rejection","confidence":"low","evidence":"","rationale":"x"}\n```');
  assert.equal(v.label, "rejection");
});

test("parseVerdict rejects an out-of-enum label — the live failure that motivated structured output", () => {
  assert.throws(
    () => parseVerdict('{"label":"undo_request","confidence":"high","evidence":"","rationale":""}'),
    /unknown label/,
  );
});

test("parseVerdict rejects a numeric confidence", () => {
  assert.throws(
    () => parseVerdict('{"label":"correction","confidence":0.92,"evidence":"","rationale":""}'),
    /unknown confidence/,
  );
});

test("parseVerdict rejects truncated JSON rather than guessing", () => {
  assert.throws(() => parseVerdict('{"label":"correction","confid'), /non-JSON/);
});

// ─── taxonomy ─────────────────────────────────────────────────────────

test("pushback is exactly the three SWE-chat classes", () => {
  assert.deepEqual(
    (["correction", "rejection", "failure_report", "instruction", "question", "affirmation", "other"] as const).filter(
      isPushback,
    ),
    ["correction", "rejection", "failure_report"],
  );
});

// ─── surrogate safety ─────────────────────────────────────────────────

test("redactString repairs lone surrogates that break JSON transport", () => {
  const lone = "before \uD83D after"; // high surrogate with no partner
  const fixed = redactString(lone);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify({ t: fixed })));
  assert.ok(!/[\uD800-\uDFFF]/.test(fixed.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")));
});

test("redactString leaves well-formed astral characters intact", () => {
  const ok = "emoji 🪞 and hangul 되돌려";
  assert.equal(redactString(ok), ok);
});

test("safeTruncate never orphans a surrogate at the cut", () => {
  // "a" + 3 emoji: cutting at an odd offset inside a pair must back off.
  const s = "a" + "🪞".repeat(3);
  for (let n = 1; n <= s.length; n++) {
    const t = safeTruncate(s, n);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify({ t })), `n=${n}`);
    assert.ok(t.length <= n);
    const last = t.charCodeAt(t.length - 1);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), `orphaned high surrogate at n=${n}`);
  }
});

test("safeTruncate is a no-op below the limit", () => {
  assert.equal(safeTruncate("되돌려줘", 100), "되돌려줘");
});

// ─── judgePair request formats ────────────────────────────────────────

function fakeClient(answer: string): { client: MessagesClient; sent: any[] } {
  const sent: any[] = [];
  const create = async (params: any) => {
    sent.push(params);
    return {
      model: params.model,
      stop_reason: "end_turn",
      content: [{ type: "text", text: answer }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
  };
  return { client: { messages: { create }, beta: { messages: { create } } } as unknown as MessagesClient, sent };
}

const VERDICT_JSON = JSON.stringify({ label: "correction", confidence: "high", evidence: "not that", rationale: "steers away" });

test("judgePair sends structured output by default", async () => {
  const { client, sent } = fakeClient(VERDICT_JSON);
  const r = await judgePair(pair(), { client, thinking: "off", effort: "low" });
  assert.equal(r.verdict.label, "correction");
  assert.equal(sent[0].output_config.format.type, "json_schema");
  assert.equal(sent[0].output_config.effort, "low");
  assert.doesNotMatch(sent[0].messages[0].content, /JSON Schema/);
});

test("judgePair with format prompt puts the schema in the message and reads a wrapped answer", async () => {
  const { client, sent } = fakeClient(`Here is my answer:\n${VERDICT_JSON}\nDone.`);
  const r = await judgePair(pair(), { client, thinking: "off", effort: "low", format: "prompt" });
  assert.equal(r.verdict.label, "correction");
  assert.equal(sent[0].output_config.format, undefined);
  assert.equal(sent[0].output_config.effort, "low");
  assert.deepEqual(sent[0].thinking, { type: "disabled" });
  assert.match(sent[0].messages[0].content, /Answer with one JSON object and nothing else/);
  assert.equal(sent[0].system[0].cache_control.ttl, "1h");
});

test("judgePair with format prompt rejects an answer outside the label set", async () => {
  const { client } = fakeClient(JSON.stringify({ label: "undo_request", confidence: "high", evidence: "", rationale: "" }));
  await assert.rejects(judgePair(pair(), { client, thinking: "off", format: "prompt" }), /unknown label/);
});
