// bench/inspect.ts — human validation of the extractor. Prints pairs so a
// person can confirm the parser found real user prompts and real prior turns
// before any labelling money is spent.

import { readFileSync } from "node:fs";

const rows = readFileSync("bench/data/pairs.jsonl", "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as InspectRow);

interface InspectCall {
  name: string;
  target: string;
  mutating: boolean;
  errored: boolean;
}

interface InspectRow {
  pairId: string;
  prompt: string;
  script: string;
  gate: { pass: boolean; score: number; reason: string };
  features: {
    priorMutationCount: number;
    priorErrorCount: number;
    referencesPriorTarget: boolean;
    looksPasted: boolean;
    isSessionOpener: boolean;
    promptChars: number;
    gapSeconds: number | null;
  };
  lexicalEn: boolean;
  lexicalKo: boolean;
  prior: { textChars: number; text: string; toolCalls: InspectCall[] } | null;
}

const out: string[] = [];
const p = (s: string) => out.push(s);

p(`rows: ${rows.length}`);

function show(r: InspectRow, i: number) {
  const pr = r.prior;
  p("");
  p(
    `─── [${i}] gate=${r.gate.pass} score=${r.gate.score} reason=${r.gate.reason} lexKo=${r.lexicalKo} script=${r.script}`,
  );
  p(
    `    prior: tools=${pr ? pr.toolCalls.length : "NULL"} mut=${pr ? pr.toolCalls.filter((c) => c.mutating).length : 0} err=${pr ? pr.toolCalls.filter((c) => c.errored).length : 0} asstChars=${pr ? pr.textChars : 0} gap=${r.features.gapSeconds}`,
  );
  if (pr && pr.toolCalls.length) {
    p(
      "    calls: " +
        pr.toolCalls
          .slice(0, 8)
          .map((c) => `${c.name}(${String(c.target).slice(0, 30)})${c.mutating ? "*" : ""}${c.errored ? "!" : ""}`)
          .join(", "),
    );
  }
  if (pr && pr.text) p("    asst-tail: " + JSON.stringify(String(pr.text).slice(-170)));
  p("    PROMPT: " + JSON.stringify(String(r.prompt).slice(0, 240)));
}

p("\n########## HIGHEST STRUCTURAL SCORE ##########");
rows
  .filter((r) => r.gate.pass)
  .sort((a, b) => b.gate.score - a.gate.score)
  .slice(0, 6)
  .forEach(show);

p("\n\n########## LOWEST STRUCTURAL SCORE (gate passed) ##########");
rows
  .filter((r) => r.gate.pass)
  .sort((a, b) => a.gate.score - b.gate.score)
  .slice(0, 5)
  .forEach(show);

p("\n\n########## GATE REJECTED ##########");
rows.filter((r) => !r.gate.pass).slice(0, 5).forEach(show);

p("\n\n########## KOREAN LEXICAL HITS (first 8) ##########");
rows.filter((r) => r.lexicalKo).slice(0, 8).forEach(show);

p("\n\n########## SANITY COUNTS ##########");
const withPrior = rows.filter((r) => r.prior).length;
const withTools = rows.filter((r) => r.prior && r.prior.toolCalls.length > 0).length;
const withMut = rows.filter((r) => r.features.priorMutationCount > 0).length;
const withErr = rows.filter((r) => r.features.priorErrorCount > 0).length;
const refTarget = rows.filter((r) => r.features.referencesPriorTarget).length;
const pasted = rows.filter((r) => r.features.looksPasted).length;
const openers = rows.filter((r) => r.features.isSessionOpener).length;
p(`with prior turn      : ${withPrior} / ${rows.length}`);
p(`prior had tool calls : ${withTools}`);
p(`prior had mutations  : ${withMut}`);
p(`prior had tool errors: ${withErr}`);
p(`refs prior target    : ${refTarget}`);
p(`looks pasted         : ${pasted}`);
p(`session openers      : ${openers}`);
const lens = rows.map((r) => r.features.promptChars).sort((a, b) => a - b);
const q = (f: number) => lens[Math.floor(lens.length * f)];
p(`prompt chars p10/p50/p90/p99: ${q(0.1)} / ${q(0.5)} / ${q(0.9)} / ${q(0.99)}`);
const gaps = rows.map((r) => r.features.gapSeconds).filter((g): g is number => g !== null).sort((a, b) => a - b);
const gq = (f: number) => Math.round(gaps[Math.floor(gaps.length * f)] ?? 0);
p(`gap seconds p10/p50/p90     : ${gq(0.1)} / ${gq(0.5)} / ${gq(0.9)}`);

process.stdout.write(out.join("\n") + "\n");
