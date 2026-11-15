import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseReflection2, MAX_EXPIRY_TURNS, MIN_EXPIRY_TURNS } from "./schema.js";
import { formatForAgent, MAX_CONTEXT_CHARS } from "./format.js";
import { buildReflectionInput } from "./reflection.js";
import { VERSION } from "../version.js";

const base = {
  pattern: "p",
  signal: "s",
  adjustment: "a",
  confidence: "high",
  scope: "this_session",
  false_trigger_likelihood: "low",
  counter_hypothesis: "c",
  verify: "v",
  expires_after_turns: 8,
};

test("parseReflection2 clamps the expiry into [3, 12]", () => {
  assert.equal(parseReflection2(JSON.stringify({ ...base, expires_after_turns: 99 })).expires_after_turns, MAX_EXPIRY_TURNS);
  assert.equal(parseReflection2(JSON.stringify({ ...base, expires_after_turns: 0 })).expires_after_turns, MIN_EXPIRY_TURNS);
  assert.equal(parseReflection2(JSON.stringify({ ...base, expires_after_turns: "x" })).expires_after_turns, 8);
});

test("parseReflection2 rejects out-of-enum levels and a missing adjustment", () => {
  assert.throws(() => parseReflection2(JSON.stringify({ ...base, confidence: "very" })), /out of enum/);
  assert.throws(() => parseReflection2(JSON.stringify({ ...base, adjustment: "  " })), /no adjustment/);
  assert.throws(() => parseReflection2("not json"), /not JSON/);
});

test("low confidence or a likely false trigger turns the adjustment into a question", () => {
  const r = parseReflection2(JSON.stringify({ ...base, confidence: "low" }));
  assert.match(formatForAgent(r, { pushbacks: 2, window: 6, turns: [3, 5] }), /ask the developer before acting/);
  const r2 = parseReflection2(JSON.stringify({ ...base, false_trigger_likelihood: "high" }));
  assert.match(formatForAgent(r2, { pushbacks: 2, window: 6, turns: [3, 5] }), /ask the developer before acting/);
});

test("injected context stays far below Claude Code's 10,000-character limit", () => {
  const long = "x".repeat(5000);
  const r = parseReflection2(JSON.stringify({ ...base, pattern: long, signal: long, adjustment: long, counter_hypothesis: long }));
  assert.ok(formatForAgent(r, { pushbacks: 2, window: 6, turns: [1, 2] }).length <= MAX_CONTEXT_CHARS);
});

test("the reflection input carries the developer's words and the judge's evidence", () => {
  const s = buildReflectionInput(
    [{ turn: 4, label: "correction", confidence: "high", priorSummary: "Edited src/a.ts", prompt: "only a.ts please", evidence: "only a.ts" }],
    6,
  );
  assert.match(s, /pushed back on 1 of their last 6 turns/);
  assert.match(s, /only a\.ts please/);
  assert.match(s, /Classifier's evidence span: "only a\.ts"/);
});

test("the version is the same in code, package.json and the plugin manifest", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf8")) as { version: string };
  assert.equal(pkg.version, VERSION);
  assert.equal(plugin.version, VERSION);
});
