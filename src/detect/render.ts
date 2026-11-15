// src/detect/render.ts: how the judge sees the agent's previous turn.
// Moved out of judge.ts unchanged so the hooks can summarise a turn without
// loading the SDK. PRIOR_TEXT_CHARS is part of judgeFingerprint().

import type { Pair } from "./types.js";
import { redactString, safeTruncate, safeTruncateEnd } from "../redact.js";

export const PRIOR_TEXT_CHARS = 1400;

export function renderPriorTurn(pair: Pair): string {
  const prior = pair.prior;
  if (!prior) return "(The agent has not spoken yet in this session.)";

  const calls = prior.toolCalls;
  const mut = calls.filter((c) => c.mutating).length;
  const err = calls.filter((c) => c.errored).length;

  const lines: string[] = [];
  if (calls.length) {
    const shown = calls.slice(-14);
    lines.push(
      `Agent actions this turn (${calls.length} total, ${mut} modified files, ${err} errored)` +
        (calls.length > shown.length ? `, last ${shown.length} shown:` : ":"),
    );
    for (const c of shown) {
      const flags = `${c.mutating ? " [modified]" : ""}${c.errored ? " [error]" : ""}`;
      lines.push(`  - ${c.name}: ${safeTruncate(redactString(c.target), 120)}${flags}`);
    }
  } else {
    lines.push("Agent actions this turn: none (it replied without using tools).");
  }

  const text = redactString(prior.text).trim();
  if (text) {
    const tail =
      text.length > PRIOR_TEXT_CHARS
        ? "…" + safeTruncateEnd(text, PRIOR_TEXT_CHARS)
        : text;
    lines.push("", "What the agent said, ending its turn:", '"""', tail, '"""');
  } else {
    lines.push("", "The agent produced no visible text this turn.");
  }

  return lines.join("\n");
}
