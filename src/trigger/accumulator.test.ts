import { test } from "node:test";
import assert from "node:assert/strict";
import { Accumulator, TRIGGER_POLICIES, defaultPolicy, policyById, type PushbackSignal, type TriggerPolicy } from "./accumulator.js";

const P = (s: Partial<TriggerPolicy>): TriggerPolicy => ({ id: "t", k: 2, window: 6, cooldown: 3, ...s });
const hit: PushbackSignal = { label: "correction", confidence: "high" };
const low: PushbackSignal = { label: "correction", confidence: "low" };

function feed(policy: TriggerPolicy, seq: Array<PushbackSignal | null>): number[] {
  const acc = new Accumulator(policy);
  const fired: number[] = [];
  seq.forEach((s, i) => {
    if (acc.observe(`p${i}`, s)) fired.push(i);
  });
  return fired;
}

test("exactly one policy is the default, and unknown ids fall back to it", () => {
  assert.equal(TRIGGER_POLICIES.filter((p) => p.isDefault).length, 1);
  assert.equal(policyById("nope").id, defaultPolicy().id);
  assert.equal(policyById(undefined).id, defaultPolicy().id);
});

test("k=2: the second pushback inside the window fires, the first does not", () => {
  assert.deepEqual(feed(P({}), [hit, null, null, hit]), [3]);
});

test("pushbacks further apart than the window never meet", () => {
  // window 6 counts the current turn: turns 0 and 6 are 7 turns apart.
  assert.deepEqual(feed(P({}), [hit, null, null, null, null, null, hit]), []);
  assert.deepEqual(feed(P({}), [hit, null, null, null, null, hit]), [5]);
});

test("a fire clears the evidence and starts a cooldown", () => {
  // fire at 1; 2..4 are cooling down; the hits at 3 and 5 can pair after it.
  assert.deepEqual(feed(P({}), [hit, hit, hit, hit, null, hit]), [1, 5]);
});

test("the fire names the turns that tripped it, oldest first", () => {
  const acc = new Accumulator(P({}));
  acc.observe("a", hit);
  acc.observe("b", null);
  assert.deepEqual(acc.observe("c", hit)?.evidence, ["a", "c"]);
});

test("minConfidence drops low-confidence verdicts", () => {
  assert.deepEqual(feed(P({ minConfidence: "medium" }), [low, hit, low, hit]), [3]);
});

test("k=1 fires on every pushback when there is no cooldown", () => {
  assert.deepEqual(feed(P({ k: 1, window: 1, cooldown: 0 }), [hit, null, hit, hit]), [0, 2, 3]);
});
