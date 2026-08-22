// src/detect/structural.ts — Stage A: the structural gate.
//
// Language-free by construction. It never looks at what the words MEAN, only
// at where the prompt sits relative to what the assistant just did. This is
// the mechanised form of evals/FINDINGS.md §5:
//
//     "수정하지 마라"  at the head of a new task  → instruction
//     "수정하지 마"    right after an Edit        → correction
//
// Same string, opposite meaning; the disambiguator is position, not vocabulary.
// Because it reads no words, it generalises to every language for free —
// which is precisely what the shipped regex could not do.

import type { GateResult, Pair, StructuralFeatures } from "./types.js";
import { targetTokens } from "../transcript/parse.js";

// ─── Tunables ─────────────────────────────────────────────────────────

export const LONG_PROMPT_CHARS = 1200;
export const MEDIUM_PROMPT_CHARS = 500;
export const FAST_REPLY_SECONDS = 120;
export const STALE_GAP_SECONDS = 1800;
export const PASTED_LINE_CHARS = 220;

/**
 * Hand-specified log-odds priors. These are DESIGN PRIORS, not fitted
 * parameters: fitting them on a single user's corpus would overfit to that
 * user's habits, which is the exact failure the shipped regex already made.
 * `bench` reports a cross-validated logistic fit alongside these so the
 * headroom left on the table is visible rather than assumed.
 *
 * Intercept is the logit of SWE-chat's measured 39% turn-level pushback rate.
 */
export const WEIGHTS = {
  intercept: -0.45,
  priorMutation: 1.1,
  priorError: 0.6,
  referencesPriorTarget: 0.9,
  referencesThrashTarget: 0.45,
  fastReply: 0.35,
  staleGap: -0.4,
  longPrompt: -1.3,
  mediumPrompt: -0.55,
  looksPasted: -0.7,
  silentPriorTurn: -0.5,
} as const;

// ─── Feature extraction ───────────────────────────────────────────────

const CODE_FENCE = /```|~~~/;
/** Claude Code transcript UI glyphs — a reliable tell for pasted output. */
const UI_PASTE_GLYPHS = /[●⎿⏺│├└]/;

function looksPastedBlob(prompt: string, lines: string[]): boolean {
  if (UI_PASTE_GLYPHS.test(prompt)) return true;
  if (prompt.length < 400) return false;
  if (lines.some((l) => l.length > PASTED_LINE_CHARS)) return true;
  // Low prose density: mostly symbols/digits rather than words.
  const wordish = (prompt.match(/[A-Za-z가-힣]{2,}/g) ?? []).join("").length;
  return wordish / prompt.length < 0.35;
}

function secondsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return (tb - ta) / 1000;
}

export function extractFeatures(pair: Pair): StructuralFeatures {
  const prompt = pair.prompt;
  const lines = prompt.split("\n");
  const lower = prompt.toLowerCase();
  const prior = pair.prior;

  const priorTargets = prior ? prior.toolCalls.map((c) => c.target) : [];
  const referencesPriorTarget = priorTargets.some((t) =>
    targetTokens(t).some((tok) => lower.includes(tok)),
  );

  // A target is "thrashing" when it recurs across the recent-turn window.
  const counts = new Map<string, number>();
  for (const t of pair.recentTargets) {
    for (const tok of targetTokens(t)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  const referencesThrashTarget = [...counts.entries()].some(
    ([tok, n]) => n >= 2 && lower.includes(tok),
  );

  return {
    hasPriorTurn: prior !== null,
    isSessionOpener: pair.promptIndex === 0,
    priorToolCount: prior?.toolCalls.length ?? 0,
    priorMutationCount: prior?.toolCalls.filter((c) => c.mutating).length ?? 0,
    priorErrorCount: prior?.toolCalls.filter((c) => c.errored).length ?? 0,
    priorAssistantChars: prior?.text.length ?? 0,
    gapSeconds: secondsBetween(prior?.endedAt ?? null, pair.promptAt),
    promptChars: prompt.length,
    promptLines: lines.length,
    referencesPriorTarget,
    referencesThrashTarget,
    looksPasted: looksPastedBlob(prompt, lines),
    hasCodeFence: CODE_FENCE.test(prompt),
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Linear score in log-odds space, from the documented design priors. */
export function scoreFeatures(f: StructuralFeatures, w = WEIGHTS): number {
  let z = w.intercept;
  if (f.priorMutationCount > 0) z += w.priorMutation;
  if (f.priorErrorCount > 0) z += w.priorError;
  if (f.referencesPriorTarget) z += w.referencesPriorTarget;
  if (f.referencesThrashTarget) z += w.referencesThrashTarget;
  if (f.gapSeconds !== null && f.gapSeconds < FAST_REPLY_SECONDS) z += w.fastReply;
  if (f.gapSeconds !== null && f.gapSeconds > STALE_GAP_SECONDS) z += w.staleGap;
  if (f.promptChars > LONG_PROMPT_CHARS) z += w.longPrompt;
  else if (f.promptChars > MEDIUM_PROMPT_CHARS) z += w.mediumPrompt;
  if (f.looksPasted) z += w.looksPasted;
  if (f.priorToolCount === 0 && f.priorAssistantChars < 200) z += w.silentPriorTurn;
  return sigmoid(z);
}

/**
 * The gate. `pass: false` is a structural impossibility claim, not a low
 * score — downstream stages are skipped entirely, so every false here is a
 * recall loss that can never be recovered.
 *
 * There is exactly ONE hard rule: no prior assistant turn. An earlier version
 * advertised two, adding `session_opener`, but that branch was unreachable —
 * a session's first prompt has no prior turn by construction, so the first
 * test always shadowed it. It fired once in 836 real pairs. Claiming two rules
 * where one exists overstates what the gate does, so the dead branch is gone
 * and the reason string now distinguishes the two populations INSIDE the one
 * rule: session openers, and mid-session consecutive user messages, which are
 * the genuinely interesting slice (a correction can target work from two turns
 * back, and this gate cannot see it).
 */
export function structuralGate(pair: Pair): GateResult {
  const features = extractFeatures(pair);

  if (!features.hasPriorTurn) {
    return {
      pass: false,
      score: 0,
      reason: features.isSessionOpener ? "session_opener" : "consecutive_user_message",
      features,
    };
  }

  return {
    pass: true,
    score: scoreFeatures(features),
    reason: "pass",
    features,
  };
}

/**
 * The TEN terms the hand priors actually use, in `WEIGHTS` order.
 *
 * A fitted model given more inputs than the hand model is not a measurement of
 * "better weights on the same features" — it is a different model. An earlier
 * version compared 10 hand-set weights against a 13-input fit and described
 * them as the same features; roughly a quarter of the apparent headroom was
 * three extra inputs. This vector is the like-for-like comparison, and
 * `EXTENDED_FEATURE_NAMES` is what three more inputs buy on top of it.
 */
export const FEATURE_NAMES = [
  "priorMutation",
  "priorError",
  "refPriorTarget",
  "refThrashTarget",
  "fastReply",
  "staleGap",
  "longPrompt",
  "mediumPrompt",
  "looksPasted",
  "silentPrior",
] as const;

export const EXTRA_FEATURE_NAMES = ["hasCodeFence", "logPromptChars", "logPriorTools"] as const;

export const EXTENDED_FEATURE_NAMES = [...FEATURE_NAMES, ...EXTRA_FEATURE_NAMES] as const;

/** Exactly the inputs `scoreFeatures` reads, one-for-one with WEIGHTS. */
export function featureVector(f: StructuralFeatures): number[] {
  return [
    f.priorMutationCount > 0 ? 1 : 0,
    f.priorErrorCount > 0 ? 1 : 0,
    f.referencesPriorTarget ? 1 : 0,
    f.referencesThrashTarget ? 1 : 0,
    f.gapSeconds !== null && f.gapSeconds < FAST_REPLY_SECONDS ? 1 : 0,
    f.gapSeconds !== null && f.gapSeconds > STALE_GAP_SECONDS ? 1 : 0,
    f.promptChars > LONG_PROMPT_CHARS ? 1 : 0,
    f.promptChars > MEDIUM_PROMPT_CHARS && f.promptChars <= LONG_PROMPT_CHARS ? 1 : 0,
    f.looksPasted ? 1 : 0,
    f.priorToolCount === 0 && f.priorAssistantChars < 200 ? 1 : 0,
  ];
}

/** The hand-prior inputs plus three the hand model does not have. */
export function extendedFeatureVector(f: StructuralFeatures): number[] {
  return [
    ...featureVector(f),
    f.hasCodeFence ? 1 : 0,
    Math.log1p(f.promptChars) / 8,
    Math.log1p(f.priorToolCount) / 4,
  ];
}
