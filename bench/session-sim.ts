// bench/session-sim.ts: session-level replay of trigger policies over cached verdicts.
//
// score.ts answers a per-turn question: is THIS prompt pushback? A user never
// experiences that number. What they experience is the trigger: did reflect
// interrupt, how often, and was it right to. This script replays each policy
// turn by turn, in session order, over verdicts that are already cached, so it
// costs nothing to run and can be re-run on every policy change.
//
// Ground truth at session level is the SAME policy driven by the reference
// labels (`ref`). A predicted fire is "supported" when the turns that tripped it
// really were pushback according to `ref`; a session "should fire" when the
// policy, fed reference labels, fires there at least once.
//
// v0.1.4 is replayed too, from tool calls and the English regex, with the
// monotonic cum_x100 >= 240 accumulator it actually shipped with.
//
// Usage:
//   npx tsx bench/session-sim.ts                   # pred run = prod (Haiku 4.5, Aug)
//   npx tsx bench/session-sim.ts --run h55         # any cached run id
//   npx tsx bench/session-sim.ts --theta 0.3       # add the soft gate threshold

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { isPushback } from "../src/detect/types.js";
import type { Label } from "../src/detect/types.js";
import { judgeFingerprint } from "../src/detect/judge.js";
import { toolTier, lexicalEn } from "../src/detect/lexical.js";
import { TRIGGER_POLICIES, type TriggerPolicy, Accumulator } from "../src/trigger/accumulator.js";

const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : dflt;
};

const DATA = arg("--data", "bench/data");
const OUT = arg("--out", "bench/results");
const PRED_RUN = arg("--run", "prod");
const THETA = Number(arg("--theta", "0"));

interface Row {
  pairId: string;
  sessionId: string;
  promptIndex: number;
  prompt: string;
  gate: { pass: boolean; score: number; reason: string };
  prior: { toolCalls: Array<{ name: string; target: string }> } | null;
}

interface LabelRow {
  pairId: string;
  run: string;
  fp?: string;
  verdict: { label: Label; confidence: "low" | "medium" | "high" };
}

function readJsonl<T>(path: string): T[] {
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* torn final line */
    }
  }
  return out;
}

const rows = readJsonl<Row>(join(DATA, "pairs.jsonl"));
const FP = judgeFingerprint();
const labels = readJsonl<LabelRow>(join(DATA, "labels.jsonl")).filter((r) => r.fp === FP);
const byRun = new Map<string, Map<string, LabelRow>>();
for (const r of labels) {
  if (!byRun.has(r.run)) byRun.set(r.run, new Map());
  (byRun.get(r.run) as Map<string, LabelRow>).set(r.pairId, r);
}
const ref = byRun.get("ref");
const pred = byRun.get(PRED_RUN);
if (!ref || !pred) {
  process.stderr.write(
    `[session-sim] missing cached verdicts for ref or '${PRED_RUN}' under rubric ${FP}. ` +
      `Runs present: ${[...byRun.keys()].join(", ") || "(none)"}\n`,
  );
  process.exit(1);
}

// Sessions in prompt order, restricted to rows both runs labelled.
const sessions = new Map<string, Row[]>();
for (const r of rows) {
  if (!ref.has(r.pairId) || !pred.has(r.pairId)) continue;
  if (!sessions.has(r.sessionId)) sessions.set(r.sessionId, []);
  (sessions.get(r.sessionId) as Row[]).push(r);
}
for (const list of sessions.values()) list.sort((a, b) => a.promptIndex - b.promptIndex);

// ─── v0.1.4 replay ────────────────────────────────────────────────────

function replayV014(list: Row[]): number {
  let cum = 0;
  let fires = 0;
  for (const r of list) {
    for (const c of r.prior?.toolCalls ?? []) {
      if (c.name !== "Bash") continue;
      const tier = toolTier("Bash", c.target);
      if (tier === 1) cum += 100;
      else if (tier === 2) cum += 70;
    }
    if (lexicalEn(r.prompt)) cum += 50;
    if (cum >= 240) {
      fires++;
      cum = 0;
    }
  }
  return fires;
}

// ─── Policy replay ────────────────────────────────────────────────────

interface Outcome {
  fires: number;
  supported: number;
  sessionsFired: Set<string>;
}

function judged(r: Row): boolean {
  return r.gate.pass && r.gate.score >= THETA;
}

function run(policy: TriggerPolicy, source: Map<string, LabelRow>, gated: boolean): Outcome {
  const out: Outcome = { fires: 0, supported: 0, sessionsFired: new Set() };
  for (const [sid, list] of sessions) {
    const acc = new Accumulator(policy);
    for (const r of list) {
      const v = source.get(r.pairId)?.verdict;
      const seen = gated ? judged(r) : r.gate.pass;
      const signal = seen && v && isPushback(v.label) ? { label: v.label, confidence: v.confidence } : null;
      const fire = acc.observe(r.pairId, signal);
      if (fire) {
        out.fires++;
        out.sessionsFired.add(sid);
        const truthHits = fire.evidence.filter((id: string) => {
          const t = ref!.get(id)?.verdict;
          return t ? isPushback(t.label) : false;
        }).length;
        if (truthHits >= Math.min(policy.k, fire.evidence.length)) out.supported++;
      }
    }
  }
  return out;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

const lines: string[] = [];
const P = (s = "") => lines.push(s);

const truthSessions = [...sessions.entries()].filter(([, l]) =>
  l.some((r) => isPushback(ref.get(r.pairId)!.verdict.label)),
).length;
let v014Fires = 0;
let v014Sessions = 0;
for (const list of sessions.values()) {
  const f = replayV014(list);
  v014Fires += f;
  if (f) v014Sessions++;
}

P(`# Session-level trigger replay`);
P();
P(`Rubric \`${FP}\` · prediction run \`${PRED_RUN}\` · gate theta ${THETA} · ` +
  `${sessions.size} sessions · ${[...sessions.values()].reduce((a, l) => a + l.length, 0)} turns · ` +
  `${truthSessions} sessions contain at least one reference pushback.`);
P();
P(`A fire is **supported** when the turns that tripped it were pushback by the reference ` +
  `labels. A session **should fire** when the same policy, fed reference labels, fires there.`);
P();
P(`| policy | fires | supported | sessions fired | should fire | session precision | session recall |`);
P(`|---|---:|---:|---:|---:|---:|---:|`);
P(`| v0.1.4 as shipped (cum_x100 >= 240) | ${v014Fires} | n/a | ${v014Sessions} | n/a | n/a | n/a |`);

const policySummaries: Record<string, unknown> = {};
const summary = {
  rubric: FP,
  predRun: PRED_RUN,
  theta: THETA,
  sessions: sessions.size,
  truthSessions,
  v014: { fires: v014Fires, sessionsFired: v014Sessions },
  policies: policySummaries,
};

for (const policy of TRIGGER_POLICIES) {
  const p = run(policy, pred, true);
  const o = run(policy, ref, false);
  const both = [...p.sessionsFired].filter((s) => o.sessionsFired.has(s)).length;
  P(
    `| ${policy.id} | ${p.fires} | ${p.supported} (${pct(p.supported, p.fires)}) | ${p.sessionsFired.size} | ` +
      `${o.sessionsFired.size} | ${pct(both, p.sessionsFired.size)} | ${pct(both, o.sessionsFired.size)} |`,
  );
  policySummaries[policy.id] = {
    policy,
    fires: p.fires,
    supported: p.supported,
    sessionsFired: p.sessionsFired.size,
    shouldFire: o.sessionsFired.size,
    sessionsBoth: both,
  };
}

P();
P(`Policies are defined in \`src/trigger/accumulator.ts\`; the shipped default is marked there.`);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `session-sim-${PRED_RUN}.md`), lines.join("\n") + "\n");
writeFileSync(join(OUT, `session-sim-${PRED_RUN}.json`), JSON.stringify(summary, null, 2) + "\n");
process.stdout.write(lines.join("\n") + "\n");
