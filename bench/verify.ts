// bench/verify.ts — independent recomputation of the headline numbers.
//
// score.ts produces every figure in the report through one shared pipeline
// (confusion() → precision()/recall()/f1()). A bug in that pipeline would be
// invisible: every number would be wrong the same way and still look
// internally consistent. This file recomputes the load-bearing figures from
// the raw JSONL with plain counters and no shared code, then asserts the two
// agree. It is deliberately dumb.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { judgeFingerprint } from "../src/detect/judge.js";

const PUSH = new Set(["correction", "rejection", "failure_report"]);

const pairs = new Map<string, any>();
for (const l of readFileSync("bench/data/pairs.jsonl", "utf8").split("\n").filter(Boolean)) {
  const p = JSON.parse(l);
  pairs.set(p.pairId, p);
}

// Only verdicts from the current rubric count — same filter score.ts applies.
const FP = judgeFingerprint();

const runs: Record<string, Map<string, string>> = {
  ref: new Map(),
  prod: new Map(),
  blind: new Map(),
  blindfair: new Map(),
  shuffled: new Map(),
};
for (const l of readFileSync("bench/data/labels.jsonl", "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(l);
  if (r.fp !== FP) continue;
  if (runs[r.run]) (runs[r.run] as Map<string, string>).set(r.pairId, r.verdict.label);
}

const ids = [...pairs.keys()]
  .filter(
    (id) =>
      runs["ref"]!.has(id) &&
      runs["prod"]!.has(id) &&
      runs["blind"]!.has(id) &&
      runs["blindfair"]!.has(id) &&
      runs["shuffled"]!.has(id),
  )
  .sort();

// ─── plain counters, no helper functions ──────────────────────────────

function count(predicate: (id: string) => boolean) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const id of ids) {
    const t = PUSH.has(runs["ref"]!.get(id) as string);
    const p = predicate(id);
    if (p && t) tp += 1;
    else if (p && !t) fp += 1;
    else if (!p && t) fn += 1;
    else tn += 1;
  }
  const prec = tp + fp === 0 ? 0 : tp / (tp + fp);
  const rec = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
  return { tp, fp, fn, tn, prec, rec, f1 };
}

const results = JSON.parse(readFileSync("bench/results/results.json", "utf8"));
const find = (fn: (x: any) => boolean) => (results.baselines as any[]).find(fn);

const CHECKS: Array<[string, ReturnType<typeof count>, any]> = [];

CHECKS.push(["B0 shipped regex", count((id) => pairs.get(id).lexicalEn === true), find((x) => x.id === "B0")]);
CHECKS.push([
  "B1 + Korean regex",
  count((id) => pairs.get(id).lexicalEn === true || pairs.get(id).lexicalKo === true),
  find((x) => x.id === "B1"),
]);
CHECKS.push([
  "B2 gate @0.50",
  count((id) => pairs.get(id).gate.pass === true && pairs.get(id).gate.score >= 0.5),
  find((x) => x.id === "B2"),
]);
CHECKS.push([
  "B4 judge everywhere",
  count((id) => PUSH.has(runs["prod"]!.get(id) as string)),
  find((x) => x.id === "B4"),
]);
CHECKS.push([
  "B6 blind (fair)",
  count((id) => PUSH.has(runs["blindfair"]!.get(id) as string)),
  find((x) => x.id === "B6"),
]);
CHECKS.push([
  "shuffled prior",
  count((id) => PUSH.has(runs["shuffled"]!.get(id) as string)),
  null,
]);
CHECKS.push([
  "B6n blind (naive)",
  count((id) => PUSH.has(runs["blind"]!.get(id) as string)),
  find((x) => x.id === "B6n"),
]);
for (const theta of [0.3, 0.5]) {
  CHECKS.push([
    `B5 cascade θ=${theta.toFixed(2)}`,
    count(
      (id) =>
        pairs.get(id).gate.pass === true &&
        pairs.get(id).gate.score >= theta &&
        PUSH.has(runs["prod"]!.get(id) as string),
    ),
    find((x) => x.theta === theta),
  ]);
}

const EPS = 1e-9;
let failures = 0;
const w = (s: string, n: number) => s.padEnd(n);

console.log(`independent recomputation over ${ids.length} pairs\n`);
console.log(w("detector", 22) + w("TP", 5) + w("FP", 5) + w("FN", 5) + w("precision", 11) + w("recall", 10) + "verdict");
console.log("-".repeat(72));
for (const [name, mine, theirs] of CHECKS) {
  if (!theirs) {
    console.log(
      w(name, 22) + w(String(mine.tp), 5) + w(String(mine.fp), 5) + w(String(mine.fn), 5) +
        w((mine.prec * 100).toFixed(1) + "%", 11) + w((mine.rec * 100).toFixed(1) + "%", 10) + "info",
    );
    continue;
  }
  const ok =
    mine.tp === theirs.tp &&
    mine.fp === theirs.fp &&
    mine.fn === theirs.fn &&
    Math.abs(mine.prec - theirs.precision) < EPS &&
    Math.abs(mine.rec - theirs.recall) < EPS &&
    Math.abs(mine.f1 - theirs.f1) < EPS;
  if (!ok) failures++;
  console.log(
    w(name, 22) +
      w(String(mine.tp), 5) +
      w(String(mine.fp), 5) +
      w(String(mine.fn), 5) +
      w((mine.prec * 100).toFixed(1) + "%", 11) +
      w((mine.rec * 100).toFixed(1) + "%", 10) +
      (ok ? "MATCH" : `MISMATCH (report says TP=${theirs.tp} FP=${theirs.fp} FN=${theirs.fn})`),
  );
}

// ─── corpus-level cross-checks ────────────────────────────────────────

console.log("");
const push = ids.filter((id) => PUSH.has(runs["ref"]!.get(id) as string)).length;
const checks: Array<[string, unknown, unknown]> = [
  ["evaluated pairs", ids.length, results.corpus.evaluated],
  ["pushback count", push, results.corpus.pushback],
  ["pushback rate", (push / ids.length).toFixed(6), results.corpus.pushbackRate.toFixed(6)],
  [
    "gate hard rejects",
    ids.filter((id) => pairs.get(id).gate.pass === false).length,
    results.gate.rejected,
  ],
  [
    "pushbacks lost to gate",
    ids.filter((id) => pairs.get(id).gate.pass === false && PUSH.has(runs["ref"]!.get(id) as string)).length,
    results.gate.pushbacksLost,
  ],
  [
    "7-way agreement prod",
    (ids.filter((id) => runs["prod"]!.get(id) === runs["ref"]!.get(id)).length / ids.length).toFixed(6),
    results.ablation.agreementSighted.toFixed(6),
  ],
  [
    "7-way agreement blind(fair)",
    (ids.filter((id) => runs["blindfair"]!.get(id) === runs["ref"]!.get(id)).length / ids.length).toFixed(6),
    results.ablation.agreementBlind.toFixed(6),
  ],
  [
    "7-way agreement blind(naive)",
    (ids.filter((id) => runs["blind"]!.get(id) === runs["ref"]!.get(id)).length / ids.length).toFixed(6),
    results.ablation.agreementBlindNaive.toFixed(6),
  ],
  [
    "prompt-mismatch F1 points",
    (
      (CHECKS.find(([n]) => n === "B6 blind (fair)")?.[1].f1 ?? 0) -
      (CHECKS.find(([n]) => n === "B6n blind (naive)")?.[1].f1 ?? 0)
    ).toFixed(6),
    results.ablation.promptMismatchF1Points.toFixed(6),
  ],
];
for (const [name, mine, theirs] of checks) {
  const ok = String(mine) === String(theirs);
  if (!ok) failures++;
  console.log(`${w(name, 26)} mine=${w(String(mine), 12)} report=${w(String(theirs), 12)} ${ok ? "MATCH" : "MISMATCH"}`);
}

// ─── sanity invariants that must hold regardless ──────────────────────

console.log("");
const by = (name: string) => CHECKS.find(([n]) => n === name)?.[1];
const cascade30 = by("B5 cascade θ=0.30")!;
const judgeAll = by("B4 judge everywhere")!;
const fairBlind = by("B6 blind (fair)")!;
const inv: Array<[string, boolean]> = [
  ["every TP+FP+FN+TN sums to n", CHECKS.every(([, m]) => m.tp + m.fp + m.fn + m.tn === ids.length)],
  ["cascade TP <= judge-everywhere TP", cascade30.tp <= judgeAll.tp],
  ["cascade FP <= judge-everywhere FP", cascade30.fp <= judgeAll.fp],
  ["higher gate theta never raises recall", true],
  ["B0 predicts nothing", (by("B0 shipped regex")!.tp + by("B0 shipped regex")!.fp) === 0],
  ["blind recall <= sighted recall", fairBlind.rec <= judgeAll.rec],
];
let prevRecall = Infinity;
for (const t of [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
  const r = count(
    (id) =>
      pairs.get(id).gate.pass === true &&
      pairs.get(id).gate.score >= t &&
      PUSH.has(runs["prod"]!.get(id) as string),
  ).rec;
  if (r > prevRecall + EPS) inv[3] = ["higher gate theta never raises recall", false];
  prevRecall = r;
}
for (const [name, ok] of inv) {
  if (!ok) failures++;
  console.log(`${w(name, 44)} ${ok ? "OK" : "VIOLATED"}`);
}

console.log("");
if (failures) {
  console.log(`${failures} MISMATCH(ES) — the report and this file disagree. Do not trust the report.`);
  process.exit(1);
}
console.log("all independent checks agree with bench/results/results.json");
assert.equal(failures, 0);
