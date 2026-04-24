/**
 * Pure-client-side pattern clustering over LogEntry[].
 *
 * Approach: token-set Jaccard similarity on the `pattern` field,
 * agglomerative (connected-component) over 0.35 threshold. Each cluster gets:
 *   - label (top 2 shared tokens)
 *   - synthesis (the `confidence: high` reflection body, truncated 80ch)
 *   - sparkline (count per day across the window)
 *
 * Deterministic. No external calls.
 */

import type { LogEntry, PatternCluster, Reflection } from "./types";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "and",
  "or",
  "for",
  "with",
  "at",
  "by",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "i",
  "it",
  "that",
  "this",
  "these",
  "those",
  "my",
  "your",
  "user",
  "reflect",
  "each",
  "again",
  "across",
  "from",
  "but",
  "not",
  "as",
  "into",
  "over",
  "under",
  "then",
  "when",
  "which",
  "what",
  "how",
  "why",
  "had",
  "has",
  "have",
  "did",
  "do",
  "does",
  "could",
  "would",
  "should",
  "kept",
  "turn",
  "turns",
  "edit",
  "edits",
  "tool",
  "tools",
  "call",
  "calls",
  "session",
  "same",
  "new",
  "me",
  "you",
  "we",
  "our",
]);

function tokenize(s: string): Set<string> {
  const toks = s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  return new Set(toks);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const x of a) if (b.has(x)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function topShared(sets: Set<string>[]): string[] {
  if (sets.length === 0) return [];
  const count = new Map<string, number>();
  for (const s of sets) for (const t of s) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()]
    .filter(([, c]) => c >= Math.max(2, Math.floor(sets.length * 0.5)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);
}

function bestSynthesis(entries: LogEntry[]): string {
  const high = entries.find(
    (e) => (e.reflection.confidence as Reflection["confidence"]) === "high",
  );
  const source = (high ?? entries[0])?.reflection.pattern ?? "";
  if (source.length <= 120) return source;
  return source.slice(0, 117).replace(/\s+\S*$/, "") + "…";
}

function sparkline(entries: LogEntry[], buckets = 7): number[] {
  if (entries.length === 0) return Array(buckets).fill(0);
  const ts = entries.map((e) => new Date(e.timestamp).getTime()).sort((a, b) => a - b);
  const first = ts[0]!;
  const last = ts[ts.length - 1]!;
  const span = Math.max(1, last - first);
  const step = span / buckets;
  const out = Array(buckets).fill(0);
  for (const t of ts) {
    const i = Math.min(buckets - 1, Math.floor((t - first) / step));
    out[i]++;
  }
  return out;
}

export function clusterReflections(entries: LogEntry[], threshold = 0.22): PatternCluster[] {
  if (entries.length === 0) return [];

  // Compute token sets for each entry (on pattern + adjustment together for richer signal)
  const tokenSets = entries.map((e) =>
    tokenize(`${e.reflection.pattern} ${e.reflection.adjustment}`),
  );

  // Union-find
  const parent: number[] = entries.map((_, i) => i);
  function find(x: number): number {
    while (parent[x]! !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }
  function union(x: number, y: number): void {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  }

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (jaccard(tokenSets[i]!, tokenSets[j]!) >= threshold) {
        union(i, j);
      }
    }
  }

  // Group
  const groups = new Map<number, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  const clusters: PatternCluster[] = [];
  let cid = 0;
  for (const [, indices] of groups) {
    const cl_entries = indices.map((i) => entries[i]!);
    const cl_tokens = indices.map((i) => tokenSets[i]!);
    const shared = topShared(cl_tokens);
    const label =
      shared.length >= 2
        ? `${shared[0]} · ${shared[1]}`
        : shared[0] ?? "miscellaneous";
    clusters.push({
      id: `c${cid++}`,
      label,
      count: cl_entries.length,
      synthesis: bestSynthesis(cl_entries),
      entries: cl_entries,
      shared_keywords: shared,
      frequency_sparkline: sparkline(cl_entries),
    });
  }

  return clusters.sort((a, b) => b.count - a.count);
}
