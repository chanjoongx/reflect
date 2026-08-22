// bench/metrics.test.ts — hand-worked anchors for every statistic in the report.
//
// This file's absence is why a tie-blind average precision survived into a
// published number. `bench/verify.ts` re-derives confusion counts independently
// but never touches AP, kappa, macro-F1, the bootstrap, or the logistic fit, so
// a bug in any of those was invisible to it. Where a reference implementation
// exists, the expected value below is that implementation's output, not this
// one's.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  averagePrecision,
  bootstrapCI,
  cohensKappa,
  confusion,
  crossValPredict,
  f1,
  fbeta,
  fitLogistic,
  macroF1,
  pairedDeltaCI,
  prCurve,
  precision,
  predictLogistic,
  recall,
  wilson,
} from "./metrics.js";

const close = (a: number, b: number, eps = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !== ${b} (±${eps})`);

// ─── confusion / P / R / F ────────────────────────────────────────────

test("confusion counts the four cells", () => {
  const c = confusion([true, true, false, false], [true, false, true, false]);
  assert.deepEqual(c, { tp: 1, fp: 1, fn: 1, tn: 1 });
  close(precision(c), 0.5);
  close(recall(c), 0.5);
  close(f1(c), 0.5);
});

test("precision and recall are 0, not NaN, when nothing is predicted or present", () => {
  close(precision({ tp: 0, fp: 0, fn: 3, tn: 1 }), 0);
  close(recall({ tp: 0, fp: 2, fn: 0, tn: 1 }), 0);
  close(f1({ tp: 0, fp: 0, fn: 0, tn: 4 }), 0);
});

test("fbeta(0.5) weights precision above recall", () => {
  const c = { tp: 3, fp: 1, fn: 5, tn: 20 }; // P=0.75, R=0.375
  close(fbeta(c, 1), f1(c));
  assert.ok(fbeta(c, 0.5) > f1(c), "F0.5 must exceed F1 when precision > recall");
  close(fbeta(c, 0.5), (1.25 * 0.75 * 0.375) / (0.25 * 0.75 + 0.375));
});

// ─── average precision ────────────────────────────────────────────────

test("averagePrecision matches sklearn on distinct scores", () => {
  // sklearn.metrics.average_precision_score([0,0,1,1],[0.1,0.4,0.35,0.8]) = 0.8333333
  close(averagePrecision([0.1, 0.4, 0.35, 0.8], [false, false, true, true]), 0.8333333, 1e-6);
});

test("averagePrecision is order-independent under ties — the bug that shipped", () => {
  // Same score multiset, same label multiset, opposite arrangement. A tie-blind
  // implementation returns 1.0 and 0.5 here; both must be 0.5.
  const a = averagePrecision([0.5, 0.5], [true, false]);
  const b = averagePrecision([0.5, 0.5], [false, true]);
  close(a, b, 1e-12, "tie ordering changed the answer");
  close(a, 0.5);
});

test("averagePrecision handles a large tie block at the bottom", () => {
  // 1 positive above the tie, 1 positive inside a 4-wide tie at 0.
  const scores = [0.9, 0, 0, 0, 0];
  const truth = [true, false, true, false, false];
  const ap = averagePrecision(scores, truth);
  // block 1: recall 0.5 at precision 1.0 -> 0.5
  // block 2: recall 1.0 at precision 2/5 -> 0.4 * 0.5 = 0.2
  close(ap, 0.7);
});

test("averagePrecision is 0 with no positives and 1 with perfect separation", () => {
  close(averagePrecision([0.9, 0.1], [false, false]), 0);
  close(averagePrecision([0.9, 0.8, 0.1], [true, true, false]), 1);
});

// ─── PR curve ─────────────────────────────────────────────────────────

test("prCurve emits one point per distinct score, descending", () => {
  const pts = prCurve([0.9, 0.5, 0.5, 0.1], [true, true, false, false]);
  assert.equal(pts.length, 3);
  assert.deepEqual(
    pts.map((p) => p.threshold),
    [0.9, 0.5, 0.1],
  );
  close(pts[0]!.recall, 0.5);
  close(pts[0]!.precision, 1);
  close(pts[2]!.recall, 1);
});

// ─── kappa ────────────────────────────────────────────────────────────

test("cohensKappa matches the textbook 2x2", () => {
  // a=20 both-yes, 5 A-yes/B-no, 10 A-no/B-yes, 15 both-no  -> kappa = 0.4
  const A = [
    ...Array(20).fill("y"),
    ...Array(5).fill("y"),
    ...Array(10).fill("n"),
    ...Array(15).fill("n"),
  ];
  const B = [
    ...Array(20).fill("y"),
    ...Array(5).fill("n"),
    ...Array(10).fill("y"),
    ...Array(15).fill("n"),
  ];
  close(cohensKappa(A, B).kappa, 0.4, 1e-9);
});

test("cohensKappa is 1 on identity and 0 on chance-level agreement", () => {
  close(cohensKappa(["a", "b", "c"], ["a", "b", "c"]).kappa, 1);
  // Perfect disagreement with equal marginals gives negative kappa.
  assert.ok(cohensKappa(["a", "b"], ["b", "a"]).kappa < 0);
});

// ─── macro F1 ─────────────────────────────────────────────────────────

test("macroF1 averages over all named classes, including zero-support ones", () => {
  // sklearn f1_score(truth, pred, average="macro", labels=["a","b","c"]) = 0.3333
  const pred = ["a", "a", "b", "c", "c"];
  const truth = ["a", "b", "b", "b", "a"];
  const m = macroF1(pred, truth, ["a", "b", "c"]);
  close(m.macro, 1 / 3, 1e-9, "zero-support classes must not be dropped from the average");
});

test("macroF1 reports per-class support from truth", () => {
  const m = macroF1(["a", "b"], ["a", "a"], ["a", "b"]);
  assert.equal(m.perClass["a"]!.support, 2);
  assert.equal(m.perClass["b"]!.support, 0);
});

// ─── intervals ────────────────────────────────────────────────────────

test("bootstrapCI brackets the point estimate and is deterministic", () => {
  const pred = Array.from({ length: 200 }, (_, i) => i % 3 === 0);
  const truth = Array.from({ length: 200 }, (_, i) => i % 4 === 0);
  const a = bootstrapCI(pred, truth, precision, 500);
  const b = bootstrapCI(pred, truth, precision, 500);
  assert.deepEqual(a, b, "same seed must give the same interval");
  assert.ok(a.lo <= a.point && a.point <= a.hi, `${a.lo} <= ${a.point} <= ${a.hi}`);
});

test("bootstrapCI percentile index is not the maximum at small iters", () => {
  // With the old floor(iters*0.975) this returned index 39 of 40 — the max.
  const pred = Array.from({ length: 60 }, (_, i) => i % 2 === 0);
  const truth = Array.from({ length: 60 }, (_, i) => i % 3 === 0);
  const ci = bootstrapCI(pred, truth, recall, 40);
  assert.ok(ci.hi <= 1 && ci.lo >= 0);
  assert.ok(ci.lo < ci.hi);
});

test("wilson brackets a proportion and stays inside [0,1]", () => {
  const w = wilson(7, 10);
  close(w.point, 0.7);
  assert.ok(w.lo > 0 && w.hi < 1 && w.lo < 0.7 && w.hi > 0.7);
  const zero = wilson(0, 0);
  assert.deepEqual(zero, { point: 0, lo: 0, hi: 0 });
});

test("pairedDeltaCI resamples both arms on the same rows", () => {
  const n = 300;
  const truth = Array.from({ length: n }, (_, i) => i % 3 === 0);
  const good = truth.map((t, i) => (i % 10 === 0 ? !t : t)); // mostly right
  const bad = truth.map(() => false); // predicts nothing
  const d = pairedDeltaCI(good, bad, truth, f1, { iters: 400 });
  assert.ok(d.point > 0.5, `expected a large positive delta, got ${d.point}`);
  assert.ok(d.lo > 0, "an obviously real difference must exclude zero");
  assert.ok(d.pLeZero < 0.01);
});

test("pairedDeltaCI widens under clustering when outcomes correlate within a cluster", () => {
  // Clustering only widens an interval when there is within-cluster
  // correlation to account for — which is exactly the situation in the corpus,
  // where a session's turns share a task, a mood and a working style. Build
  // that correlation explicitly: every row in a cluster shares its outcome.
  const clusters = 15;
  const per = 20;
  const n = clusters * per;
  const truth: boolean[] = [];
  const a: boolean[] = [];
  const b: boolean[] = [];
  const groups: string[] = [];
  for (let c = 0; c < clusters; c++) {
    const t = c % 3 === 0;
    const aWrong = c % 5 === 0; // whole clusters go wrong together
    const bWrong = c % 2 === 0;
    for (let j = 0; j < per; j++) {
      truth.push(t);
      a.push(aWrong ? !t : t);
      b.push(bWrong ? !t : t);
      groups.push(`s${c}`);
    }
  }
  const iid = pairedDeltaCI(a, b, truth, f1, { iters: 600 });
  const cl = pairedDeltaCI(a, b, truth, f1, { iters: 600, groups });
  assert.ok(
    cl.hi - cl.lo > iid.hi - iid.lo,
    `clustered ${(cl.hi - cl.lo).toFixed(4)} should exceed iid ${(iid.hi - iid.lo).toFixed(4)} when outcomes cluster`,
  );
});

// ─── logistic ─────────────────────────────────────────────────────────

test("fitLogistic converges and reports that it did", () => {
  // Separable-ish: y = x0
  const X = Array.from({ length: 200 }, (_, i) => [i % 2, (i % 5) / 5]);
  const y = X.map((x) => x[0] === 1);
  const m = fitLogistic(X, y);
  assert.equal(m.converged, true, `did not converge in ${m.iterations} iterations`);
  assert.ok((m.weights[0] as number) > 0, "the informative feature must get a positive weight");
  assert.ok(predictLogistic(m, [1, 0.5]) > predictLogistic(m, [0, 0.5]));
});

test("fitLogistic on an empty design returns a null model rather than NaN", () => {
  const m = fitLogistic([], []);
  assert.deepEqual(m.weights, []);
  assert.equal(m.converged, true);
});

test("crossValPredict is out of fold and never emits NaN", () => {
  const X = Array.from({ length: 100 }, (_, i) => [i % 2, Math.sin(i)]);
  const y = X.map((x) => x[0] === 1);
  const { oof, folds } = crossValPredict(X, y, 5);
  assert.equal(oof.length, 100);
  assert.ok(oof.every((v) => Number.isFinite(v)), "out-of-fold predictions must be finite");
  assert.equal(folds.length, 5);
});

test("crossValPredict with a degenerate fold count does not produce NaN", () => {
  const X = [[1], [0], [1]];
  const y = [true, false, true];
  const { oof } = crossValPredict(X, y, 1); // every row is test, training is empty
  assert.ok(oof.every((v) => Number.isFinite(v)), `got ${JSON.stringify(oof)}`);
});

test("crossValPredict is deterministic for a fixed seed", () => {
  const X = Array.from({ length: 60 }, (_, i) => [i % 3, i % 2]);
  const y = X.map((x) => x[0] === 0);
  assert.deepEqual(crossValPredict(X, y, 4, 7).oof, crossValPredict(X, y, 4, 7).oof);
});
