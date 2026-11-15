// src/reflect/reflection.ts: the reflection call.
//
// v0.1 sent the model the last 20 tool calls, a rolled-back diff and the active
// rules, and asked it to guess why the developer pushed back. That input almost
// never contained the pushback itself: the detector that decided when to call
// it could not read the developer's words (bench/FINDINGS.md §3).
//
// v0.2 calls it only after the judge has found pushback, and hands it exactly
// those turns: what the agent had just done, what the developer said next, and
// the span the judge quoted as evidence. The question is no longer "did the
// developer object?" but "what is the agent repeatedly missing?".

import { makeClient, type MessagesClient } from "../api/client.js";
import { capCostUSD } from "../pricing.js";
import { redactString, safeTruncate, safeTruncateEnd } from "../redact.js";
import { parseReflection2, REFLECTION_SCHEMA, type Reflection2 } from "./schema.js";

import { DEFAULT_REFLECTION_MODEL, DEFAULT_REFLECTION_EFFORT } from "../models.js";

export { DEFAULT_REFLECTION_MODEL, DEFAULT_REFLECTION_EFFORT };

/**
 * Models that accept the server-side refusal fallback. A reflection quotes a
 * developer's code and words verbatim, which is exactly the kind of input a
 * safety classifier can misread; with `fallbacks: "default"` a decline is
 * re-run on a fallback model inside the same call instead of costing the
 * session its reflection.
 */
const FALLBACK_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
  "claude-fable-5-2",
  "claude-fable-5-1",
]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

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

const PRIOR_CHARS = 1500;
const PROMPT_CHARS = 1500;

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
      prior.length > PRIOR_CHARS ? "…" + safeTruncateEnd(prior, PRIOR_CHARS) : prior || "(nothing recorded)",
      "",
      "What the developer said next:",
      '"""',
      safeTruncate(redactString(t.prompt), PROMPT_CHARS),
      '"""',
      t.evidence ? `Classifier's evidence span: "${safeTruncate(redactString(t.evidence), 240)}"` : "",
      "",
    );
  }
  lines.push("Write the reflection.");
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

export interface ReflectionOptions {
  client?: MessagesClient;
  /** Used when no client is injected. */
  apiKey?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  /** Replaces the opening line; used by manual reflections, which are not triggered by pushback. */
  intro?: string;
}

export interface ReflectionResult {
  reflection: Reflection2;
  model: string;
  costUSD: number;
  latencyMs: number;
  cacheReadTokens: number;
}

export async function callReflection(
  turns: EvidenceTurn[],
  window: number,
  opts: ReflectionOptions = {},
): Promise<ReflectionResult> {
  const model = opts.model ?? DEFAULT_REFLECTION_MODEL;
  const client = opts.client ?? (await makeClient({ ...(opts.apiKey ? { apiKey: opts.apiKey } : {}), timeoutMs: 120_000 }));
  const input = buildReflectionInput(turns, window, opts.intro);
  const t0 = Date.now();

  const common = {
    model,
    max_tokens: opts.maxTokens ?? 8000,
    system: [
      { type: "text" as const, text: REFLECTION_SYSTEM, cache_control: { type: "ephemeral" as const } },
    ],
    messages: [{ role: "user" as const, content: input }],
  };
  const output_config = {
    effort: opts.effort ?? DEFAULT_REFLECTION_EFFORT,
    format: {
      type: "json_schema" as const,
      schema: REFLECTION_SCHEMA as unknown as Record<string, unknown>,
    },
  };

  let content: Array<{ type: string; text?: string }>;
  let stopReason: string | null;
  let usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  let servedBy: string;

  if (FALLBACK_MODELS.has(model)) {
    const res = await client.beta.messages.create({
      ...common,
      thinking: { type: "adaptive" },
      output_config,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    });
    content = res.content as Array<{ type: string; text?: string }>;
    stopReason = res.stop_reason;
    usage = res.usage;
    servedBy = res.model;
  } else {
    // Haiku 4.5 rejects both adaptive thinking and effort; everything newer
    // accepts them.
    const legacy = model.startsWith("claude-haiku-4-5");
    const res = await client.messages.create({
      ...common,
      ...(legacy ? {} : { thinking: { type: "adaptive" as const } }),
      output_config: legacy ? { format: output_config.format } : output_config,
    });
    content = res.content as Array<{ type: string; text?: string }>;
    stopReason = res.stop_reason;
    usage = res.usage;
    servedBy = res.model;
  }

  if (stopReason === "refusal") throw new Error("reflection declined by the model");
  const text = content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  if (!text.trim()) throw new Error(`reflection returned no text (stop_reason=${stopReason})`);

  const reflection = parseReflection2(text);
  const cost = capCostUSD(servedBy, {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreation5mTokens: usage.cache_creation_input_tokens ?? 0,
  });
  return {
    reflection,
    model: servedBy,
    costUSD: cost,
    latencyMs: Date.now() - t0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  };
}
