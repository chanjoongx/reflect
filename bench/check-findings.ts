// bench/check-findings.ts — assert that the prose still matches the data.
//
// Every number in bench/FINDINGS.md was hand-transcribed from a report that has
// been regenerated several times. Transcription is exactly the kind of error
// that survives review: the sentence reads fine, the arithmetic is somebody
// else's, and nothing fails. This walks a list of claims, computes each one
// from bench/results/results.json, and checks the rendered string appears in
// the document. It exits non-zero when the prose has drifted.
//
// Run: npx tsx bench/check-findings.ts

import { readFileSync } from "node:fs";

const results = JSON.parse(readFileSync("bench/results/results.json", "utf8")) as any;
const doc = readFileSync("bench/FINDINGS.md", "utf8");

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const pts1 = (x: number) => (x * 100).toFixed(1);

const base = (pred: (b: any) => boolean) => (results.baselines as any[]).find(pred);
const b0 = base((b) => b.id === "B0");
const b1 = base((b) => b.id === "B1");
const b2 = base((b) => b.id === "B2");
const b4 = base((b) => b.id === "B4");
const b6 = base((b) => b.id === "B6");
const b6n = base((b) => b.id === "B6n");
const b5 = base((b) => b.theta === 0.3);
const ab = results.ablation;
const gate = results.gate;

interface Claim {
  what: string;
  needle: string;
}

const claims: Claim[] = [
  { what: "corpus size", needle: `${results.corpus.evaluated}` },
  { what: "pushback count", needle: `${results.corpus.pushback}` },
  { what: "pushback rate", needle: pct1(results.corpus.pushbackRate) },
  { what: "B0 false negatives", needle: `| **${b0.fn}** |` },
  { what: "B1 precision", needle: pct1(b1.precision) },
  { what: "B1 recall", needle: pct1(b1.recall) },
  { what: "B2 recall", needle: pct1(b2.recall) },
  { what: "B2 precision", needle: pct1(b2.precision) },
  { what: "B4 precision", needle: pct1(b4.precision) },
  { what: "B5 precision", needle: pct1(b5.precision) },
  { what: "B5 recall", needle: pct1(b5.recall) },
  { what: "sighted F1", needle: pct1(ab.sighted.f1) },
  { what: "fair-blind F1", needle: pct1(ab.blind.f1) },
  { what: "naive-blind F1", needle: pct1(ab.blindNaive.f1) },
  { what: "gate rejections", needle: `${gate.rejected}` },
  { what: "pushbacks lost to gate", needle: `${gate.pushbacksLost}` },
  { what: "gate recall ceiling", needle: pct1(gate.recallCeiling) },
  { what: "hand-prior AP", needle: results.headroom.handAP.toFixed(3) },
  { what: "fitted AP", needle: results.headroom.fittedAP.toFixed(3) },
  {
    what: "ablation F1 delta (fair)",
    needle: pts1(ab.sighted.f1 - ab.blind.f1),
  },
  {
    what: "ablation recall delta (fair)",
    needle: pts1(ab.sighted.recall - ab.blind.recall),
  },
];

if (results.shuffledAblation) {
  claims.push({
    what: "shuffled F1",
    needle: pct1(results.shuffledAblation.f1),
  });
}

let bad = 0;
const w = (s: string, n: number) => s.padEnd(n);
console.log("checking bench/FINDINGS.md against bench/results/results.json\n");
for (const c of claims) {
  const found = doc.includes(c.needle);
  if (!found) bad++;
  console.log(`${found ? "ok   " : "DRIFT"} ${w(c.what, 30)} expected to find "${c.needle}"`);
}

console.log("");
if (bad) {
  console.log(`${bad} claim(s) not found in the document — the prose has drifted from the data.`);
  process.exit(1);
}
console.log(`all ${claims.length} checked claims appear in the document`);
