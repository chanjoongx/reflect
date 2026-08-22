// bench/metrics.ts — pure scoring functions.
//
// Kept free of I/O so they can be unit-tested against hand-worked examples,
// which matters more here than usual: every headline number in the report is
// produced by this file, and a silent arithmetic error would be indistinguish-
// able from a real result.

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export function confusion(pred: boolean[], truth: boolean[]): Confusion {
  if (pred.length !== truth.length) throw new Error("length mismatch");
  const c: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (let i = 0; i < pred.length; i++) {
    const p = pred[i] as boolean;
    const t = truth[i] as boolean;
    if (p && t) c.tp++;
    else if (p && !t) c.fp++;
    else if (!p && t) c.fn++;
    else c.tn++;
  }
  return c;
}

export function precision(c: Confusion): number {
  return c.tp + c.fp === 0 ? 0 : c.tp / (c.tp + c.fp);
}
export function recall(c: Confusion): number {
  return c.tp + c.fn === 0 ? 0 : c.tp / (c.tp + c.fn);
}
export function f1(c: Confusion): number {
  const p = precision(c);
  const r = recall(c);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}
/** F-beta with beta<1 weighting precision — the asymmetric loss reflect faces. */
export function fbeta(c: Confusion, beta: number): number {
  const p = precision(c);
  const r = recall(c);
  const b2 = beta * beta;
  return p + r === 0 ? 0 : ((1 + b2) * p * r) / (b2 * p + r);
}

// ─── Threshold sweeps ─────────────────────────────────────────────────

export interface PRPoint {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  predictedPositive: number;
}

/** Sweep every distinct score as an operating point (>= threshold ⇒ positive). */
export function prCurve(scores: number[], truth: boolean[]): PRPoint[] {
  const uniq = [...new Set(scores)].sort((a, b) => b - a);
  const points: PRPoint[] = [];
  for (const t of uniq) {
    const pred = scores.map((s) => s >= t);
    const c = confusion(pred, truth);
    points.push({
      threshold: t,
      precision: precision(c),
      recall: recall(c),
      f1: f1(c),
      tp: c.tp,
      fp: c.fp,
      fn: c.fn,
      predictedPositive: c.tp + c.fp,
    });
  }
  return points;
}

/**
 * Average precision, TIE-AWARE.
 *
 * The naive implementation walks the sorted list one row at a time, which
 * silently assumes a strict ordering. It does not have one here: the hand-prior
 * structural score takes ~57 distinct values over ~836 rows and puts 265 of them
 * at exactly 0, while the cross-validated logistic scores are effectively
 * continuous. Breaking those ties by array order is a coin flip that only one
 * arm has to survive, and it moves the hand-prior AP by ±0.04 depending on which
 * way the coin lands — comparable to the effect being measured.
 *
 * Ties are therefore consumed as a block: all rows at one score are added
 * together and precision is taken at the end of the block, which is the standard
 * interpolation and is order-independent by construction.
 */
export function averagePrecision(scores: number[], truth: boolean[]): number {
  const order = scores
    .map((s, i) => [s, truth[i] as boolean] as const)
    .sort((a, b) => b[0] - a[0]);
  const total = truth.filter(Boolean).length;
  if (total === 0) return 0;

  let tp = 0;
  let seen = 0;
  let sum = 0;
  let prevRecall = 0;
  let i = 0;
  while (i < order.length) {
    const score = (order[i] as readonly [number, boolean])[0];
    let blockPos = 0;
    let blockN = 0;
    while (i < order.length && (order[i] as readonly [number, boolean])[0] === score) {
      if ((order[i] as readonly [number, boolean])[1]) blockPos++;
      blockN++;
      i++;
    }
    tp += blockPos;
    seen += blockN;
    const r = tp / total;
    const p = tp / seen;
    if (r > prevRecall) {
      sum += p * (r - prevRecall);
      prevRecall = r;
    }
  }
  return sum;
}

/** Best operating point subject to a recall floor, maximising precision. */
export function bestPointAtRecallFloor(points: PRPoint[], floor: number): PRPoint | null {
  const ok = points.filter((p) => p.recall >= floor);
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => (b.precision > a.precision ? b : a));
}

// ─── Uncertainty ──────────────────────────────────────────────────────

/** Deterministic LCG so reported intervals are reproducible. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export interface CI {
  point: number;
  lo: number;
  hi: number;
}

/** Percentile bootstrap over paired (pred, truth) observations. */
export function bootstrapCI(
  pred: boolean[],
  truth: boolean[],
  stat: (c: Confusion) => number,
  iters = 2000,
  seed = 12345,
): CI {
  const point = stat(confusion(pred, truth));
  const n = pred.length;
  const rnd = lcg(seed);
  const vals: number[] = [];
  for (let it = 0; it < iters; it++) {
    const p: boolean[] = new Array(n);
    const t: boolean[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rnd() * n);
      p[i] = pred[j] as boolean;
      t[i] = truth[j] as boolean;
    }
    vals.push(stat(confusion(p, t)));
  }
  vals.sort((a, b) => a - b);
  // Percentile indices on (n-1), not n: with iters=40 the old `floor(n*0.975)`
  // returned index 39 — the maximum, not the 97.5th percentile.
  return {
    point,
    lo: vals[Math.floor((iters - 1) * 0.025)] ?? 0,
    hi: vals[Math.ceil((iters - 1) * 0.975)] ?? 0,
  };
}

/**
 * Percentile bootstrap on the DIFFERENCE between two predictors, resampled in
 * pairs so the two arms always see the same rows.
 *
 * Reporting two independent intervals and eyeballing whether they overlap is
 * not a test of the difference — overlapping intervals are routinely
 * compatible with a difference far from zero, and non-overlapping ones
 * overstate significance. `groups` optionally clusters the resample (by
 * session), because turns from one session are not independent draws.
 */
export function pairedDeltaCI(
  predA: boolean[],
  predB: boolean[],
  truth: boolean[],
  stat: (c: Confusion) => number,
  opts: { iters?: number; seed?: number; groups?: string[] } = {},
): CI & { pLeZero: number } {
  const iters = opts.iters ?? 2000;
  const rnd = lcg(opts.seed ?? 4321);
  const n = truth.length;
  const point = stat(confusion(predA, truth)) - stat(confusion(predB, truth));

  // Build the resampling units: individual rows, or clusters of row indices.
  let units: number[][];
  if (opts.groups) {
    const byGroup = new Map<string, number[]>();
    opts.groups.forEach((g, i) => {
      if (!byGroup.has(g)) byGroup.set(g, []);
      (byGroup.get(g) as number[]).push(i);
    });
    units = [...byGroup.values()];
  } else {
    units = Array.from({ length: n }, (_, i) => [i]);
  }

  const vals: number[] = [];
  let leZero = 0;
  for (let it = 0; it < iters; it++) {
    const idx: number[] = [];
    while (idx.length < n) {
      const u = units[Math.floor(rnd() * units.length)] as number[];
      for (const i of u) idx.push(i);
    }
    idx.length = n;
    const a: boolean[] = [];
    const b: boolean[] = [];
    const t: boolean[] = [];
    for (const i of idx) {
      a.push(predA[i] as boolean);
      b.push(predB[i] as boolean);
      t.push(truth[i] as boolean);
    }
    const d = stat(confusion(a, t)) - stat(confusion(b, t));
    vals.push(d);
    if (d <= 0) leZero++;
  }
  vals.sort((x, y) => x - y);
  return {
    point,
    lo: vals[Math.floor((iters - 1) * 0.025)] ?? 0,
    hi: vals[Math.ceil((iters - 1) * 0.975)] ?? 0,
    pLeZero: leZero / iters,
  };
}

/** Wilson score interval for a proportion — used for agreement rates. */
export function wilson(successes: number, n: number, z = 1.96): CI {
  if (n === 0) return { point: 0, lo: 0, hi: 0 };
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { point: p, lo: (c - s) / d, hi: (c + s) / d };
}

// ─── Agreement ────────────────────────────────────────────────────────

export interface KappaResult {
  observed: number;
  expected: number;
  kappa: number;
  n: number;
}

/** Cohen's kappa for two categorical labellings of the same items. */
export function cohensKappa(a: string[], b: string[]): KappaResult {
  if (a.length !== b.length) throw new Error("length mismatch");
  const n = a.length;
  if (n === 0) return { observed: 0, expected: 0, kappa: 0, n: 0 };
  const cats = [...new Set([...a, ...b])];
  let agree = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
  const observed = agree / n;
  const ca = new Map<string, number>();
  const cb = new Map<string, number>();
  for (const x of a) ca.set(x, (ca.get(x) ?? 0) + 1);
  for (const x of b) cb.set(x, (cb.get(x) ?? 0) + 1);
  let expected = 0;
  for (const k of cats) expected += ((ca.get(k) ?? 0) / n) * ((cb.get(k) ?? 0) / n);
  const kappa = expected === 1 ? 1 : (observed - expected) / (1 - expected);
  return { observed, expected, kappa, n };
}

/** Per-class one-vs-rest scores plus the macro average. */
export function macroF1(
  pred: string[],
  truth: string[],
  classes: readonly string[],
): { perClass: Record<string, { p: number; r: number; f1: number; support: number }>; macro: number } {
  const perClass: Record<string, { p: number; r: number; f1: number; support: number }> = {};
  let sum = 0;
  let counted = 0;
  for (const cls of classes) {
    const c = confusion(
      pred.map((x) => x === cls),
      truth.map((x) => x === cls),
    );
    const support = c.tp + c.fn;
    perClass[cls] = { p: precision(c), r: recall(c), f1: f1(c), support };
    // Average over every class in the taxonomy, not only those with support.
    // Dropping zero-support classes lets a class the judge predicts but that
    // never appears in truth contribute its false positives to nothing, which
    // inflates the macro against a benchmark that does not do that. Worked
    // example: pred=[a,a,b,c,c] truth=[a,b,b,b,a] returns 0.333 here and
    // returned 0.500 before.
    sum += f1(c);
    counted++;
  }
  return { perClass, macro: counted ? sum / counted : 0 };
}

// ─── Logistic regression (for the headroom comparison only) ───────────

export interface LogitModel {
  weights: number[];
  bias: number;
  /** False when the iteration cap was hit before the step size fell below tol. */
  converged: boolean;
  iterations: number;
}

function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Batch gradient descent with an explicit convergence stop.
 *
 * The previous default of 3,000 iterations at lr 0.1 had NOT converged: AP kept
 * climbing to ~20,000 iterations and two coefficients changed sign on the way,
 * which would have made any statement about "the direction of a weight"
 * an artifact of where the loop happened to stop. It now runs until the largest
 * parameter step falls below `tol` and reports whether it got there.
 */
export function fitLogistic(
  X: number[][],
  y: boolean[],
  opts: { l2?: number; iters?: number; lr?: number; tol?: number } = {},
): LogitModel {
  const l2 = opts.l2 ?? 1.0;
  const iters = opts.iters ?? 200_000;
  const lr = opts.lr ?? 0.1;
  const tol = opts.tol ?? 1e-7;
  const d = X[0]?.length ?? 0;
  const w = new Array(d).fill(0);
  let b = 0;
  const n = X.length;
  if (n === 0) return { weights: w, bias: 0, converged: true, iterations: 0 };
  let it = 0;
  let converged = false;
  for (; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const xi = X[i] as number[];
      let z = b;
      for (let j = 0; j < d; j++) z += (w[j] as number) * (xi[j] as number);
      const e = sigmoid(z) - (y[i] ? 1 : 0);
      for (let j = 0; j < d; j++) gw[j] += e * (xi[j] as number);
      gb += e;
    }
    let maxStep = 0;
    for (let j = 0; j < d; j++) {
      const step = lr * (gw[j] / n + (l2 * (w[j] as number)) / n);
      w[j] -= step;
      maxStep = Math.max(maxStep, Math.abs(step));
    }
    const bStep = lr * (gb / n);
    b -= bStep;
    maxStep = Math.max(maxStep, Math.abs(bStep));
    if (maxStep < tol) {
      converged = true;
      it++;
      break;
    }
  }
  return { weights: w, bias: b, converged, iterations: it };
}

export function predictLogistic(m: LogitModel, x: number[]): number {
  let z = m.bias;
  for (let j = 0; j < x.length; j++) z += (m.weights[j] as number) * (x[j] as number);
  return sigmoid(z);
}

/** Out-of-fold predictions from k-fold CV — never evaluate on training rows. */
export function crossValPredict(
  X: number[][],
  y: boolean[],
  k = 5,
  seed = 99,
): { oof: number[]; folds: LogitModel[]; allConverged: boolean } {
  const n = X.length;
  const idx = [...Array(n).keys()];
  const rnd = lcg(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j] as number, idx[i] as number];
  }
  const oof = new Array(n).fill(0);
  const folds: LogitModel[] = [];
  for (let f = 0; f < k; f++) {
    const test = new Set(idx.filter((_, i) => i % k === f));
    const trX: number[][] = [];
    const trY: boolean[] = [];
    for (let i = 0; i < n; i++) {
      if (!test.has(i)) {
        trX.push(X[i] as number[]);
        trY.push(y[i] as boolean);
      }
    }
    // A fold with no training rows (k = 1, or n < k) would fit an empty model
    // and emit NaN predictions that propagate silently into AP.
    if (trX.length === 0) continue;
    const m = fitLogistic(trX, trY);
    folds.push(m);
    for (const i of test) oof[i] = predictLogistic(m, X[i] as number[]);
  }
  return { oof, folds, allConverged: folds.every((f) => f.converged) };
}

// ─── Formatting ───────────────────────────────────────────────────────

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const pctCI = (c: CI) => `${pct(c.point)} [${pct(c.lo)}–${pct(c.hi)}]`;
