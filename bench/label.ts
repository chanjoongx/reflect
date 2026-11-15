// bench/label.ts — run a judge over the extracted pairs.
//
// Three runs make up the experiment:
//   ref    Opus 5,   full context  → reference labels (gold-proxy annotator)
//   prod   Haiku 4.5, full context → the judge that would actually ship
//   blind  Haiku 4.5, NO context   → the stateless ablation
//
// `blind` is the load-bearing one. evals/FINDINGS.md claims the signal is
// relational — that an utterance alone cannot be classified. If blind scores
// as well as prod, that claim is false and reflect v2's whole premise with it.
//
// Resumable: every verdict is appended to a cache keyed by (pairId, run), and
// a re-run only spends on what is missing.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  judgePair,
  judgeFingerprint,
  BENCH_PROD_MODEL,
  DEFAULT_JUDGE_MODEL,
  REFERENCE_JUDGE_MODEL,
} from "../src/detect/judge.js";
import type { JudgeThinking } from "../src/detect/judge.js";
import { costUSD, formatUSD } from "../src/pricing.js";
import type { Pair, JudgeVerdict } from "../src/detect/types.js";

// ─── Run definitions ──────────────────────────────────────────────────

export interface RunSpec {
  id: string;
  model: string;
  blind: boolean;
  fairBlind?: boolean;
  /** Replace each pair's prior turn with another pair's — the format placebo. */
  shuffledPrior?: boolean;
  /** Unset for every 2026-08 run, which sent neither field. */
  thinking?: JudgeThinking;
  effort?: "low" | "medium" | "high";
}

export const RUNS: Record<string, RunSpec> = {
  // The 2026-08 arms are pinned to the models that produced their cached
  // labels. Pointing them at DEFAULT_JUDGE_MODEL would let a product default
  // change relabel the benchmark under an old run name.
  ref: { id: "ref", model: REFERENCE_JUDGE_MODEL, blind: false },
  prod: { id: "prod", model: BENCH_PROD_MODEL, blind: false },
  blind: { id: "blind", model: BENCH_PROD_MODEL, blind: true },
  // Fair control for `blind`: same missing context, but a system prompt that
  // does not promise context it will not receive. Separates information loss
  // from prompt mismatch.
  blindfair: { id: "blindfair", model: BENCH_PROD_MODEL, blind: true, fairBlind: true },
  // The control that decides the relational claim. Identical rendering to
  // `prod` — same prompt, same "here is what the agent just did" block, same
  // token budget — but the prior turn belongs to a DIFFERENT pair. If this
  // scores like `prod`, the sighted arm was gaining format, not information.
  // If it scores like `blind`, the information is what mattered.
  shuffled: { id: "shuffled", model: BENCH_PROD_MODEL, blind: false, shuffledPrior: true },
  // 2026-11: the judge v0.2 ships. Same rubric, so the same fingerprint; only
  // the model and its thinking mode differ from `prod`.
  h55: { id: "h55", model: DEFAULT_JUDGE_MODEL, blind: false, thinking: "off", effort: "low" },
  h55t: { id: "h55t", model: DEFAULT_JUDGE_MODEL, blind: false, thinking: "adaptive", effort: "low" },
};

interface CacheRow {
  pairId: string;
  run: string;
  /** Fingerprint of the rubric + rendering that produced this verdict. */
  fp?: string;
  verdict: JudgeVerdict;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  latencyMs: number;
  at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function apiKey(): string {
  const fromEnv = process.env["ANTHROPIC_API_KEY"];
  if (fromEnv) return fromEnv;
  const env = readFileSync(".env", "utf8");
  const m = /ANTHROPIC_API_KEY\s*=\s*(.+)/.exec(env);
  const k = m?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!k) throw new Error("ANTHROPIC_API_KEY not found in env or .env");
  return k;
}

function loadPairs(path: string): Pair[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const r = JSON.parse(l);
      return {
        pairId: r.pairId,
        sessionId: r.sessionId,
        project: r.project,
        promptIndex: r.promptIndex,
        prompt: r.prompt,
        promptAt: r.promptAt,
        prior: r.prior
          ? { text: r.prior.text, toolCalls: r.prior.toolCalls, endedAt: r.prior.endedAt }
          : null,
        recentTargets: r.recentTargets ?? [],
        sidechain: r.sidechain ?? false,
      } as Pair;
    });
}

/**
 * Load the verdict cache, keyed on (fingerprint, run, pairId).
 *
 * The fingerprint matters. Keyed only on (run, pairId), a cache accumulated
 * across a day of rubric edits silently mixes verdicts from different
 * annotators: the first pass ended with 710 duplicated keys, 31 of which
 * disagreed on the label, and "which one is ground truth" was decided by which
 * line happened to be appended last. Including the fingerprint turns a rubric
 * change into a cache miss instead of a contamination, and rows written before
 * fingerprints existed are ignored rather than trusted.
 */
function loadCache(path: string, fp: string): Map<string, CacheRow> {
  const m = new Map<string, CacheRow>();
  if (!existsSync(path)) return m;
  let stale = 0;
  let conflicts = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    let r: CacheRow;
    try {
      r = JSON.parse(line) as CacheRow;
    } catch {
      continue; // torn line from an interrupted append
    }
    if (r.fp !== fp) {
      stale++;
      continue;
    }
    const key = `${r.run}::${r.pairId}`;
    const prev = m.get(key);
    if (prev && prev.verdict.label !== r.verdict.label) conflicts++;
    // Deterministic: newest timestamp wins, not newest line.
    if (!prev || (r.at ?? "") >= (prev.at ?? "")) m.set(key, r);
  }
  if (stale) {
    process.stderr.write(
      `[label] ignoring ${stale} cached rows from a different rubric fingerprint\n`,
    );
  }
  if (conflicts) {
    process.stderr.write(
      `[label] ${conflicts} same-fingerprint keys disagreed on the label; kept the newest by timestamp\n`,
    );
  }
  return m;
}

/**
 * Deterministic derangement of prior turns — the format placebo.
 *
 * Pair i keeps its own prompt but is shown pair (i + n/2 + 1)'s prior turn, so
 * every pair gets somebody else's context and none keeps its own. The rendered
 * request is byte-for-byte the same SHAPE as the sighted arm — same framing,
 * same "here is what the agent just did" block, similar token count — and only
 * the informational content is destroyed.
 *
 * This is the control that decides the relational claim. If the shuffled arm
 * scores like the sighted arm, the sighted arm was gaining format, not
 * information, and the ablation proves nothing. If it scores like the blind
 * arm, the information is what mattered.
 */
function derangePriors(ps: Pair[]): Pair[] {
  const n = ps.length;
  if (n < 2) return ps;
  const offset = Math.floor(n / 2) + 1;
  return ps.map((p, i) => {
    const donor = ps[(i + offset) % n] as Pair;
    return { ...p, prior: donor.prior, recentTargets: donor.recentTargets };
  });
}

/** Bounded-concurrency map that never rejects; failures surface as nulls. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onDone?: (done: number, total: number) => void,
): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i] as T, i);
      } catch {
        out[i] = null;
      }
      done++;
      onDone?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
  };
  const dataDir = get("--data", "bench/data");
  const runIds = get("--runs", "ref,prod,blind").split(",").map((s) => s.trim());
  const limit = Number(get("--concurrency", "10"));
  const cap = Number(get("--max", "0")); // 0 = all
  const seedArg = Number(get("--seed", "7"));

  const key = apiKey();
  mkdirSync(dataDir, { recursive: true });

  const pairs = loadPairs(join(dataDir, "pairs.jsonl"));
  const cachePath = join(dataDir, "labels.jsonl");
  const fp = judgeFingerprint();
  const cache = loadCache(cachePath, fp);
  process.stderr.write(`[label] rubric fingerprint ${fp}\n`);

  // Deterministic subsample when --max is set, so all three runs see the same
  // pairs and cross-run agreement is computed on identical support.
  let subset = pairs;
  if (cap > 0 && cap < pairs.length) {
    // Fisher-Yates. `sort(() => rnd() - 0.5)` is NOT a shuffle: a random
    // comparator is not a valid one and TimSort leaves elements near where
    // they started. Measured over 400 seeds, it selected rows from the first
    // 10% of the corpus 2.3x more often than the last 10% — and pairs.jsonl is
    // written in corpus-walk order, so that is 2.3x over-sampling of whichever
    // projects happen to sort first.
    let s = seedArg >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const arr = [...pairs];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j] as Pair, arr[i] as Pair];
    }
    subset = arr.slice(0, cap);
  }

  process.stderr.write(
    `[label] ${subset.length} pairs · runs=${runIds.join(",")} · concurrency=${limit} · cached=${cache.size}\n`,
  );

  const totals: Record<string, { n: number; cost: number; fail: number; ms: number }> = {};

  for (const runId of runIds) {
    const spec = RUNS[runId];
    if (!spec) throw new Error(`unknown run: ${runId}`);

    const source = spec.shuffledPrior === true ? derangePriors(subset) : subset;
    const todo = source.filter((p) => !cache.has(`${runId}::${p.pairId}`));
    process.stderr.write(
      `\n[label:${runId}] model=${spec.model} blind=${spec.blind} todo=${todo.length}/${subset.length}\n`,
    );

    let cost = 0;
    let fail = 0;
    let ms = 0;
    let lastPct = -1;

    await pool(
      todo,
      limit,
      async (p) => {
        try {
          const { verdict, usage } = await judgePair(p, {
            apiKey: key,
            model: spec.model,
            blind: spec.blind,
            ...(spec.fairBlind === true ? { fairBlind: true } : {}),
            ...(spec.thinking !== undefined ? { thinking: spec.thinking } : {}),
            ...(spec.effort !== undefined ? { effort: spec.effort } : {}),
          });
          const row: CacheRow = {
            pairId: p.pairId,
            run: runId,
            fp,
            verdict,
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            latencyMs: usage.latencyMs,
            at: new Date().toISOString(),
          };
          appendFileSync(cachePath, JSON.stringify(row) + "\n", "utf8");
          cache.set(`${runId}::${p.pairId}`, row);
          cost += costUSD(usage.model, {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreation1hTokens: usage.cacheCreationTokens,
          });
          ms += usage.latencyMs;
          return row;
        } catch (e) {
          // A pair already written to the cache is not a failure, whatever
          // threw afterwards (a pricing lookup, a disk hiccup).
          if (cache.has(`${runId}::${p.pairId}`)) return null;
          fail++;
          appendFileSync(
            join(dataDir, "label-errors.jsonl"),
            JSON.stringify({
              pairId: p.pairId,
              run: runId,
              error: e instanceof Error ? e.message : String(e),
              at: new Date().toISOString(),
            }) + "\n",
            "utf8",
          );
          throw e;
        }
      },
      (done, total) => {
        const pct = Math.floor((done / total) * 100);
        if (pct !== lastPct && pct % 5 === 0) {
          lastPct = pct;
          process.stderr.write(
            `\r[label:${runId}] ${done}/${total} (${pct}%) cost=${formatUSD(cost)} fail=${fail}   `,
          );
        }
      },
    );

    process.stderr.write(
      `\n[label:${runId}] done · ${todo.length - fail} new · ${fail} failed · ${formatUSD(cost)} · avg ${todo.length ? Math.round(ms / Math.max(1, todo.length - fail)) : 0}ms\n`,
    );
    totals[runId] = { n: todo.length - fail, cost, fail, ms };
  }

  writeFileSync(
    join(dataDir, "label-summary.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pairs: subset.length,
        runs: totals,
        totalCostUSD: Object.values(totals).reduce((a, b) => a + b.cost, 0),
      },
      null,
      2,
    ),
    "utf8",
  );
  process.stderr.write(
    `\n[label] total spend this invocation: ${formatUSD(Object.values(totals).reduce((a, b) => a + b.cost, 0))}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`\n[label] FATAL ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
