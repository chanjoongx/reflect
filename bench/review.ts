// bench/review.ts — export a human-verifiable sample of the reference labels.
//
// The reference run is a gold-PROXY: an Opus 5 annotation, not a human one.
// Every headline number inherits that. This writes a stratified sample to a
// markdown file a person can read and mark up, so the proxy can be checked
// rather than trusted — the `bench/data/review-*.md` files are the input to
// the human-agreement number the report is not allowed to claim without them.
//
// Sampling is stratified and deterministic:
//   • every disagreement between the reference and the production judge
//   • every low-confidence reference label
//   • a random draw from the confident-agreement mass, so the sample is not
//     all hard cases (which would understate agreement)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isPushback } from "../src/detect/types.js";
import { judgeFingerprint } from "../src/detect/judge.js";
import type { Label } from "../src/detect/types.js";

const DATA = "bench/data";
const N_RANDOM = 60;

interface LabelRow {
  pairId: string;
  run: string;
  fp?: string;
  verdict: { label: Label; confidence: string; evidence: string; rationale: string };
}

const pairs = new Map<string, any>();
for (const l of readFileSync(join(DATA, "pairs.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const p = JSON.parse(l);
  pairs.set(p.pairId, p);
}

// Only verdicts from the current rubric count — same filter score.ts applies.
const FP = judgeFingerprint();

const byRun = new Map<string, Map<string, LabelRow>>();
for (const l of readFileSync(join(DATA, "labels.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(l) as LabelRow;
  if (r.fp !== FP) continue; // never ask a human to review a stale rubric
  if (!byRun.has(r.run)) byRun.set(r.run, new Map());
  (byRun.get(r.run) as Map<string, LabelRow>).set(r.pairId, r);
}
const ref = byRun.get("ref") ?? new Map<string, LabelRow>();
const prod = byRun.get("prod") ?? new Map<string, LabelRow>();
const blind = byRun.get("blind") ?? new Map<string, LabelRow>();

const ids = [...ref.keys()].filter((id) => pairs.has(id)).sort();

const disagree = ids.filter(
  (id) => prod.has(id) && (prod.get(id) as LabelRow).verdict.label !== (ref.get(id) as LabelRow).verdict.label,
);
const lowConf = ids.filter(
  (id) => (ref.get(id) as LabelRow).verdict.confidence === "low" && !disagree.includes(id),
);
const rest = ids.filter((id) => !disagree.includes(id) && !lowConf.includes(id));

let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const sampled = [...rest].sort(() => rnd() - 0.5).slice(0, N_RANDOM);

function block(id: string, i: number): string {
  const p = pairs.get(id);
  const r = ref.get(id) as LabelRow;
  const pr = prod.get(id);
  const bl = blind.get(id);
  const calls = p.prior?.toolCalls ?? [];
  const mut = calls.filter((c: any) => c.mutating).length;
  const err = calls.filter((c: any) => c.errored).length;

  const lines: string[] = [];
  lines.push(`### ${i + 1}. \`${id}\``);
  lines.push("");
  lines.push(
    `| reference | production | blind | agree? |\n|---|---|---|:--:|\n| **${r.verdict.label}** (${r.verdict.confidence}) | ${pr?.verdict.label ?? "—"} | ${bl?.verdict.label ?? "—"} | ${pr && pr.verdict.label === r.verdict.label ? "yes" : "**no**"} |`,
  );
  lines.push("");
  lines.push(`*reference rationale:* ${r.verdict.rationale}`);
  lines.push("");
  lines.push(
    `**Prior turn** — ${calls.length} tool calls (${mut} modified files, ${err} errored), ${p.prior?.textChars ?? 0} chars of assistant text, gap ${p.features?.gapSeconds === null ? "—" : Math.round(p.features?.gapSeconds ?? 0) + "s"}`,
  );
  if (calls.length) {
    lines.push("");
    lines.push("```");
    for (const c of calls.slice(-6)) {
      lines.push(`${c.name}: ${String(c.target).slice(0, 90)}${c.mutating ? "  [modified]" : ""}${c.errored ? "  [error]" : ""}`);
    }
    lines.push("```");
  }
  if (p.prior?.text) {
    lines.push("");
    lines.push("> " + String(p.prior.text).slice(-320).replace(/\n/g, "\n> "));
  }
  lines.push("");
  lines.push("**User message**");
  lines.push("");
  lines.push("```");
  lines.push(String(p.prompt).slice(0, 900));
  lines.push("```");
  lines.push("");
  lines.push(
    `structural: gate=${p.gate.pass ? "pass" : p.gate.reason} score=${p.gate.score} · lexical: en=${p.lexicalEn} ko=${p.lexicalKo} · script=${p.script}`,
  );
  lines.push("");
  lines.push("**Your label:** `______________`  (correction / rejection / failure_report / instruction / question / affirmation / other)");
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

function writeSet(name: string, list: string[], intro: string) {
  const out: string[] = [];
  out.push(`# Human review — ${name}`);
  out.push("");
  out.push(intro);
  out.push("");
  out.push(
    `Fill in **Your label** for each. Then run \`npx tsx bench/agreement.ts\` to get human-vs-reference agreement and Cohen's kappa. Until that number exists, the report calls the reference a gold *proxy* and nothing stronger.`,
  );
  out.push("");
  out.push(`${list.length} items.`);
  out.push("");
  out.push("---");
  out.push("");
  list.forEach((id, i) => out.push(block(id, i)));
  const path = join(DATA, `review-${name}.md`);
  writeFileSync(path, out.join("\n"), "utf8");
  process.stderr.write(`[review] ${path} — ${list.length} items\n`);
}

mkdirSync(DATA, { recursive: true });

writeSet(
  "disagreements",
  disagree.slice(0, 80),
  "Every pair where the production judge (Haiku 4.5) and the reference judge (Opus 5) chose different labels. If the human agrees with production more often than with the reference on these, the reference is the weaker annotator and the direction of the whole comparison is wrong.",
);
writeSet(
  "low-confidence",
  lowConf.slice(0, 40),
  "Reference labels the reference judge itself marked low confidence. These are where the taxonomy is genuinely ambiguous, and where a human label is worth the most.",
);
writeSet(
  "random",
  sampled,
  "A deterministic random draw from pairs where reference and production agree at medium-or-better confidence. Included so the human-agreement estimate is not computed only on hard cases, which would understate it.",
);

const summary = {
  generatedAt: new Date().toISOString(),
  total: ids.length,
  disagreements: disagree.length,
  lowConfidence: lowConf.length,
  randomSample: sampled.length,
  refConfidence: {
    high: ids.filter((id) => (ref.get(id) as LabelRow).verdict.confidence === "high").length,
    medium: ids.filter((id) => (ref.get(id) as LabelRow).verdict.confidence === "medium").length,
    low: ids.filter((id) => (ref.get(id) as LabelRow).verdict.confidence === "low").length,
  },
  refPushbackRate:
    ids.filter((id) => isPushback((ref.get(id) as LabelRow).verdict.label)).length / Math.max(1, ids.length),
};
writeFileSync(join(DATA, "review-summary.json"), JSON.stringify(summary, null, 2), "utf8");
process.stderr.write(JSON.stringify(summary, null, 2) + "\n");
