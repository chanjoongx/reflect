// src/detect/types.ts — correction-detection domain types (v2)
//
// The unit of detection is a PAIR, not an utterance. This is the direct
// consequence of evals/FINDINGS.md §5: the same string is an instruction at
// the head of a task and a correction right after an Edit. A detector that
// sees only the utterance is structurally incapable of telling them apart.

/** A tool call observed in an assistant turn. */
export interface ToolCall {
  /** `tool_use_id` from the transcript, when present. */
  id?: string;
  name: string;
  /** Best-effort target: file path for Edit/Write/Read, command for Bash. */
  target: string;
  /** True when the call mutates user state (Edit/Write/rm/git restore/...). */
  mutating: boolean;
  /** True when the tool reported an error. */
  errored: boolean;
}

/** The assistant turn immediately preceding a user prompt. */
export interface PriorTurn {
  /** Concatenated visible text the assistant produced (thinking excluded). */
  text: string;
  toolCalls: ToolCall[];
  /** ISO timestamp of the last event in the turn. */
  endedAt: string | null;
}

/**
 * (prior assistant turn, user prompt) — the relational unit a correction
 * judge operates on.
 */
export interface Pair {
  pairId: string;
  sessionId: string;
  project: string;
  /** 0-based index among real user prompts in this session. */
  promptIndex: number;
  prompt: string;
  promptAt: string | null;
  prior: PriorTurn | null;
  /** Targets touched in the last few assistant turns, most recent first. */
  recentTargets: string[];
  /** True when the prompt came from a subagent transcript. */
  sidechain: boolean;
}

// ─── Labels — SWE-chat taxonomy (arXiv 2604.20779) ────────────────────
//
// Adopted verbatim so results are directly comparable to a published
// benchmark rather than to a private schema.

export const LABELS = [
  "correction", // redirects/adds missing info without rejecting the goal
  "rejection", // explicitly reverts or refuses; asks to restart
  "failure_report", // reports the output is broken/incorrect
  "instruction", // new/continuing task spec, incl. guardrail preambles
  "question", // asks something; not steering away from prior work
  "affirmation", // approves, thanks, confirms
  "other", // pasted blob, noise, meta
] as const;

export type Label = (typeof LABELS)[number];

/** The three classes reflect should fire on. */
export const PUSHBACK_LABELS: readonly Label[] = [
  "correction",
  "rejection",
  "failure_report",
];

export function isPushback(l: Label): boolean {
  return (PUSHBACK_LABELS as readonly string[]).includes(l);
}

export interface LabeledPair {
  pairId: string;
  label: Label;
  confidence: "low" | "medium" | "high";
  /** Verbatim span from the prompt that drove the label; "" when none. */
  evidence: string;
  /** One clause of reasoning — kept for human audit, not for scoring. */
  rationale: string;
}

// ─── Stage A — structural gate ────────────────────────────────────────

export interface StructuralFeatures {
  hasPriorTurn: boolean;
  isSessionOpener: boolean;
  priorToolCount: number;
  priorMutationCount: number;
  priorErrorCount: number;
  priorAssistantChars: number;
  gapSeconds: number | null;
  promptChars: number;
  promptLines: number;
  /** Prompt mentions a path/basename the prior turn touched. */
  referencesPriorTarget: boolean;
  /** Prompt mentions a target touched in ≥2 of the last 3 turns. */
  referencesThrashTarget: boolean;
  /** Prompt looks like a pasted blob (long, low prose density). */
  looksPasted: boolean;
  /** Prompt contains a fenced code block. */
  hasCodeFence: boolean;
}

export interface GateResult {
  /** False ⇒ definitively not a correction; skip all downstream stages. */
  pass: boolean;
  /** 0..1 structural plausibility. Only meaningful when pass is true. */
  score: number;
  /** Why the gate rejected, for audit. */
  reason: string;
  features: StructuralFeatures;
}

// ─── Stage C — relational judge ───────────────────────────────────────

export interface JudgeVerdict {
  label: Label;
  confidence: "low" | "medium" | "high";
  evidence: string;
  rationale: string;
}

export interface JudgeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  latencyMs: number;
  model: string;
}

// ─── Cascade ──────────────────────────────────────────────────────────

export type CascadeStage = "gate" | "lexical" | "judge";

export interface CascadeResult {
  pairId: string;
  /** Final decision: does this prompt count as pushback? */
  pushback: boolean;
  label: Label | null;
  /** Stage that produced the final decision. */
  decidedBy: CascadeStage;
  gate: GateResult;
  lexicalHit: boolean;
  verdict: JudgeVerdict | null;
  usage: JudgeUsage | null;
}
