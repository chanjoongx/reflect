// bench/variants.ts: judge variants against the reference labels, on a fixed
// split of the benchmark's sessions.
//
// The main bench (label.ts, score.ts, session-sim.ts) is pinned to the rubric
// fingerprint the 2026-08 reference labels carry. This harness leaves it alone.
// It reads the reference labels and the Haiku 5.5 run `h55` under that pinned
// fingerprint, and judges the same pairs with a variant from
// bench/judge-variants.ts: a system prompt plus a request shape.
//
//   api  the npm command's request: structured output (a json_schema format),
//        thinking off, effort low, the system prompt cached for an hour.
//   mod  the plugin's request as $.model.complete sends it: no structured
//        output, so the schema is appended to the message and the answer is
//        parsed tolerantly; a one-line CLI identity block before the system
//        prompt, as the engine puts its own there; thinking off, effort low.
//
// Sessions are split in two by a hash of their id. Rubric changes are tried on
// `dev`; `test` is judged once per finished variant and is what gets reported.
//
//   npx tsx bench/variants.ts --run v0-mod --split all          # judges what is missing (costs money)
//   npx tsx bench/variants.ts --score h55,v0-mod --split test   # no API calls
//   npx tsx bench/variants.ts --misses h55 --split dev          # FN/FP sheet in bench/results/
//
// Verdicts are cached in bench/data/variant-labels.jsonl, keyed by variant id,
// a hash of everything that shapes the request, and pair id.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { answerAsJson, parseLoose } from "../src/detect/answer-format.js";
import { buildUserMessage, parseVerdict, VERDICT_SCHEMA } from "../src/detect/judge-prompt.js";
import { renderPriorTurn } from "../src/detect/render.js";
import { isPushback, type JudgeVerdict, type Label, type Pair } from "../src/detect/types.js";
import { makeClient, type MessagesClient } from "../src/api/client.js";
import { costUSD, formatUSD } from "../src/pricing.js";
import { Accumulator, defaultPolicy } from "../src/trigger/accumulator.js";
import { confusion, fbeta, pairedDeltaCI, precision, recall, type Confusion } from "./metrics.js";
import { VARIANTS, type Shape, type Variant } from "./judge-variants.js";
import { adjudicationHtml, mergeMarks, parseAnswersJson, parseSheetMarks, type Mark, type MergedMarks, type SheetItem } from "./adjudication.js";

/** The fingerprint the 2026-08 reference labels and the 2026-11 `h55` run were stamped with. */
const REF_FP = "c74d7145eb";
/** The identity line Claude Code puts before a mod's system prompt (approximated). */
const CLI_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const DATA = arg("--data", "bench/data");
const OUT = arg("--out", "bench/results");
const SPLIT = arg("--split", "all") as "all" | "dev" | "test";
const CONCURRENCY = Number(arg("--concurrency", "8"));

// ─── Data ─────────────────────────────────────────────────────────────

interface Row extends Pair {
  gate: { pass: boolean; score: number };
}
interface LabelRow {
  pairId: string;
  run: string;
  fp?: string;
  verdict: JudgeVerdict;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  latencyMs: number;
  at?: string;
}
interface VariantRow {
  variant: string;
  vfp: string;
  pairId: string;
  verdict: JudgeVerdict | null;
  error?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  latencyMs: number;
  at: string;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
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

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Everything that shapes a variant's request, hashed: a changed rubric or shape is a cache miss. */
function variantFp(v: Variant): string {
  const material = [v.system, v.shape, v.model, "effort=low", "thinking=off", JSON.stringify(VERDICT_SCHEMA), "render=v2-tail", v.shape === "mod" || v.shape === "mod-system" ? CLI_IDENTITY : ""].join("\u0000");
  return fnv(material).toString(16).padStart(8, "0");
}

const splitOf = (sessionId: string): "dev" | "test" => (fnv(`split:${sessionId}`) % 2 === 0 ? "dev" : "test");

const rows = readJsonl<Row>(join(DATA, "pairs.jsonl"));
const labelRows = readJsonl<LabelRow>(join(DATA, "labels.jsonl")).filter((r) => r.fp === REF_FP);
const byRun = new Map<string, Map<string, LabelRow>>();
for (const r of labelRows) {
  if (!byRun.has(r.run)) byRun.set(r.run, new Map());
  const m = byRun.get(r.run) as Map<string, LabelRow>;
  const prev = m.get(r.pairId);
  if (!prev || (r.at ?? "") >= (prev.at ?? "")) m.set(r.pairId, r);
}
const ref = byRun.get("ref");
const h55 = byRun.get("h55");
if (!ref || !h55) throw new Error(`reference or h55 labels missing under ${REF_FP}; is bench/data the August corpus?`);

// The evaluation set score.ts uses: pairs every 2026-08 arm labelled.
const arms = ["ref", "prod", "blind", "blindfair"].map((k) => byRun.get(k) ?? new Map());
const shuffled = byRun.get("shuffled");
const evalRows = rows
  .filter((r) => arms.every((m) => m.has(r.pairId)) && (!shuffled || shuffled.size === 0 || shuffled.has(r.pairId)))
  .filter((r) => SPLIT === "all" || splitOf(r.sessionId) === SPLIT);

// ─── Human adjudication ───────────────────────────────────────────────
//
// `--sheet` writes bench/data/adjudication.md: every judged pair where the
// reference and the listed runs do not all agree on pushback or not, with no
// labels shown. A person writes y, n or ? after each "Pushback?". The same
// items go into bench/data/adjudication.html, answered with the keyboard in a
// browser; its "Save answers" downloads adjudication-answers.json. With
// `--adjudicated`, the y and n answers from both (the file wins where they
// differ) replace the reference on the pairs answered, and every score below
// is computed against the result.

const SHEET = join(DATA, "adjudication.md");
const PAGE = join(DATA, "adjudication.html");
const ANSWERS_ARG = arg("--answers", "");
const ANSWERS = ANSWERS_ARG || join(DATA, "adjudication-answers.json");
/** The default answers path as the sheet and page show it. */
const ANSWERS_SHOWN = `${DATA.replace(/\\/g, "/")}/adjudication-answers.json`;
const ADJUDICATED = argv.includes("--adjudicated");

/** Every answer from the markdown sheet and the saved answers file, "?" included. */
function readAnswers(): MergedMarks & { fileFound: boolean } {
  if (ANSWERS_ARG && !existsSync(ANSWERS_ARG)) throw new Error(`${ANSWERS_ARG} (given with --answers) is missing`);
  const sheetMarks = existsSync(SHEET) ? parseSheetMarks(readFileSync(SHEET, "utf8")) : new Map<string, Mark>();
  const fileFound = existsSync(ANSWERS);
  let fileMarks = new Map<string, Mark>();
  if (fileFound) {
    const r = parseAnswersJson(readFileSync(ANSWERS, "utf8"), ANSWERS);
    fileMarks = r.marks;
    if (r.skipped.length) process.stderr.write(`[variants] ${ANSWERS}: ${r.skipped.length} answers are not y, n or ? and were skipped: ${r.skipped.join(", ")}\n`);
  }
  return { ...mergeMarks(sheetMarks, fileMarks), fileFound };
}

/** The person's answers for scoring: pair id to pushback or not. Blank and "?" are left out. */
function humanAnswers(): Map<string, boolean> {
  if (!existsSync(SHEET) && !existsSync(ANSWERS)) throw new Error(`${SHEET} is missing; write it with --sheet first`);
  const a = readAnswers();
  const out = new Map<string, boolean>();
  let fromSheet = 0;
  let fromFile = 0;
  for (const [id, m] of a.marks) {
    if (m === "?") continue;
    out.set(id, m === "y");
    if (a.origin.get(id) === "file") fromFile++;
    else fromSheet++;
  }
  process.stdout.write(`Answers counted (y or n): ${fromSheet} from ${SHEET}, ${fromFile} from ${ANSWERS}${a.fileFound ? "" : " (no such file)"}.\n`);
  if (a.disagree.length) process.stdout.write(`The sheet and ${ANSWERS} answer ${a.disagree.length} ${a.disagree.length === 1 ? "pair" : "pairs"} differently; using ${ANSWERS}: ${a.disagree.join(", ")}\n`);
  return out;
}

const human = ADJUDICATED ? humanAnswers() : new Map<string, boolean>();
/** Pushback by the reference, or by the person where they answered. */
const refPush = (pairId: string): boolean => human.get(pairId) ?? isPushback(ref.get(pairId)!.verdict.label);

const variantPath = join(DATA, "variant-labels.jsonl");

function variantCache(v: Variant): Map<string, VariantRow> {
  const vfp = variantFp(v);
  const m = new Map<string, VariantRow>();
  for (const r of readJsonl<VariantRow>(variantPath)) {
    if (r.variant !== v.id || r.vfp !== vfp) continue;
    const prev = m.get(r.pairId);
    // A later answer replaces an earlier failure; an answer is never replaced by a failure.
    if (!prev || (prev.verdict === null && r.verdict !== null) || (r.verdict !== null && r.at >= prev.at)) m.set(r.pairId, r);
  }
  return m;
}

// ─── Judging ──────────────────────────────────────────────────────────

async function judge(client: MessagesClient, v: Variant, pair: Pair): Promise<Omit<VariantRow, "variant" | "vfp" | "pairId" | "at">> {
  const user = buildUserMessage(pair, false);
  const t0 = Date.now();
  const res =
    v.shape === "api"
      ? await client.messages.create({
          model: v.model,
          max_tokens: 2000,
          system: [{ type: "text", text: v.system, cache_control: { type: "ephemeral", ttl: "1h" } }],
          messages: [{ role: "user", content: user }],
          thinking: { type: "disabled" },
          output_config: { effort: "low", format: { type: "json_schema", schema: VERDICT_SCHEMA as unknown as Record<string, unknown> } },
        })
      : await client.messages.create({
          model: v.model,
          max_tokens: 2000,
          // `text` is the mod's request without the identity line, cached for an hour as the npm command does.
          system:
            v.shape === "mod"
              ? [
                  { type: "text", text: CLI_IDENTITY },
                  { type: "text", text: v.system, cache_control: { type: "ephemeral" } },
                ]
              : v.shape === "mod-system"
                ? [
                    { type: "text", text: CLI_IDENTITY },
                    { type: "text", text: `${v.system}\n\n${answerAsJson(VERDICT_SCHEMA)}`, cache_control: { type: "ephemeral" } },
                  ]
                : [{ type: "text", text: v.system, cache_control: { type: "ephemeral", ttl: "1h" } }],
          // `mod-system` sends the message alone, as `api` does.
          messages: [{ role: "user", content: v.shape === "mod-system" ? user : `${user}\n\n${answerAsJson(VERDICT_SCHEMA)}` }],
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
        });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const u = res.usage;
  const usage = {
    model: res.model ?? v.model,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    latencyMs: Date.now() - t0,
  };
  try {
    const verdict = v.shape === "api" ? parseVerdict(text) : parseLoose(text, parseVerdict);
    return { verdict, ...usage };
  } catch (e) {
    return { verdict: null, error: `unreadable answer: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, ...usage };
  }
}

function costOf(r: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }, shape: Shape): number {
  return costUSD(r.model, {
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    ...(shape === "mod" || shape === "mod-system" ? { cacheCreation5mTokens: r.cacheCreationTokens } : { cacheCreation1hTokens: r.cacheCreationTokens }),
  });
}

async function runVariant(v: Variant): Promise<void> {
  const vfp = variantFp(v);
  const cache = variantCache(v);
  const todo = evalRows.filter((r) => !cache.get(r.pairId)?.verdict);
  process.stderr.write(`[variants:${v.id}] ${v.shape} ${v.model} vfp=${vfp} todo=${todo.length}/${evalRows.length}\n`);
  if (todo.length === 0) return;
  const client = await makeClient({ maxRetries: 4, timeoutMs: 60_000 }, process.env);
  let i = 0;
  let done = 0;
  let spent = 0;
  let unreadable = 0;
  let failed = 0;
  const worker = async () => {
    while (i < todo.length) {
      const row = todo[i++] as Row;
      try {
        const r = await judge(client, v, row);
        if (r.verdict === null) unreadable++;
        spent += costOf(r, v.shape);
        appendFileSync(variantPath, JSON.stringify({ variant: v.id, vfp, pairId: row.pairId, ...r, at: new Date().toISOString() }) + "\n", "utf8");
      } catch (e) {
        failed++;
        process.stderr.write(`\n[variants:${v.id}] ${row.pairId}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}\n`);
      }
      done++;
      if (done % 50 === 0 || done === todo.length) process.stderr.write(`\r[variants:${v.id}] ${done}/${todo.length} spent=${formatUSD(spent)} unreadable=${unreadable} failed=${failed}   `);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  process.stderr.write(`\n[variants:${v.id}] done, spent ${formatUSD(spent)}\n`);
}

// ─── Scoring ──────────────────────────────────────────────────────────

interface Source {
  id: string;
  label: (pairId: string) => Label | null;
  cost: () => { usd: number; n: number; ms: number };
  unreadable: () => number;
}

function sourceOf(id: string): Source {
  if (id === "h55") {
    return {
      id,
      label: (p) => h55!.get(p)?.verdict.label ?? null,
      cost: () => {
        let usd = 0, n = 0, ms = 0;
        for (const r of evalRows) {
          const x = h55!.get(r.pairId);
          if (!x) continue;
          usd += costOf(x, "api");
          ms += x.latencyMs;
          n++;
        }
        return { usd, n, ms };
      },
      unreadable: () => 0,
    };
  }
  const v = VARIANTS[id];
  if (!v) throw new Error(`unknown variant: ${id}`);
  const cache = variantCache(v);
  return {
    id,
    label: (p) => cache.get(p)?.verdict?.label ?? null,
    cost: () => {
      let usd = 0, n = 0, ms = 0;
      for (const r of evalRows) {
        const x = cache.get(r.pairId);
        if (!x) continue;
        usd += costOf(x, v.shape);
        ms += x.latencyMs;
        n++;
      }
      return { usd, n, ms };
    },
    unreadable: () => evalRows.filter((r) => cache.has(r.pairId) && cache.get(r.pairId)!.verdict === null).length,
  };
}

const truth = evalRows.map((r) => refPush(r.pairId));
const predOf = (s: Source) => evalRows.map((r) => {
  const l = s.label(r.pairId);
  return r.gate.pass && l !== null && isPushback(l);
});

/** k2w6 replay over the split's sessions: fires, supported fires, sessions reached. */
function replay(s: Source) {
  const policy = defaultPolicy();
  const sessions = new Map<string, Row[]>();
  for (const r of evalRows) {
    if (!sessions.has(r.sessionId)) sessions.set(r.sessionId, []);
    (sessions.get(r.sessionId) as Row[]).push(r);
  }
  let fires = 0, supported = 0;
  const fired = new Set<string>();
  const should = new Set<string>();
  for (const [sid, list] of sessions) {
    list.sort((a, b) => a.promptIndex - b.promptIndex);
    const acc = new Accumulator(policy);
    const accRef = new Accumulator(policy);
    for (const r of list) {
      const l = s.label(r.pairId);
      const sig = r.gate.pass && l !== null && isPushback(l) ? { label: l, confidence: "high" as const } : null;
      const t = ref!.get(r.pairId)!.verdict;
      const answered = human.has(r.pairId);
      const sigRef = r.gate.pass && refPush(r.pairId) ? { label: answered && !isPushback(t.label) ? ("correction" as Label) : t.label, confidence: answered ? ("high" as const) : t.confidence } : null;
      const f = acc.observe(r.pairId, sig);
      if (f) {
        fires++;
        fired.add(sid);
        const hits = f.evidence.filter((id: string) => refPush(id)).length;
        if (hits >= Math.min(policy.k, f.evidence.length)) supported++;
      }
      if (accRef.observe(r.pairId, sigRef)) should.add(sid);
    }
  }
  const reached = [...fired].filter((x) => should.has(x)).length;
  return { fires, supported, sessionsFired: fired.size, should: should.size, reached };
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");

function score(ids: string[]): void {
  const sources = ids.map(sourceOf);
  const base = sourceOf("h55");
  const basePred = predOf(base);
  const sessionsInSplit = new Set(evalRows.map((r) => r.sessionId)).size;
  const lines: string[] = [];
  const P = (s = "") => lines.push(s);
  P(`# Judge variants, split \`${SPLIT}\`${ADJUDICATED ? ", adjudicated" : ""}`);
  P();
  P(`${evalRows.length} pairs from ${sessionsInSplit} sessions, ${truth.filter(Boolean).length} of them pushback by the reference labels${ADJUDICATED ? " with the person's answers in place of the reference where given" : ""}. Turns with no agent turn before them are not judged.`);
  P();
  if (ADJUDICATED) {
    const answered = evalRows.filter((r) => human.has(r.pairId));
    const agree = (pred: (id: string) => boolean) => answered.filter((r) => pred(r.pairId) === human.get(r.pairId)).length;
    P(`On the ${answered.length} pairs the person answered, the reference agrees with them on ${agree((id) => isPushback(ref!.get(id)!.verdict.label))}.`);
    for (const s of sources) P(`- ${s.id} agrees with them on ${agree((id) => { const r = evalRows.find((x) => x.pairId === id)!; const l = s.label(id); return r.gate.pass && l !== null && isPushback(l); })}`);
    P();
  }
  P(`| variant | pushback found | false alarms | precision | recall | F0.5 | Δ F0.5 vs h55 (95% CI, by session) | unreadable | per call | mean latency | k2w6 fires (supported) | sessions reached |`);
  P(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  const summary: Record<string, unknown> = {};
  for (const s of sources) {
    const pred = predOf(s);
    const c: Confusion = confusion(pred, truth);
    const d = pairedDeltaCI(pred, basePred, truth, (x) => fbeta(x, 0.5), { iters: 2000, groups: evalRows.map((r) => r.sessionId) });
    const k = s.cost();
    const rp = replay(s);
    const sign = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;
    P(
      `| ${s.id} | ${c.tp} | ${c.fp} | ${pct(precision(c))} | ${pct(recall(c))} | ${pct(fbeta(c, 0.5))} | ${s.id === "h55" ? "" : `${sign(d.point)} (${sign(d.lo)} to ${sign(d.hi)})`} | ${s.unreadable()} | $${(k.usd / Math.max(1, k.n)).toFixed(5)} | ${Math.round(k.ms / Math.max(1, k.n))} ms | ${rp.fires} (${rp.supported}) | ${rp.reached} of ${rp.should} |`,
    );
    summary[s.id] = { tp: c.tp, fp: c.fp, fn: c.fn, precision: precision(c), recall: recall(c), f05: fbeta(c, 0.5), deltaF05VsH55: d, unreadable: s.unreadable(), perCallUSD: k.usd / Math.max(1, k.n), meanLatencyMs: k.ms / Math.max(1, k.n), judged: k.n, replay: rp };
  }
  mkdirSync(OUT, { recursive: true });
  const name = `variants-${SPLIT}${ADJUDICATED ? "-adjudicated" : ""}`;
  writeFileSync(join(OUT, `${name}.md`), lines.join("\n") + "\n", "utf8");
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ split: SPLIT, adjudicated: ADJUDICATED ? human.size : 0, pairs: evalRows.length, sessions: sessionsInSplit, pushback: truth.filter(Boolean).length, variants: summary }, null, 2), "utf8");
  process.stdout.write(lines.join("\n") + "\n");
}

/** A sheet of the misses on this split, for reading. It quotes real prompts, so it stays in bench/results/. */
function misses(id: string): void {
  const s = sourceOf(id);
  const pred = predOf(s);
  const out: string[] = [`# ${id} misses on \`${SPLIT}\``, ""];
  evalRows.forEach((r, i) => {
    if (pred[i] === truth[i]) return;
    const kind = truth[i] ? "MISSED (FN)" : "FALSE ALARM (FP)";
    const refV = ref!.get(r.pairId)!.verdict;
    const label = s.label(r.pairId);
    const rationale = id === "h55" ? h55!.get(r.pairId)?.verdict.rationale : variantCache(VARIANTS[id] as Variant).get(r.pairId)?.verdict?.rationale;
    out.push(`## ${kind} ${r.pairId}`);
    out.push(`reference: ${refV.label} (${refV.confidence}), evidence "${refV.evidence}"; judge: ${label ?? "none"}${r.gate.pass ? "" : " (gate: no prior turn)"}`);
    out.push(`judge rationale: ${rationale ?? ""}`);
    out.push("", "prior turn:", "```", renderPriorTurn(r).slice(-900), "```", "message:", "```", r.prompt.slice(0, 900), "```", "");
  });
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `misses-${id}-${SPLIT}.md`);
  writeFileSync(path, out.join("\n"), "utf8");
  process.stdout.write(`${path}: ${out.filter((l) => l.startsWith("## ")).length} rows\n`);
}

/**
 * The adjudication sheet: judged pairs where the reference and the listed runs
 * split on pushback or not. No label is shown, so the answers are the person's
 * own. Answers already written on an earlier sheet or in the saved answers
 * file are carried over into both the sheet and the page.
 */
function sheet(ids: string[]): void {
  const sources = ids.map(sourceOf);
  const kept = readAnswers();
  const disputed = evalRows
    .filter((r) => r.gate.pass)
    .filter((r) => {
      const votes = [isPushback(ref!.get(r.pairId)!.verdict.label)];
      for (const s of sources) {
        const l = s.label(r.pairId);
        if (l !== null) votes.push(isPushback(l));
      }
      return votes.some(Boolean) && votes.some((v) => !v);
    })
    .sort((a, b) => (a.sessionId === b.sessionId ? a.promptIndex - b.promptIndex : a.sessionId.localeCompare(b.sessionId)));
  const scoreCommand = `npx tsx bench/variants.ts --adjudicated --score ${["h55", ...ids.filter((x) => x !== "h55")].join(",")}`;
  const out = [
    "# Adjudication: was this message pushback?",
    "",
    `${disputed.length} messages from your own Claude Code sessions. On each one, the reference labels and at least one judge (${ids.join(", ")}) disagree about whether it pushes back on the agent. No label is shown here.`,
    "",
    "For each, read what the agent had just done and said (shown as the judge saw it), then your message, and write after **Pushback?**:",
    "",
    "- `y` if you were pushing back on what the agent had just done or proposed: correcting it, rejecting it, or saying it does not work or is not what you wanted",
    "- `n` if you were giving new work, asking something, or approving",
    "- `?` if you cannot tell",
    "",
    `The same messages are in \`adjudication.html\` next to this file. Open it in a browser from disk and answer with the keys \`y\`, \`n\` and \`?\`; it makes no requests. Its **Save answers** button downloads \`adjudication-answers.json\`: move that to \`${ANSWERS_SHOWN}\`, or pass its path with \`--answers <path>\`. Where this sheet and that file answer a message differently, the file wins.`,
    "",
    `Then run \`${scoreCommand}\`. It makes no API calls. Messages are in session order. Running \`--sheet\` again keeps the answers already written here and in the answers file.`,
    "",
    "---",
    "",
  ];
  const items: SheetItem[] = [];
  disputed.forEach((r, i) => {
    const prev = kept.marks.get(r.pairId);
    const prior = renderPriorTurn(r);
    const message = r.prompt.slice(0, 2500);
    items.push({ id: r.pairId, prior, message, mark: prev });
    out.push(`### ${i + 1}. \`${r.pairId}\``, "");
    out.push("**What the agent did and said just before**", "", "```text", prior, "```", "");
    out.push("**Your message**", "", "```text", message, "```", "");
    out.push(`**Pushback?** ${prev ?? ""}`, "", "---", "");
  });
  writeFileSync(SHEET, out.join("\n"), "utf8");
  writeFileSync(PAGE, adjudicationHtml(items, { judges: ids, scoreCommand, answersPath: ANSWERS_SHOWN }), "utf8");
  const onSheet = items.filter((it) => it.mark !== undefined);
  const fromFile = onSheet.filter((it) => kept.origin.get(it.id) === "file").length;
  process.stdout.write(`${SHEET} and ${PAGE}: ${disputed.length} messages, ${onSheet.length} already answered (${onSheet.length - fromFile} from the sheet, ${fromFile} from ${ANSWERS})\n`);
  const differ = kept.disagree.filter((id) => disputed.some((r) => r.pairId === id));
  if (differ.length) process.stdout.write(`The sheet and ${ANSWERS} answered ${differ.length} of these ${differ.length === 1 ? "message" : "messages"} differently; kept the file's: ${differ.join(", ")}\n`);
}

async function main() {
  const sheetIds = arg("--sheet", "").split(",").filter(Boolean);
  if (sheetIds.length) sheet(sheetIds);
  const runIds = arg("--run", "").split(",").filter(Boolean);
  for (const id of runIds) {
    const v = VARIANTS[id];
    if (!v) throw new Error(`unknown variant: ${id}`);
    await runVariant(v);
  }
  const scoreIds = arg("--score", runIds.length ? ["h55", ...runIds].join(",") : "").split(",").filter(Boolean);
  if (scoreIds.length) score([...new Set(scoreIds)]);
  const missIds = arg("--misses", "").split(",").filter(Boolean);
  for (const id of missIds) misses(id);
  if (!sheetIds.length && !runIds.length && !scoreIds.length && !missIds.length) {
    const dev = rows.filter((r) => splitOf(r.sessionId) === "dev");
    process.stdout.write(`${evalRows.length} evaluation pairs in split ${SPLIT}; dev holds ${new Set(dev.map((r) => r.sessionId)).size} sessions. Use --run, --score or --misses.\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`[variants] FATAL ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
