// src/reflect/format.ts: how a reflection is shown to the agent and to the developer.
//
// v0.1 wrote a markdown file and hoped a path-scoped rule would make the agent
// read it. v0.2 hands the text to the agent directly through a hook's
// `additionalContext` (limit 10,000 characters; we stay far below it) and still
// writes the file, which is now for the developer.

import type { Reflection2 } from "./schema.js";

export const MAX_CONTEXT_CHARS = 2400;

export interface GuidanceMeta {
  pushbacks: number;
  window: number;
  /** 1-based developer turns the reflection was built from. */
  turns: number[];
  manual?: boolean;
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function formatForAgent(r: Reflection2, meta: GuidanceMeta): string {
  const head = meta.manual
    ? "reflect: the developer asked for a reflection on this session. An outside reviewer read the recent turns and suggests:"
    : `reflect: the developer has pushed back on ${meta.pushbacks} of their last ${meta.window} turns` +
      (meta.turns.length ? ` (turns ${meta.turns.join(", ")})` : "") +
      ". An outside reviewer read those turns and suggests:";
  const hedge =
    r.confidence === "low" || r.false_trigger_likelihood === "high"
      ? "Treat the adjustment as a question: ask the developer before acting on it."
      : r.confidence === "medium"
        ? "Apply the adjustment, and say briefly that you are doing so."
        : "Apply the adjustment.";
  const lines = [
    head,
    "",
    `Pattern: ${r.pattern}`,
    `What the pushback is about: ${r.signal}`,
    `Adjustment for the next ${r.expires_after_turns} turns: ${r.adjustment}`,
    r.verify ? `Before applying it: ${r.verify}` : "",
    "",
    `Confidence ${r.confidence}, false-trigger likelihood ${r.false_trigger_likelihood}.` +
      (r.counter_hypothesis ? ` It may be wrong if: ${r.counter_hypothesis}` : ""),
    hedge,
    r.scope === "wider_concern"
      ? "This looks like a standing project convention. You may suggest recording it in CLAUDE.md; do not edit CLAUDE.md unasked."
      : "",
    "The developer's own words in the current turn take precedence over this note.",
  ].filter((l, i, a) => !(l === "" && (i === 0 || a[i - 1] === "")));
  return clip(lines.join("\n").trim(), MAX_CONTEXT_CHARS);
}

export function formatMarkdown(
  r: Reflection2,
  meta: GuidanceMeta & { at: string; model: string; costUSD: number },
): string {
  return [
    `# Session reflection: ${meta.at}`,
    "",
    meta.manual
      ? "Requested manually."
      : `Triggered by pushback on ${meta.pushbacks} of the last ${meta.window} developer turns (${meta.turns.join(", ")}).`,
    "",
    "## What I was doing (pattern)",
    r.pattern,
    "",
    "## Why the developer pushed back (signal)",
    r.signal,
    "",
    `## Adjustment for the next ${r.expires_after_turns} turns`,
    r.adjustment,
    "",
    "## Check before applying",
    r.verify || "(none)",
    "",
    "## If this is wrong",
    r.counter_hypothesis || "(none given)",
    "",
    `> Confidence: ${r.confidence} · Scope: ${r.scope} · FT-likelihood: ${r.false_trigger_likelihood} · ` +
      `${meta.model} · $${meta.costUSD.toFixed(4)}`,
    "",
  ].join("\n");
}
