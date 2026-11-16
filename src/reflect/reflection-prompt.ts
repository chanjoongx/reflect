// src/reflect/reflection-prompt.ts: what the reflection model is asked.
//
// No I/O and no SDK: src/reflect/reflection.ts sends it through the API, and
// the plugin's mod through Claude Code's own model client (`npm run build`
// writes it into plugin/hooks/reflect.ts with the mod).

import { redactString, safeTruncate, safeTruncateEnd } from "../redact.js";

export const REFLECTION_SYSTEM = `You are reflect, a reviewer that watches a long Claude Code session from the outside.

You are called only when a separate classifier has found that the developer pushed back on the agent more than once within a few turns. You receive those turns: what the agent had just done, what the developer said next, and the words the classifier took as evidence. You do not see the rest of the session.

Your job is to name what the agent is repeatedly missing, so that the next turns stop producing the same objection. The developer's individual messages are already in the agent's context. What the agent lacks is the view across them: the thing they have in common.

How to read the turns:
- Treat the developer's words as the primary evidence and the agent's actions as context. Quote short spans when they decide the question.
- Look for the shared cause. "You changed files I did not ask about" twice is a scope problem, not two unrelated mistakes. "That's not what I meant" after two different edits may be one misunderstood requirement.
- The classifier can be wrong. A message can look like a correction and be a new instruction, a question, or a change of mind. If the turns do not share a cause, say so: set confidence low and false_trigger_likelihood high, and make the adjustment a question the agent should ask rather than a rule it should follow.
- Prefer adjustments the agent can act on in the very next turn: re-read a named file before editing it, confirm scope before touching more than one file, stop and ask before reverting, keep an explicit constraint the developer stated. Avoid generic advice such as "be more careful" or "follow instructions".
- Do not restate the developer's last message as the adjustment. They already said it; the agent already has it.
- scope is "wider_concern" only when the pattern is likely to recur in future sessions too (a project convention the agent keeps violating, for example). Otherwise "this_session".
- counter_hypothesis is the best alternative reading of the same turns under which your reflection would mislead the agent. Write it seriously: it is shown to the agent next to your adjustment.
- expires_after_turns: how many more developer turns the guidance should stay in force. Short (3 to 5) for a local misunderstanding, longer (8 to 12) for a standing constraint.

Write every field in the language the developer uses in the quoted turns. Keep each field to two sentences or fewer.`;

export interface EvidenceTurn {
  /** 1-based position among the developer's turns in this session. */
  turn: number;
  label: string;
  confidence: string;
  /** The judge's rendering of what the agent had just done. */
  priorSummary: string;
  prompt: string;
  evidence: string;
}

const EVIDENCE_PRIOR_CHARS = 1500;
const EVIDENCE_PROMPT_CHARS = 1500;

export function buildReflectionInput(turns: EvidenceTurn[], window: number, intro?: string): string {
  const lines: string[] = [
    intro ?? `The developer pushed back on ${turns.length} of their last ${window} turns. Oldest first.`,
    "",
  ];
  for (const t of turns) {
    const prior = redactString(t.priorSummary).trim();
    lines.push(
      `## Developer turn ${t.turn}: classified ${t.label} (${t.confidence} confidence)`,
      "",
      "What the agent had just done:",
      prior.length > EVIDENCE_PRIOR_CHARS ? "…" + safeTruncateEnd(prior, EVIDENCE_PRIOR_CHARS) : prior || "(nothing recorded)",
      "",
      "What the developer said next:",
      '"""',
      safeTruncate(redactString(t.prompt), EVIDENCE_PROMPT_CHARS),
      '"""',
      t.evidence ? `Classifier's evidence span: "${safeTruncate(redactString(t.evidence), 240)}"` : "",
      "",
    );
  }
  lines.push("Write the reflection.");
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
