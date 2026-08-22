// src/infra.test.ts — the pieces nothing else covers.
//
// `redactString` is the last thing that runs before a payload leaves the
// machine and had no test asserting that it redacts anything. `costUSD` feeds
// every dollar figure in the report. `parseVerdict` and the retry classifier
// decide whether a labelling run finishes or silently loses rows.

import { test } from "node:test";
import assert from "node:assert/strict";

import { costUSD, priceFor, formatUSD, PRICES } from "./pricing.js";
import { redactString, redactObject, safeTruncate, safeTruncateEnd, stripLoneSurrogates } from "./redact.js";
import { parseVerdict, isRetryable, ParseFailure, judgeFingerprint } from "./detect/judge.js";

// ─── pricing ──────────────────────────────────────────────────────────

test("costUSD applies every rate and cache multiplier", () => {
  // 1M of each class on Haiku ($1 in / $5 out):
  //   input 1 + output 5 + cacheRead 0.1 + write5m 1.25 + write1h 2.0 = 9.35
  const usd = costUSD("claude-haiku-4-5", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheCreation5mTokens: 1_000_000,
    cacheCreation1hTokens: 1_000_000,
  });
  assert.ok(Math.abs(usd - 9.35) < 1e-9, `expected 9.35, got ${usd}`);
});

test("priceFor resolves dated snapshot ids to their base entry", () => {
  assert.deepEqual(priceFor("claude-haiku-4-5-20251001"), PRICES["claude-haiku-4-5"]);
  assert.deepEqual(priceFor("claude-opus-5"), PRICES["claude-opus-5"]);
  assert.throws(() => priceFor("claude-imaginary-9"), /unknown model/);
});

test("priceFor never hands out a mutable reference to the catalogue", () => {
  const p = priceFor("claude-opus-5") as { input: number };
  const before = PRICES["claude-opus-5"]!.input;
  try {
    p.input = 999;
  } catch {
    /* frozen is also an acceptable answer */
  }
  assert.equal(PRICES["claude-opus-5"]!.input, before, "the catalogue was corrupted by a caller");
});

test("formatUSD scales its precision to the magnitude", () => {
  assert.equal(formatUSD(0), "$0");
  assert.ok(formatUSD(0.00042).startsWith("$0.000"));
  assert.equal(formatUSD(12.3456), "$12.35");
});

// ─── redaction ────────────────────────────────────────────────────────

test("redactString removes the things it exists to remove", () => {
  const cases: Array<[string, RegExp]> = [
    ["path C:\\Users\\someone\\Desktop\\x", /<you>/],
    ["mail me at person@gmail.com ok", /<email>/],
    ["key sk-ant-" + "a".repeat(30) + " end", /<anthropic-key>/],
    ["token ghp_" + "b".repeat(36), /<github-token>/],
    ["call 010-1234-5678 please", /<phone>/],
    ["aws AKIA" + "C".repeat(16) + " x", /<aws-key>/],
    ["hf token hf_" + "d".repeat(34), /<hf-token>/],
  ];
  for (const [input, expect] of cases) {
    const out = redactString(input);
    assert.match(out, expect, `not redacted: ${input.slice(0, 30)}`);
    assert.ok(!/someone|person@gmail|sk-ant-a|ghp_b|010-1234|AKIAC|hf_d/.test(out), out);
  }
});

test("redactString leaves ordinary prose and the public maintainer address alone", () => {
  const s = "reflect fires when 되돌려 shows up after an Edit — mail cj@chanjoongx.com";
  assert.equal(redactString(s), s);
});

test("redactObject walks nested structures", () => {
  const o = redactObject({ a: ["C:\\Users\\bob\\x"], b: { c: "x@gmail.com" }, n: 1, z: null });
  assert.match(JSON.stringify(o), /<you>/);
  assert.match(JSON.stringify(o), /<email>/);
  assert.equal((o as any).n, 1);
  assert.equal((o as any).z, null);
});

test("stripLoneSurrogates makes any string JSON-transportable", () => {
  for (const s of ["a\uD83Db", "\uDC00tail", "ok 🪞 ok"]) {
    const fixed = stripLoneSurrogates(s);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify({ fixed })));
  }
  assert.equal(stripLoneSurrogates("ok 🪞 ok"), "ok 🪞 ok", "valid pairs must survive");
});

test("safeTruncate and safeTruncateEnd never orphan a surrogate", () => {
  const s = "a" + "🪞".repeat(4) + "b";
  for (let n = 1; n <= s.length; n++) {
    for (const fn of [safeTruncate, safeTruncateEnd]) {
      const t = fn(s, n);
      assert.doesNotThrow(() => JSON.parse(JSON.stringify({ t })), `${fn.name} n=${n}`);
      assert.ok(t.length <= n);
    }
  }
});

test("safeTruncateEnd keeps the tail, safeTruncate keeps the head", () => {
  assert.equal(safeTruncate("abcdef", 3), "abc");
  assert.equal(safeTruncateEnd("abcdef", 3), "def");
});

// ─── verdict parsing ──────────────────────────────────────────────────

const V = (extra = "") =>
  `{"label":"correction","confidence":"high","evidence":"x","rationale":"y"${extra}}`;

test("parseVerdict accepts plain JSON", () => {
  assert.equal(parseVerdict(V()).label, "correction");
});

test("parseVerdict survives a fenced code block INSIDE the evidence field", () => {
  // The rubric asks for verbatim quotes over a corpus full of pasted code, so
  // this is the expected shape — and stripping the fence before parsing turned
  // every one of these into an unrecoverable failure.
  const raw = JSON.stringify({
    label: "failure_report",
    confidence: "high",
    evidence: "```js\nthrow new Error()\n```",
    rationale: "reports a crash",
  });
  const v = parseVerdict(raw);
  assert.equal(v.label, "failure_report");
  assert.ok(v.evidence.includes("```js"));
});

test("parseVerdict still unwraps a response that is genuinely fenced", () => {
  assert.equal(parseVerdict("```json\n" + V() + "\n```").label, "correction");
});

test("parseVerdict rejects malformed and out-of-schema output as a non-retryable failure", () => {
  for (const bad of [
    '{"label":"undo_request","confidence":"high","evidence":"","rationale":""}',
    '{"label":"correction","confidence":0.92,"evidence":"","rationale":""}',
    '{"label":"correction","confid',
    "null",
    "42",
    "[]",
    "",
  ]) {
    assert.throws(() => parseVerdict(bad), Error, `should have thrown on ${JSON.stringify(bad)}`);
  }
});

test("a parse failure is classified as non-retryable even when it quotes network words", () => {
  const e = new ParseFailure('judge returned non-JSON: {"evidence":"socket timeout, abort"}');
  assert.equal(isRetryable(e), false, "a deterministic failure must not be retried five times");
});

test("transport failures are classified as retryable", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(isRetryable(abort), true);

  const reset = new Error("read ECONNRESET");
  (reset as { cause?: unknown }).cause = { code: "ECONNRESET" };
  assert.equal(isRetryable(reset), true);

  assert.equal(isRetryable(new TypeError("fetch failed")), true);
  assert.equal(isRetryable(new Error("terminated")), true);
  assert.equal(isRetryable(new Error("something ordinary")), false);
  assert.equal(isRetryable("not an error"), false);
});

// ─── fingerprint ──────────────────────────────────────────────────────

test("judgeFingerprint is stable within a build and short enough to key on", () => {
  const a = judgeFingerprint();
  assert.equal(a, judgeFingerprint());
  assert.match(a, /^[0-9a-f]{6,12}$/);
});
