// bench/score.ts — the P0 gate.
//
// Ground truth is the `ref` run (Opus 5, full context) — a gold-PROXY, not
// gold. Every number below inherits that assumption and the report says so.
//
// Baselines, in the order they answer the question:
//   B0  shipped English regex ................ what actually ships today
//   B1  + Korean regex ....................... the FINDINGS counterfactual
//   B2  Stage A structural gate, swept ....... position alone, zero language
//   B3  gate ∧ lexical ....................... cheapest possible combination
//   B4  judge on every prompt ................ accuracy ceiling, cost ceiling
//   B5  cascade  gate→judge .................. the proposal
//   B6  blind judge (no prior turn) .......... IS THE SIGNAL RELATIONAL?
//   B7  CV logistic on structural features ... headroom left by hand priors

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isPushback, LABELS } from "../src/detect/types.js";
import type { Label } from "../src/detect/types.js";
import {
  featureVector,
  extendedFeatureVector,
  FEATURE_NAMES,
  EXTENDED_FEATURE_NAMES,
} from "../src/detect/structural.js";
import { costUSD } from "../src/pricing.js";
import { judgeFingerprint } from "../src/detect/judge.js";
import {
  averagePrecision,
  bestPointAtRecallFloor,
  bootstrapCI,
  cohensKappa,
  confusion,
  f1,
  fbeta,
  macroF1,
  pct,
  pctCI,
  prCurve,
  precision,
  recall,
  crossValPredict,
  fitLogistic,
  pairedDeltaCI,
  wilson,
} from "./metrics.js";
import type { Confusion, PRPoint } from "./metrics.js";

// ─── Load ─────────────────────────────────────────────────────────────

interface Row {
  pairId: string;
  sessionId: string;
  prompt: string;
  script: string;
  gate: { pass: boolean; score: number; reason: string };
  features: any;
  lexicalEn: boolean;
  lexicalKo: boolean;
  prior: any;
  promptIndex: number;
}

interface LabelRow {
  pairId: string;
  run: string;
  fp?: string;
  verdict: { label: Label; confidence: string; evidence: string; rationale: string };
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  latencyMs: number;
}

const DATA = process.argv.includes("--data")
  ? (process.argv[process.argv.indexOf("--data") + 1] as string)
  : "bench/data";
const OUT = process.argv.includes("--out")
  ? (process.argv[process.argv.indexOf("--out") + 1] as string)
  : "bench/results";

/** Tolerate a torn final line from an interrupted append. */
function readJsonl<T>(path: string): T[] {
  const out: T[] = [];
  let bad = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      bad++;
    }
  }
  if (bad) process.stderr.write(`[score] skipped ${bad} malformed line(s) in ${path}\n`);
  return out;
}

const rows: Row[] = readJsonl<Row>(join(DATA, "pairs.jsonl"));

/**
 * Only verdicts produced by the CURRENT rubric count.
 *
 * The label cache is append-only and spans every rubric revision the project
 * has been through. Scoring all of it silently mixes annotators — the first
 * pass ended up with 31 pairs whose ground truth depended on which line was
 * appended last. `judgeFingerprint()` is the same value the labeller stamps on
 * each row, so this filter and that stamp cannot drift apart.
 */
const FP = judgeFingerprint();
const allLabelRows: LabelRow[] = readJsonl<LabelRow>(join(DATA, "labels.jsonl"));
const labelRows: LabelRow[] = allLabelRows.filter((r) => r.fp === FP);
if (labelRows.length < allLabelRows.length) {
  process.stderr.write(
    `[score] rubric ${FP}: using ${labelRows.length} of ${allLabelRows.length} cached verdicts; ` +
      `${allLabelRows.length - labelRows.length} were produced by a different rubric and are ignored
`,
  );
}

const byRun = new Map<string, Map<string, LabelRow>>();
for (const r of labelRows) {
  if (!byRun.has(r.run)) byRun.set(r.run, new Map());
  (byRun.get(r.run) as Map<string, LabelRow>).set(r.pairId, r);
}
const ref = byRun.get("ref") ?? new Map();
const prod = byRun.get("prod") ?? new Map();
const blind = byRun.get("blind") ?? new Map();
const blindFair = byRun.get("blindfair") ?? new Map();
const shuffled = byRun.get("shuffled") ?? new Map();
const HAS_SHUFFLED = shuffled.size > 0;

// Evaluate only on pairs where all three runs succeeded — identical support.
const evalRows = rows.filter(
  (r) =>
    ref.has(r.pairId) &&
    prod.has(r.pairId) &&
    blind.has(r.pairId) &&
    blindFair.has(r.pairId) &&
    (!HAS_SHUFFLED || shuffled.has(r.pairId)),
);

const out: string[] = [];
const P = (s = "") => out.push(s);

P("# reflect-bench — P0 results");
P("");
P(`Generated ${new Date().toISOString()}`);
P("");
P(`| | |`);
P(`|---|---|`);
P(`| pairs extracted | ${rows.length} |`);
P(`| pairs with all 3 runs (evaluation set) | **${evalRows.length}** |`);
P(`| sessions | ${new Set(rows.map((r) => r.sessionId)).size} |`);
P("");

if (evalRows.length < 50) {
  P("> Not enough labelled pairs yet. Run `bench/label.ts` first.");
  process.stdout.write(out.join("\n"));
  process.exit(0);
}

// ─── Ground truth ─────────────────────────────────────────────────────

const truth = evalRows.map((r) => isPushback((ref.get(r.pairId) as LabelRow).verdict.label));
const refLabels = evalRows.map((r) => (ref.get(r.pairId) as LabelRow).verdict.label as string);
const prodLabels = evalRows.map((r) => (prod.get(r.pairId) as LabelRow).verdict.label as string);
const blindLabels = evalRows.map((r) => (blind.get(r.pairId) as LabelRow).verdict.label as string);
const fairLabels = evalRows.map(
  (r) => (blindFair.get(r.pairId) as LabelRow).verdict.label as string,
);
const shuffledLabels = HAS_SHUFFLED
  ? evalRows.map((r) => (shuffled.get(r.pairId) as LabelRow).verdict.label as string)
  : [];

const nPos = truth.filter(Boolean).length;
P(`## 1. Ground truth (reference judge: Opus 5, full context)`);
P("");
P("Label distribution over the evaluation set:");
P("");
P("| label | n | share | pushback? |");
P("|---|---:|---:|:--:|");
for (const l of LABELS) {
  const n = refLabels.filter((x) => x === l).length;
  if (n === 0) continue;
  P(`| ${l} | ${n} | ${pct(n / evalRows.length)} | ${isPushback(l) ? "**yes**" : "—"} |`);
}
P(`| **pushback total** | **${nPos}** | **${pct(nPos / evalRows.length)}** | |`);
P("");
P(
  `SWE-chat reports turn-level pushback at **39%** across 6,000 sessions and 5 agents ` +
    `(arXiv 2604.20779). This corpus measures **${pct(nPos / evalRows.length)}** on ${evalRows.length} turns ` +
    `from ${new Set(evalRows.map((r) => r.sessionId)).size} sessions of a single developer.`,
);
P("");

// ─── Baseline evaluation ──────────────────────────────────────────────

interface Result {
  id: string;
  name: string;
  pred: boolean[];
  judgeCalls: number;
  note: string;
}

const results: Result[] = [];

const b0 = evalRows.map((r) => r.lexicalEn);
results.push({ id: "B0", name: "shipped regex (English)", pred: b0, judgeCalls: 0, note: "v0.1.4 as published" });

const b1 = evalRows.map((r) => r.lexicalEn || r.lexicalKo);
results.push({ id: "B1", name: "+ Korean regex", pred: b1, judgeCalls: 0, note: "FINDINGS counterfactual" });

// B2 — structural score at its hand-prior default (0.5), plus a swept curve.
const gateScores = evalRows.map((r) => (r.gate.pass ? r.gate.score : 0));
const b2 = gateScores.map((s) => s >= 0.5);
results.push({ id: "B2", name: "Stage A gate @0.50", pred: b2, judgeCalls: 0, note: "hand priors, no language" });

const b3 = evalRows.map((r) => r.gate.pass && (r.lexicalEn || r.lexicalKo));
results.push({ id: "B3", name: "gate ∧ lexical", pred: b3, judgeCalls: 0, note: "cheapest combination" });

const b4 = prodLabels.map((l) => isPushback(l as Label));
results.push({
  id: "B4",
  name: "judge every prompt (Haiku)",
  pred: b4,
  judgeCalls: evalRows.length,
  note: "accuracy + cost ceiling",
});

// B6 is the FAIR blind arm: same missing context, but a system prompt that does
// not promise context it will not receive. B6n is the naive version that reuses
// the sighted prompt verbatim. The difference between them is how much of the
// ablation gap was prompt mismatch rather than information loss.
const b6 = fairLabels.map((l) => isPushback(l as Label));
const b6n = blindLabels.map((l) => isPushback(l as Label));
results.push({
  id: "B6",
  name: "blind judge — no prior turn (fair prompt)",
  pred: b6,
  judgeCalls: evalRows.length,
  note: "the relational ablation",
});
results.push({
  id: "B6n",
  name: "blind judge — sighted prompt reused",
  pred: b6n,
  judgeCalls: evalRows.length,
  note: "naive control; gap vs B6 is prompt mismatch",
});

// B5 — cascade at a set of gate thresholds.
const CASCADE_THETAS = [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
const cascadeVariants = CASCADE_THETAS.map((theta) => {
  const gated = evalRows.map((r, i) => r.gate.pass && (gateScores[i] as number) >= theta);
  const pred = gated.map((g, i) => g && (b4[i] as boolean));
  return { theta, pred, judgeCalls: gated.filter(Boolean).length };
});

// ─── Reporting helpers ────────────────────────────────────────────────

function line(id: string, name: string, pred: boolean[], judgeCalls: number, note: string) {
  const c = confusion(pred, truth);
  const pCI = bootstrapCI(pred, truth, precision);
  const rCI = bootstrapCI(pred, truth, recall);
  return (
    `| ${id} | ${name} | ${c.tp} | ${c.fp} | ${c.fn} | ${pctCI(pCI)} | ${pctCI(rCI)} | ` +
    `${pct(f1(c))} | ${pct(fbeta(c, 0.5))} | ${judgeCalls ? ((judgeCalls / evalRows.length) * 100).toFixed(0) + "%" : "0"} | ${note} |`
  );
}

P("## 2. Baselines");
P("");
P("Positive class = pushback (correction ∪ rejection ∪ failure_report). Intervals are 2.5/97.5 percentile bootstrap, 2,000 resamples.");
P("");
P("| | detector | TP | FP | FN | precision | recall | F1 | F0.5 | judge calls | |");
P("|---|---|---:|---:|---:|---|---|---:|---:|---:|---|");
for (const r of results.filter((r) => r.id !== "B6" && r.id !== "B6n")) {
  P(line(r.id, r.name, r.pred, r.judgeCalls, r.note));
}
for (const v of cascadeVariants) {
  if (![0.3, 0.5, 0.6].includes(v.theta)) continue;
  P(line("B5", `cascade gate≥${v.theta.toFixed(2)} → judge`, v.pred, v.judgeCalls, "the proposal"));
}
P("");
P("F0.5 weights precision over recall — the asymmetric loss reflect actually faces: a missed correction costs nothing observable, a false reflection costs a real interruption.");
P("");

// ─── The relational ablation ──────────────────────────────────────────

P("## 3. Is the signal relational?");
P("");
P("The claim in `evals/FINDINGS.md` is that an utterance alone cannot be classified \u2014 the same string is an instruction at the head of a task and a correction after an edit. Same model, same pairs; the only difference is whether the judge is shown what the agent just did.");
P("");
P("Two blind arms, because the obvious objection to a single one is real. `blind (naive)` reuses the sighted system prompt verbatim, and that prompt opens by telling the judge it will be shown the agent\u2019s last turn \u2014 which in this arm it is not. `blind (fair)` changes exactly that one framing paragraph and nothing else. **The fair arm is the headline control**; the difference between the two is how much of the gap was prompt mismatch rather than missing information.");
P("");
const cSighted = confusion(b4, truth);
const cFair = confusion(b6, truth);
const cNaive = confusion(b6n, truth);
{
  const kS = cohensKappa(prodLabels, refLabels);
  const kF = cohensKappa(fairLabels, refLabels);
  const kN = cohensKappa(blindLabels, refLabels);
  const agree = (ls: string[]) => ls.filter((x, i) => x === refLabels[i]).length / evalRows.length;
  P("| arm | precision | recall | F1 | 7-way agreement | kappa |");
  P("|---|---|---|---:|---:|---:|");
  P(
    `| judge **with** prior turn | ${pctCI(bootstrapCI(b4, truth, precision))} | ${pctCI(bootstrapCI(b4, truth, recall))} | ${pct(f1(cSighted))} | ${pct(agree(prodLabels))} | ${kS.kappa.toFixed(3)} |`,
  );
  P(
    `| **blind (fair)** | ${pctCI(bootstrapCI(b6, truth, precision))} | ${pctCI(bootstrapCI(b6, truth, recall))} | **${pct(f1(cFair))}** | ${pct(agree(fairLabels))} | ${kF.kappa.toFixed(3)} |`,
  );
  P(
    `| blind (naive) | ${pctCI(bootstrapCI(b6n, truth, precision))} | ${pctCI(bootstrapCI(b6n, truth, recall))} | ${pct(f1(cNaive))} | ${pct(agree(blindLabels))} | ${kN.kappa.toFixed(3)} |`,
  );
  P("");
  const dFair = f1(cSighted) - f1(cFair);
  const dNaive = f1(cSighted) - f1(cNaive);
  P(
    `Hiding the prior turn costs **${(dFair * 100).toFixed(1)} points of F1** and **${((recall(cSighted) - recall(cFair)) * 100).toFixed(1)} points of recall** against the fair control (kappa ${kF.kappa.toFixed(3)} to ${kS.kappa.toFixed(3)}).`,
  );
  P("");
  P(
    `The naive arm reads ${(dNaive * 100).toFixed(1)} points, so **${((dNaive - dFair) * 100).toFixed(1)} of them were prompt mismatch, not missing information** \u2014 a real objection, settled by running the control rather than by arguing about it. The two blind arms disagree on ${blindLabels.filter((x, i) => x !== fairLabels[i]).length} of ${evalRows.length} pairs.`,
  );
  P("");
  const flips = evalRows.map((_, i) => i).filter((i) => b4[i] !== b6[i]);
  P(
    `Of ${flips.length} pairs where the sighted and fair-blind judges disagree, the blind judge misses ${flips.filter((i) => !(b6[i] as boolean) && truth[i]).length} true pushbacks and invents ${flips.filter((i) => (b6[i] as boolean) && !truth[i]).length} false ones. The loss is almost entirely recall: without context the judge retreats to instruction.`,
  );
  P("");
}

// ─── Gate analysis ────────────────────────────────────────────────────

P("## 4. What the structural gate costs and buys");
P("");
{
  const hardFail = evalRows.filter((r) => !r.gate.pass);
  const lostPushbacks = hardFail.filter((r) => isPushback((ref.get(r.pairId) as LabelRow).verdict.label));
  const openers = hardFail.filter((r) => r.gate.reason === "session_opener").length;
  const consecutive = hardFail.length - openers;
  P(
    `The hard gate rejects **${hardFail.length}/${evalRows.length}** pairs (${pct(hardFail.length / evalRows.length)}) on ONE structural ground: no prior assistant turn. An earlier version advertised two, adding \`session_opener\`, but that branch was unreachable — a session's first prompt has no prior turn by construction. The single rule covers two populations worth separating: **${openers} session openers**, which cannot be reactions to anything, and **${consecutive} mid-session consecutive user messages**, which can be — a correction can target work from two turns back, and this gate structurally cannot see it.`,
  );
  P("");
  P(
    `Of those, **${lostPushbacks.length}** are labelled pushback by the reference judge — a permanent recall ceiling of **${pct(1 - lostPushbacks.length / nPos)}** for anything downstream of the gate.`,
  );
  if (lostPushbacks.length) {
    P("");
    P("Examples of what the gate throws away:");
    P("");
    for (const r of lostPushbacks.slice(0, 3)) {
      const v = (ref.get(r.pairId) as LabelRow).verdict;
      P(`- \`${r.gate.reason}\` · **${v.label}** · ${JSON.stringify(r.prompt.slice(0, 110))}`);
    }
  }
  P("");
  const curve = prCurve(gateScores, truth);
  const ap = averagePrecision(gateScores, truth);
  P(`Structural score alone, swept over every operating point: **AP = ${ap.toFixed(3)}** (baseline = prevalence ${(nPos / evalRows.length).toFixed(3)}).`);
  P("");
  P("| gate θ | predicted + | precision | recall | F1 |");
  P("|---:|---:|---:|---:|---:|");
  for (const t of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    const pred = gateScores.map((s) => s >= t);
    const c = confusion(pred, truth);
    P(`| ${t.toFixed(2)} | ${c.tp + c.fp} | ${pct(precision(c))} | ${pct(recall(c))} | ${pct(f1(c))} |`);
  }
  P("");
}

// ─── Cascade frontier ─────────────────────────────────────────────────

P("## 5. Cascade cost/recall frontier");
P("");
P("Every row is the same judge; only the gate threshold in front of it changes. `judge calls` is what you pay for.");
P("");
P("| gate θ | judge calls | calls / 100 prompts | precision | recall | F1 | F0.5 |");
P("|---:|---:|---:|---:|---:|---:|---:|");
for (const v of cascadeVariants) {
  const c = confusion(v.pred, truth);
  P(
    `| ${v.theta.toFixed(2)} | ${v.judgeCalls} | ${((v.judgeCalls / evalRows.length) * 100).toFixed(0)} | ${pct(precision(c))} | ${pct(recall(c))} | ${pct(f1(c))} | ${pct(fbeta(c, 0.5))} |`,
  );
}
P("");

// ─── Per-language slices ──────────────────────────────────────────────

P("## 6. Per-script slices");
P("");
P("| script | n | pushback rate | B0 recall | B1 recall | B2 recall | B5 recall |");
P("|---|---:|---:|---:|---:|---:|---:|");
for (const s of ["ko", "mixed", "latin", "cjk"]) {
  const idx = evalRows.map((r, i) => (r.script === s ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) continue;
  const t = idx.map((i) => truth[i] as boolean);
  const rec = (p: boolean[]) => {
    const c = confusion(
      idx.map((i) => p[i] as boolean),
      t,
    );
    return c.tp + c.fn === 0 ? "—" : pct(recall(c));
  };
  const b5 = (cascadeVariants.find((v) => v.theta === 0.3) as any).pred as boolean[];
  P(
    `| ${s} | ${idx.length} | ${pct(t.filter(Boolean).length / idx.length)} | ${rec(b0)} | ${rec(b1)} | ${rec(b2)} | ${rec(b5)} |`,
  );
}
P("");

// ─── Multiclass ───────────────────────────────────────────────────────

P("## 7. Seven-way classification (Haiku judge vs reference)");
P("");
{
  const m = macroF1(prodLabels, refLabels, LABELS as unknown as string[]);
  P("| label | precision | recall | F1 | support |");
  P("|---|---:|---:|---:|---:|");
  for (const l of LABELS) {
    const s = m.perClass[l];
    if (!s || s.support === 0) continue;
    P(`| ${l} | ${pct(s.p)} | ${pct(s.r)} | ${pct(s.f1)} | ${s.support} |`);
  }
  P(`| **macro** | | | **${pct(m.macro)}** | ${evalRows.length} |`);
  P("");
}

// ─── Headroom ─────────────────────────────────────────────────────────

P("## 8. Headroom left by the hand-set priors");
P("");
{
  const X = evalRows.map((r) => featureVector(r.features));
  const { oof } = crossValPredict(X, truth, 5);
  const apHand = averagePrecision(gateScores, truth);
  const apFit = averagePrecision(oof, truth);
  P(
    `Structural features only. Hand priors **AP = ${apHand.toFixed(3)}**; 5-fold cross-validated logistic fit on the same features **AP = ${apFit.toFixed(3)}**.`,
  );
  P("");
  const full = fitLogistic(X, truth);
  const ranked = FEATURE_NAMES.map((n, i) => ({ n, w: full.weights[i] as number })).sort(
    (a, b) => Math.abs(b.w) - Math.abs(a.w),
  );
  P("Fitted weights, largest magnitude first (in-sample, for direction only — do not read these as the shipped model):");
  P("");
  P("| feature | weight |");
  P("|---|---:|");
  for (const { n, w } of ranked) P(`| ${n} | ${w >= 0 ? "+" : ""}${w.toFixed(3)} |`);
  P("");
}

// ─── Cost ─────────────────────────────────────────────────────────────

P("## 9. Measured cost");
P("");
{
  // Same deduped rows every other number uses. Iterating raw `labelRows` here
  // counted retries and superseded verdicts — it reported n=1327 against an
  // 836-pair corpus and understated the reference run's per-call cost by 7.7%,
  // and that per-call figure feeds the "$ per 100 prompts" headline.
  const evalIdSet = new Set(evalRows.map((r) => r.pairId));
  const dedupedRows: LabelRow[] = [];
  for (const m of byRun.values()) {
    for (const [id, r] of m) if (evalIdSet.has(id)) dedupedRows.push(r);
  }
  const perRun: Record<string, { n: number; usd: number; ms: number; cacheHit: number }> = {};
  for (const r of dedupedRows) {
    const k = r.run;
    perRun[k] ??= { n: 0, usd: 0, ms: 0, cacheHit: 0 };
    const e = perRun[k] as any;
    e.n++;
    e.usd += costUSD(r.model, {
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheCreation1hTokens: r.cacheCreationTokens,
    });
    e.ms += r.latencyMs;
    if (r.cacheReadTokens > 0) e.cacheHit++;
  }
  P("| run | model | n | total | per call | median-ish latency | cache hit |");
  P("|---|---|---:|---:|---:|---:|---:|");
  for (const [k, v] of Object.entries(perRun)) {
    const model = labelRows.find((r) => r.run === k)?.model ?? "?";
    P(
      `| ${k} | ${model} | ${v.n} | $${v.usd.toFixed(2)} | $${(v.usd / v.n).toFixed(5)} | ${Math.round(v.ms / v.n)} ms | ${pct(v.cacheHit / v.n)} |`,
    );
  }
  P("");
  const prodPer = (perRun["prod"]?.usd ?? 0) / Math.max(1, perRun["prod"]?.n ?? 1);
  for (const theta of [0.3, 0.5]) {
    const v = cascadeVariants.find((x) => x.theta === theta) as any;
    const per100 = (v.judgeCalls / evalRows.length) * 100;
    P(
      `Cascade at θ=${theta.toFixed(2)}: **${per100.toFixed(0)} judge calls per 100 prompts** × $${prodPer.toFixed(5)} = **$${((per100 * prodPer) / 100 * 100).toFixed(4)} per 100 prompts**.`,
    );
  }
  P("");
}

// ─── Session-level fire behaviour ─────────────────────────────────────

P("## 10. Session-level behaviour");
P("");
{
  const sessions = new Map<string, { pushbacks: number; prompts: number; b0: number; b5: number }>();
  const b5 = (cascadeVariants.find((v) => v.theta === 0.3) as any).pred as boolean[];
  evalRows.forEach((r, i) => {
    const s = sessions.get(r.sessionId) ?? { pushbacks: 0, prompts: 0, b0: 0, b5: 0 };
    s.prompts++;
    if (truth[i]) s.pushbacks++;
    if (b0[i]) s.b0++;
    if (b5[i]) s.b5++;
    sessions.set(r.sessionId, s);
  });
  const arr = [...sessions.values()];
  const withPush = arr.filter((s) => s.pushbacks > 0).length;
  P(`| | sessions | share |`);
  P(`|---|---:|---:|`);
  P(`| total (in evaluation set) | ${arr.length} | |`);
  P(`| containing ≥1 true pushback | ${withPush} | ${pct(withPush / arr.length)} |`);
  P(`| where **B0 (shipped)** detects ≥1 | ${arr.filter((s) => s.b0 > 0).length} | ${pct(arr.filter((s) => s.b0 > 0).length / arr.length)} |`);
  P(`| where **B5 (cascade)** detects ≥1 | ${arr.filter((s) => s.b5 > 0).length} | ${pct(arr.filter((s) => s.b5 > 0).length / arr.length)} |`);
  P("");
}

// ─── 11. Adversarial-review follow-ups ────────────────────────────────
//
// Everything below was added after an adversarial review of the first pass.
// Each subsection answers one objection that, left unanswered, would have made
// a headline number mean less than it appeared to.

P("## 11. What survives an adversarial review");
P("");

// 11a — the format placebo
P("### 11a. Is the sighted arm gaining information, or just format?");
P("");
if (!HAS_SHUFFLED) {
  P("> `shuffled` run not present. Run `npx tsx bench/label.ts --runs shuffled` to fill this in.");
  P("");
} else {
  const bShuf = shuffledLabels.map((l) => isPushback(l as Label));
  const cShuf = confusion(bShuf, truth);
  const cS = confusion(b4, truth);
  const cF = confusion(b6, truth);
  P(
    "The sighted arm could be scoring higher merely because its prompt has a filled-in context block, independent of what that block says. The control: keep the rendering identical and give every pair **another pair's** prior turn.",
  );
  P("");
  P("| arm | prior turn shown | precision | recall | F1 |");
  P("|---|---|---|---|---:|");
  P(`| sighted | its own | ${pct(precision(cS))} | ${pct(recall(cS))} | **${pct(f1(cS))}** |`);
  P(`| **shuffled** | **another pair's** | ${pct(precision(cShuf))} | ${pct(recall(cShuf))} | **${pct(f1(cShuf))}** |`);
  P(`| blind (fair) | none | ${pct(precision(cF))} | ${pct(recall(cF))} | **${pct(f1(cF))}** |`);
  P("");
  const dShuf = f1(cS) - f1(cShuf);
  const dFair = f1(cS) - f1(cF);
  const share = dFair === 0 ? 0 : dShuf / dFair;
  P(
    `Destroying the information while keeping the format costs **${(dShuf * 100).toFixed(1)} F1 points** — ${(share * 100).toFixed(0)}% of the ${(dFair * 100).toFixed(1)} points that removing the block entirely costs.`,
  );
  P("");
  P(
    share > 0.6
      ? "**The effect is informational.** A context block that is present but wrong is nearly as bad as no context block, which is what an informational mechanism predicts and a format artefact does not."
      : share < 0.25
        ? "**The effect is largely format.** A wrong context block scores close to the right one, so most of the sighted arm's advantage came from the shape of its prompt rather than its content. The relational claim does not survive in the form it was stated."
        : "**Mixed.** A wrong context block recovers a substantial part of the gap, so the sighted arm's advantage is partly informational and partly format. State both numbers; do not quote the blind gap alone.",
  );
  P("");
}

// 11b — the abstention channel
P("### 11b. The rubric's abstention channel fires on a condition the ablation manufactures");
P("");
{
  const countOther = (ls: string[]) => ls.filter((x) => x === "other").length;
  P("| arm | `other` predictions |");
  P("|---|---:|");
  P(`| reference | ${countOther(refLabels)} |`);
  P(`| sighted | ${countOther(prodLabels)} |`);
  P(`| blind (fair) | ${countOther(fairLabels)} |`);
  P(`| blind (naive) | ${countOther(blindLabels)} |`);
  P("");
  P(
    "`JUDGE_SYSTEM` instructs the judge to answer `other` or low confidence when the shown context is too thin to decide. In the blind arms that condition is true by construction, so part of the measured loss is the rubric doing what it was told rather than the judge failing to see a correction.",
  );
  P("");
  const keep = evalRows
    .map((_, i) => i)
    .filter((i) => prodLabels[i] !== "other" && fairLabels[i] !== "other");
  const sub = (pred: boolean[]) => confusion(keep.map((i) => pred[i] as boolean), keep.map((i) => truth[i] as boolean));
  const cS2 = sub(b4);
  const cF2 = sub(b6);
  P(
    `Excluding every row where either arm answered \`other\` (n=${keep.length}): sighted F1 ${pct(f1(cS2))}, blind F1 ${pct(f1(cF2))}, gap **${((f1(cS2) - f1(cF2)) * 100).toFixed(1)} points** versus ${((f1(confusion(b4, truth)) - f1(confusion(b6, truth))) * 100).toFixed(1)} on the full set.`,
  );
  P("");
}

// 11c — stratify the ablation by how much the prior turn actually contains
P("### 11c. Does the gap scale with how much the prior turn contains?");
P("");
{
  const strata: Array<[string, (i: number) => boolean]> = [
    ["prior turn absent (sighted learns nothing)", (i) => !(evalRows[i] as Row).prior],
    [
      "prior present, 0 tool calls",
      (i) => !!(evalRows[i] as Row).prior && (evalRows[i] as Row).features.priorToolCount === 0,
    ],
    [
      "prior present, >=1 tool call",
      (i) => !!(evalRows[i] as Row).prior && (evalRows[i] as Row).features.priorToolCount > 0,
    ],
  ];
  P("| stratum | n | sighted F1 | blind F1 | ΔF1 | sighted agree | blind agree | Δagree |");
  P("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const [name, sel] of strata) {
    const idx = evalRows.map((_, i) => i).filter(sel);
    if (idx.length === 0) continue;
    const t = idx.map((i) => truth[i] as boolean);
    const cS = confusion(idx.map((i) => b4[i] as boolean), t);
    const cB = confusion(idx.map((i) => b6[i] as boolean), t);
    const agS = idx.filter((i) => prodLabels[i] === refLabels[i]).length / idx.length;
    const agB = idx.filter((i) => fairLabels[i] === refLabels[i]).length / idx.length;
    P(
      `| ${name} | ${idx.length} | ${pct(f1(cS))} | ${pct(f1(cB))} | ${((f1(cS) - f1(cB)) * 100).toFixed(1)} | ${pct(agS)} | ${pct(agB)} | ${((agS - agB) * 100).toFixed(1)} |`,
    );
  }
  P("");
  P(
    "**The first row is not the null case it looks like.** Where the prior turn is absent the sighted arm is shown one sentence — *\"the agent has not spoken yet in this session\"* — and that sentence is itself information: it identifies a session opener, which is overwhelmingly an instruction. So the blind ablation removes two things at once, the *content* of the prior turn and the *knowledge that there was one*, and this stratum isolates the second.",
  );
  P("");
  P(
    "That is why the shuffled arm in 11a, not the blind arm, is the control that settles the relational claim: it always has a prior-turn block, so the knowledge-of-existence channel is held constant and only the content changes.",
  );
  P("");
  P(
    "Two further readings. Agreement and κ are **dropped as evidence** here — the sighted arm shares an input rendering with the reference annotator, so part of any agreement gap is format, and F1 against the reference is reported instead. And the ΔF1 is nearly flat between prior turns with no tool calls and prior turns with several, which says the useful signal is largely the agent's **prose**, not its **actions** — an uncomfortable result for Stage A, which encodes only actions.",
  );
  P("");
}

// 11d — paired, session-clustered interval on the ablation delta
P("### 11d. Is the ablation gap distinguishable from zero?");
P("");
{
  const groups = evalRows.map((r) => r.sessionId);
  const iid = pairedDeltaCI(b4, b6, truth, f1, { iters: 2000 });
  const clustered = pairedDeltaCI(b4, b6, truth, f1, { iters: 2000, groups });
  P("| resampling | ΔF1 | 95% interval | P(Δ ≤ 0) |");
  P("|---|---:|---|---:|");
  P(`| rows i.i.d. | ${(iid.point * 100).toFixed(1)} | [${(iid.lo * 100).toFixed(1)}, ${(iid.hi * 100).toFixed(1)}] | ${iid.pLeZero.toFixed(3)} |`);
  P(
    `| clustered by session | ${(clustered.point * 100).toFixed(1)} | [${(clustered.lo * 100).toFixed(1)}, ${(clustered.hi * 100).toFixed(1)}] | ${clustered.pLeZero.toFixed(3)} |`,
  );
  P("");
  P(
    "Turns within a session are not independent draws, so the clustered interval is the honest one. The point estimate should be quoted with its interval, never alone.",
  );
  P("");
}

// 11e — the corpus is mostly not coding traffic
P("### 11e. Restricting to the traffic reflect actually targets");
P("");
{
  const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|c|h|cpp|cs|swift|sh|ps1|sql|css|scss|html|vue|svelte|json|ya?ml|toml)$/i;
  const isCoding = (r: Row) =>
    !!r.prior &&
    (r.prior.toolCalls ?? []).some((c: any) => CODE.test(String(c.target).split(/[\s"']/)[0] ?? ""));
  const idx = evalRows.map((_, i) => i).filter((i) => isCoding(evalRows[i] as Row));
  const t = idx.map((i) => truth[i] as boolean);
  const sub = (pred: boolean[]) => confusion(idx.map((i) => pred[i] as boolean), t);
  const gateRejects = idx.filter((i) => !(evalRows[i] as Row).gate.pass).length;
  const b5at3 = (cascadeVariants.find((v) => v.theta === 0.3) as any).pred as boolean[];
  const calls = idx.filter(
    (i) => (evalRows[i] as Row).gate.pass && (gateScores[i] as number) >= 0.3,
  ).length;
  const c5 = sub(b5at3);
  P(
    `Only **${idx.length} of ${evalRows.length}** evaluated turns (${pct(idx.length / evalRows.length)}) follow a turn in which the agent touched a code-like file. The rest are résumé editing, interview preparation, research and business writing — real Claude Code sessions, but not what a coding-agent correction detector is aimed at.`,
  );
  P("");
  P("| corpus | n | pushback rate | gate discards | judge calls / 100 | B5 precision | B5 recall |");
  P("|---|---:|---:|---:|---:|---:|---:|");
  const allCalls = (cascadeVariants.find((v) => v.theta === 0.3) as any).judgeCalls as number;
  const d0 = evalRows.filter((r) => !r.gate.pass).length;
  P(
    `| full | ${evalRows.length} | ${pct(nPos / evalRows.length)} | ${pct(d0 / evalRows.length)} | ${Math.round((allCalls / evalRows.length) * 100)} | ${pct(precision(confusion(b5at3, truth)))} | ${pct(recall(confusion(b5at3, truth)))} |`,
  );
  P(
    `| **prior touched code** | ${idx.length} | **${pct(t.filter(Boolean).length / idx.length)}** | ${pct(gateRejects / idx.length)} | **${Math.round((calls / idx.length) * 100)}** | ${pct(precision(c5))} | ${pct(recall(c5))} |`,
  );
  P("");
  P(
    `On coding turns the pushback rate is **${pct(t.filter(Boolean).length / idx.length)}**, close to SWE-chat's 39% and far from the ${pct(nPos / evalRows.length)} headline. The §9 explanation — "this developer writes long specifications" — is therefore mostly wrong: the gap is corpus composition. And the cascade's cost advantage largely disappears, because turns that follow code edits are exactly the turns the gate cannot discard.`,
  );
  P("");
}

// 11f — duplicates and effective n
P("### 11f. Effective sample size");
P("");
{
  const counts = new Map<string, number>();
  for (const r of evalRows) counts.set(r.prompt, (counts.get(r.prompt) ?? 0) + 1);
  const dupRows = [...counts.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);
  const distinct = counts.size;
  const largest = Math.max(...counts.values());
  const largestPrompt = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  P(
    `${evalRows.length} rows contain **${distinct} distinct prompts**. ${dupRows} rows (${pct(dupRows / evalRows.length)}) are exact duplicates of another row; the largest group is ${largest} identical prompts across different sessions.`,
  );
  P("");
  P(
    `The biggest offender is an automated health-check ping (${JSON.stringify(largestPrompt.slice(0, 60))}...), which is not user pushback in any sense and inflates the negative class.`,
  );
  P("");
  const seen = new Set<string>();
  const uniqIdx = evalRows.map((_, i) => i).filter((i) => {
    const k = (evalRows[i] as Row).prompt;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const tu = uniqIdx.map((i) => truth[i] as boolean);
  const su = (pred: boolean[]) => confusion(uniqIdx.map((i) => pred[i] as boolean), tu);
  const b5at3 = (cascadeVariants.find((v) => v.theta === 0.3) as any).pred as boolean[];
  P("| corpus | n | pushback rate | B5 precision | B5 recall | ΔF1 (ablation) |");
  P("|---|---:|---:|---:|---:|---:|");
  P(
    `| all rows | ${evalRows.length} | ${pct(nPos / evalRows.length)} | ${pct(precision(confusion(b5at3, truth)))} | ${pct(recall(confusion(b5at3, truth)))} | ${((f1(confusion(b4, truth)) - f1(confusion(b6, truth))) * 100).toFixed(1)} |`,
  );
  P(
    `| distinct prompts | ${uniqIdx.length} | ${pct(tu.filter(Boolean).length / uniqIdx.length)} | ${pct(precision(su(b5at3)))} | ${pct(recall(su(b5at3)))} | ${((f1(su(b4)) - f1(su(b6))) * 100).toFixed(1)} |`,
  );
  P("");
}

// 11g — headroom, done properly
P("### 11g. Headroom, recomputed");
P("");
{
  const Xhand = evalRows.map((r) => featureVector(r.features));
  const Xext = evalRows.map((r) => extendedFeatureVector(r.features));
  const cvHand = crossValPredict(Xhand, truth, 5);
  const cvExt = crossValPredict(Xext, truth, 5);
  const apHand = averagePrecision(gateScores, truth);
  const apFitHand = averagePrecision(cvHand.oof, truth);
  const apFitExt = averagePrecision(cvExt.oof, truth);
  const single = evalRows.map((r) => (r.features.priorMutationCount > 0 ? 1 : 0));
  const apSingle = averagePrecision(single, truth);

  P("Three corrections to the first pass, all pushing the same comparison in the same direction:");
  P("");
  P("1. The hand model has **10** terms; the earlier fit was given **13**. Like-for-like now uses 10, with the 13-input fit reported separately.");
  P("2. `averagePrecision` was tie-blind, and only the hand score has ties — 265 rows sit at exactly 0. It is now tie-aware, which is order-independent.");
  P("3. `fitLogistic` had not converged at its 3,000-iteration default. It now runs to a step-size tolerance and reports whether it got there.");
  P("");
  P("| model | inputs | AP | converged |");
  P("|---|---:|---:|:--:|");
  P(`| hand priors | 10 | ${apHand.toFixed(3)} | — |`);
  P(`| **`+"`priorMutation > 0`"+` alone** | **1** | **${apSingle.toFixed(3)}** | — |`);
  P(`| CV logistic, same inputs | 10 | ${apFitHand.toFixed(3)} | ${cvHand.allConverged ? "yes" : "**no**"} |`);
  P(`| CV logistic, three more inputs | 13 | ${apFitExt.toFixed(3)} | ${cvExt.allConverged ? "yes" : "**no**"} |`);
  P(`| chance | — | ${(nPos / evalRows.length).toFixed(3)} | — |`);
  P("");
  P(
    apSingle >= apHand - 0.005
      ? `**A single binary feature matches or beats the whole hand-designed scorer** (${apSingle.toFixed(3)} vs ${apHand.toFixed(3)}). The other nine terms and their weights are, on this corpus, decoration. That strengthens the headroom argument and destroys the artefact the argument was about — the gate should be re-derived, not re-weighted.`
      : `The hand scorer beats its strongest single feature by ${(apHand - apSingle).toFixed(3)} AP, so the additional terms are doing something — but the fitted model still beats both.`,
  );
  P("");
  const full = fitLogistic(Xhand, truth);
  P(
    `Converged fit: ${full.iterations.toLocaleString()} iterations, ${full.converged ? "tolerance reached" : "**cap hit — not converged**"}.`,
  );
  P("");
  P("| feature | hand prior | converged fit | agrees? |");
  P("|---|---:|---:|:--:|");
  const HAND: Record<string, number> = {
    priorMutation: 1.1, priorError: 0.6, refPriorTarget: 0.9, refThrashTarget: 0.45,
    fastReply: 0.35, staleGap: -0.4, longPrompt: -1.3, mediumPrompt: -0.55,
    looksPasted: -0.7, silentPrior: -0.5,
  };
  FEATURE_NAMES.forEach((n, i) => {
    const w = full.weights[i] as number;
    const h = HAND[n] as number;
    const same = Math.sign(w) === Math.sign(h);
    P(`| ${n} | ${h >= 0 ? "+" : ""}${h.toFixed(2)} | ${w >= 0 ? "+" : ""}${w.toFixed(3)} | ${same ? "yes" : "**no**"} |`);
  });
  P("");
  const flipped = FEATURE_NAMES.filter(
    (n, i) => Math.sign(full.weights[i] as number) !== Math.sign(HAND[n] as number),
  );
  P(
    `${flipped.length} of ${FEATURE_NAMES.length} priors disagree in sign with the converged fit: ${flipped.map((f) => "`" + f + "`").join(", ") || "none"}. The earlier report named a different set, because it read an unconverged optimiser — a reminder that "the direction of a weight" is only meaningful once the optimiser has stopped moving.`,
  );
  P("");
}

// ─── Emit ─────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const curve = prCurve(gateScores, truth);
const machine = {
  generatedAt: new Date().toISOString(),
  corpus: {
    pairsExtracted: rows.length,
    evaluated: evalRows.length,
    sessions: new Set(evalRows.map((r) => r.sessionId)).size,
    pushback: nPos,
    pushbackRate: nPos / evalRows.length,
    scripts: Object.fromEntries(
      ["ko", "mixed", "latin", "cjk"].map((s) => [s, evalRows.filter((r) => r.script === s).length]),
    ),
  },
  refLabelDistribution: Object.fromEntries(
    LABELS.map((l) => [l, refLabels.filter((x) => x === l).length]),
  ),
  baselines: [
    ...results.map((r) => {
      const c = confusion(r.pred, truth);
      return {
        id: r.id,
        name: r.name,
        note: r.note,
        ...c,
        precision: precision(c),
        recall: recall(c),
        f1: f1(c),
        f05: fbeta(c, 0.5),
        judgeCallRate: r.judgeCalls / evalRows.length,
      };
    }),
    ...cascadeVariants.map((v) => {
      const c = confusion(v.pred, truth);
      return {
        id: "B5",
        name: `cascade gate>=${v.theta.toFixed(2)}`,
        note: "the proposal",
        theta: v.theta,
        ...c,
        precision: precision(c),
        recall: recall(c),
        f1: f1(c),
        f05: fbeta(c, 0.5),
        judgeCallRate: v.judgeCalls / evalRows.length,
      };
    }),
  ],
  gateCurve: curve.map((p) => ({
    threshold: Number(p.threshold.toFixed(4)),
    precision: Number(p.precision.toFixed(4)),
    recall: Number(p.recall.toFixed(4)),
    f1: Number(p.f1.toFixed(4)),
    predictedPositive: p.predictedPositive,
  })),
  gateAP: averagePrecision(gateScores, truth),
  agreement: {
    prodVsRef: cohensKappa(prodLabels, refLabels),
    blindVsRef: cohensKappa(fairLabels, refLabels),
    blindNaiveVsRef: cohensKappa(blindLabels, refLabels),
  },
  perScript: ["ko", "mixed", "latin", "cjk"]
    .map((s) => {
      const idx = evalRows.map((r, i) => (r.script === s ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return null;
      const t = idx.map((i) => truth[i] as boolean);
      const rec = (p: boolean[]) => {
        const c = confusion(
          idx.map((i) => p[i] as boolean),
          t,
        );
        return c.tp + c.fn === 0 ? null : recall(c);
      };
      const b5at3 = (cascadeVariants.find((v) => v.theta === 0.3) as any).pred as boolean[];
      return {
        script: s,
        n: idx.length,
        pushbackRate: t.filter(Boolean).length / idx.length,
        recallB0: rec(b0),
        recallB1: rec(b1),
        recallB2: rec(b2),
        recallB5: rec(b5at3),
      };
    })
    .filter(Boolean),

  // 7x7 confusion, reference (rows) vs production judge (columns).
  confusion7: {
    classes: [...LABELS],
    matrix: LABELS.map((rowCls) =>
      LABELS.map(
        (colCls) =>
          refLabels.filter((r, i) => r === rowCls && prodLabels[i] === colCls).length,
      ),
    ),
  },

  perClass: (() => {
    const m = macroF1(prodLabels, refLabels, LABELS as unknown as string[]);
    return {
      macro: m.macro,
      classes: LABELS.map((l) => ({ label: l, ...(m.perClass[l] as any) })),
    };
  })(),

  ablation: (() => {
    const cS = confusion(b4, truth);
    const cB = confusion(b6, truth);
    const cN = confusion(b6n, truth);
    const flips = evalRows.map((_, i) => i).filter((i) => b4[i] !== b6[i]);
    const agree = (ls: string[]) =>
      ls.filter((x, i) => x === refLabels[i]).length / evalRows.length;
    return {
      sighted: { precision: precision(cS), recall: recall(cS), f1: f1(cS), ...cS },
      blind: { precision: precision(cB), recall: recall(cB), f1: f1(cB), ...cB },
      blindNaive: { precision: precision(cN), recall: recall(cN), f1: f1(cN), ...cN },
      agreementSighted: agree(prodLabels),
      agreementBlind: agree(fairLabels),
      agreementBlindNaive: agree(blindLabels),
      promptMismatchF1Points: f1(cB) - f1(cN),
      blindArmsDisagree: blindLabels.filter((x, i) => x !== fairLabels[i]).length,
      disagreeCount: flips.length,
      blindInventedFP: flips.filter((i) => (b6[i] as boolean) && !truth[i]).length,
      blindMissedTP: flips.filter((i) => !(b6[i] as boolean) && truth[i]).length,
    };
  })(),

  shuffledAblation: HAS_SHUFFLED
    ? (() => {
        const bShuf = shuffledLabels.map((l) => isPushback(l as Label));
        const c = confusion(bShuf, truth);
        const cS = confusion(b4, truth);
        const cF = confusion(b6, truth);
        return {
          ...c,
          precision: precision(c),
          recall: recall(c),
          f1: f1(c),
          f1DropVsSighted: f1(cS) - f1(c),
          f1DropOfFullBlind: f1(cS) - f1(cF),
          /** How much of the blind gap a wrong-but-present context reproduces. */
          shareOfBlindGap: f1(cS) - f1(cF) === 0 ? 0 : (f1(cS) - f1(c)) / (f1(cS) - f1(cF)),
        };
      })()
    : null,

  gate: (() => {
    const hardFail = evalRows.filter((r) => !r.gate.pass);
    const lost = hardFail.filter((r) =>
      isPushback((ref.get(r.pairId) as LabelRow).verdict.label),
    );
    return {
      rejected: hardFail.length,
      rejectedShare: hardFail.length / evalRows.length,
      pushbacksLost: lost.length,
      recallCeiling: 1 - lost.length / nPos,
      sweep: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((t) => {
        const c = confusion(
          gateScores.map((s) => s >= t),
          truth,
        );
        return { theta: t, precision: precision(c), recall: recall(c), f1: f1(c), predicted: c.tp + c.fp };
      }),
    };
  })(),

  headroom: (() => {
    const X = evalRows.map((r) => featureVector(r.features));
    const { oof } = crossValPredict(X, truth, 5);
    const full = fitLogistic(X, truth);
    return {
      handAP: averagePrecision(gateScores, truth),
      fittedAP: averagePrecision(oof, truth),
      weights: FEATURE_NAMES.map((n, i) => ({ feature: n, weight: full.weights[i] as number })),
    };
  })(),

  costs: (() => {
    // Cost must be computed over the SAME deduped rows every other number
    // uses. Iterating raw `labelRows` counted retries and superseded verdicts,
    // reporting n=1327 against an 836-pair corpus and understating the
    // reference run's per-call cost by 7.7%.
    const evalIds = new Set(evalRows.map((r) => r.pairId));
    const deduped: LabelRow[] = [];
    for (const m of byRun.values()) {
      for (const [id, r] of m) if (evalIds.has(id)) deduped.push(r);
    }
    const perRun: Record<string, { n: number; usd: number; ms: number; cacheHit: number; model: string }> = {};
    for (const r of deduped) {
      perRun[r.run] ??= { n: 0, usd: 0, ms: 0, cacheHit: 0, model: r.model };
      const e = perRun[r.run] as any;
      e.n++;
      e.usd += costUSD(r.model, {
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheCreation1hTokens: r.cacheCreationTokens,
      });
      e.ms += r.latencyMs;
      if (r.cacheReadTokens > 0) e.cacheHit++;
    }
    return Object.entries(perRun).map(([run, v]) => ({
      run,
      model: v.model,
      n: v.n,
      totalUSD: v.usd,
      perCallUSD: v.usd / v.n,
      avgLatencyMs: Math.round(v.ms / v.n),
      cacheHitRate: v.cacheHit / v.n,
    }));
  })(),

  sessions: (() => {
    const map = new Map<string, { push: number; b0: number; b5: number }>();
    const b5at3 = (cascadeVariants.find((v) => v.theta === 0.3) as any).pred as boolean[];
    evalRows.forEach((r, i) => {
      const s = map.get(r.sessionId) ?? { push: 0, b0: 0, b5: 0 };
      if (truth[i]) s.push++;
      if (b0[i]) s.b0++;
      if (b5at3[i]) s.b5++;
      map.set(r.sessionId, s);
    });
    const arr = [...map.values()];
    return {
      total: arr.length,
      withPushback: arr.filter((s) => s.push > 0).length,
      detectedB0: arr.filter((s) => s.b0 > 0).length,
      detectedB5: arr.filter((s) => s.b5 > 0).length,
    };
  })(),
};

writeFileSync(join(OUT, "results.json"), JSON.stringify(machine, null, 2), "utf8");
writeFileSync(join(OUT, "report.md"), out.join("\n") + "\n", "utf8");
process.stdout.write(out.join("\n") + "\n");
process.stderr.write(`\n[score] wrote ${join(OUT, "report.md")} and results.json\n`);
