// src/reflect/schema.ts: what a v0.2 reflection is.
//
// v0.1 asked for {pattern, signal, adjustment, confidence, scope,
// false_trigger_likelihood} and parsed it out of free text with a fence regex.
// v0.2 keeps those six fields, adds three that make a reflection checkable
// rather than merely confident, and gets them through structured output.
//
//   counter_hypothesis  the strongest reading under which this reflection is
//                       wrong. Self-reflection systems that skip this lock in
//                       a bad generalisation and stop collecting the evidence
//                       that would overturn it (the ExpeL failure mode).
//   verify              one cheap check the agent can run before applying the
//                       adjustment.
//   expires_after_turns guidance is about this stretch of work, not forever.

export type Level = "low" | "medium" | "high";

export interface Reflection2 {
  pattern: string;
  signal: string;
  adjustment: string;
  confidence: Level;
  scope: "this_session" | "wider_concern";
  false_trigger_likelihood: Level;
  counter_hypothesis: string;
  verify: string;
  expires_after_turns: number;
}

export const MIN_EXPIRY_TURNS = 3;
export const MAX_EXPIRY_TURNS = 12;
export const DEFAULT_EXPIRY_TURNS = 8;

export const REFLECTION_SCHEMA = {
  type: "object",
  properties: {
    pattern: {
      type: "string",
      description: "What the agent kept doing across the pushback turns, stated causally. Two sentences at most.",
    },
    signal: {
      type: "string",
      description: "What the developer was objecting to, in their terms, citing the turns.",
    },
    adjustment: {
      type: "string",
      description: "One concrete change the agent should make for the rest of this session. Imperative, specific, checkable.",
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    scope: { type: "string", enum: ["this_session", "wider_concern"] },
    false_trigger_likelihood: { type: "string", enum: ["low", "medium", "high"] },
    counter_hypothesis: {
      type: "string",
      description: "The strongest reading of the same turns under which this reflection is wrong.",
    },
    verify: {
      type: "string",
      description: "One cheap check the agent can make before applying the adjustment (re-read a file, ask one question, run one test).",
    },
    expires_after_turns: {
      type: "integer",
      description: "How many more developer turns this guidance should stay in force, between 3 and 12.",
    },
  },
  required: [
    "pattern",
    "signal",
    "adjustment",
    "confidence",
    "scope",
    "false_trigger_likelihood",
    "counter_hypothesis",
    "verify",
    "expires_after_turns",
  ],
  additionalProperties: false,
} as const;

const LEVELS = new Set(["low", "medium", "high"]);

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Validate and clamp. Structured output is a server-side contract; this is the
 * client-side check that the contract held, because a harness that trusts what
 * it has not checked is how v0.1's parser survived as long as it did.
 */
export function parseReflection2(text: string): Reflection2 {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.trim()) as Record<string, unknown>;
  } catch {
    throw new Error(`reflection was not JSON: ${text.slice(0, 160)}`);
  }
  if (!obj || typeof obj !== "object") throw new Error("reflection was not an object");
  const level = (v: unknown, name: string): Level => {
    if (typeof v === "string" && LEVELS.has(v)) return v as Level;
    throw new Error(`reflection field ${name} out of enum: ${String(v)}`);
  };
  const scope = obj["scope"] === "wider_concern" ? "wider_concern" : "this_session";
  const rawExpiry = Number(obj["expires_after_turns"]);
  const expiry = Number.isFinite(rawExpiry)
    ? Math.min(MAX_EXPIRY_TURNS, Math.max(MIN_EXPIRY_TURNS, Math.round(rawExpiry)))
    : DEFAULT_EXPIRY_TURNS;
  const r: Reflection2 = {
    pattern: str(obj["pattern"], 600),
    signal: str(obj["signal"], 600),
    adjustment: str(obj["adjustment"], 600),
    confidence: level(obj["confidence"], "confidence"),
    scope,
    false_trigger_likelihood: level(obj["false_trigger_likelihood"], "false_trigger_likelihood"),
    counter_hypothesis: str(obj["counter_hypothesis"], 400),
    verify: str(obj["verify"], 300),
    expires_after_turns: expiry,
  };
  if (!r.adjustment) throw new Error("reflection has no adjustment");
  return r;
}
