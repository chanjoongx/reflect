// src/revert-detector.ts — 3-tier revert signal taxonomy (REFERENCE IMPL)
//
// ⚠ IMPLEMENTATION STATUS (D4 2026-04-24):
//   This is a TypeScript reference implementation of the full 3-tier taxonomy.
//   The PRODUCTION hook (hooks/reflect-trigger.sh / .ps1) does NOT call into this
//   module — it implements a subset directly in shell. Divergences:
//
//     - File delete: this file classifies as Tier 1 w=1.0; production shell
//       classifies as Tier 2 +70 (build-artifact-excluding heuristic). The
//       shell behavior is canonical per ARCHITECTURE.md §4.
//     - Tier 2 Edit→Edit semantic inversion: only implemented here (detectTier2).
//       The production shell never calls this — Tier 2 inversion does NOT
//       contribute to the threshold in v1.
//     - /undo slash command: documented in this file's comments but matched
//       by neither this module nor the production shell.
//     - shouldTrigger() uses a strict 10-call sliding window; production shell
//       uses a monotonic accumulator that resets on fire (simpler, no window).
//
// This module is retained for: (1) tests (once we add them), (2) as the
// future wiring target when v1.1 deep-reflect mode ships, (3) documenting
// the full-fidelity taxonomy that v1 partially implements.
//
// Per REFLECT.md <trigger_specification> (full v1.1 taxonomy):
//   Tier 1 (hard, weight 1.0):    git revert / restore / checkout HEAD --
//   Tier 2 (inferred, weight 0.7): rm/unlink user path (v1 shell);
//                                  Edit→Edit inversion (v1.1 aspiration, here only)
//   Tier 3 (soft, weight 0.5):    user utterance regex (UserPromptSubmit hook)

import type {
  RevertSignal,
  SignalTier,
  ToolCallEvent,
  SessionState,
} from "./types.js";

// ─── Constants ─────────────────────────────────────────────────────

export const TIER_WEIGHTS: Record<SignalTier, number> = {
  1: 1.0,
  2: 0.7,
  3: 0.5,
};

export const DEFAULT_THRESHOLD = 2.4;
export const DEFAULT_COOLDOWN_TURNS = 5;
export const DEFAULT_WINDOW_SIZE = 10;

// ─── Tier 1 detectors ─────────────────────────────────────────────

const TIER_1_BASH_PATTERNS = [
  /^git\s+revert\s+/,
  /^git\s+restore\s+/,
  /^git\s+checkout\s+HEAD\s+--\s+/,
];

const TIER_1_FILE_DELETE_PATTERN = /^(rm|unlink)\s+(?!-rf?\s+(node_modules|dist|build|\.next))/;

export function detectTier1(event: ToolCallEvent): RevertSignal | null {
  if (event.tool_name !== "Bash") return null;

  const cmd = (event.tool_input["command"] ?? "") as string;
  if (!cmd) return null;

  const isRevert = TIER_1_BASH_PATTERNS.some((p) => p.test(cmd));
  const isDelete = TIER_1_FILE_DELETE_PATTERN.test(cmd);

  if (isRevert || isDelete) {
    return {
      tier: 1,
      weight: TIER_WEIGHTS[1],
      source: `Bash:${cmd.slice(0, 100)}`,
      turn: 0, // filled by caller
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

// ─── Tier 2 detectors ─────────────────────────────────────────────

/**
 * Detect Edit→Edit semantic inversion on the same file path
 * within the last N turns. Heuristic: if a recent Edit reverses
 * a string change, count as Tier 2.
 *
 * For v1 we use a simple heuristic: if the new edit's `new_string`
 * resembles an earlier edit's `old_string`, signal.
 */
export function detectTier2(
  event: ToolCallEvent,
  recentEdits: Array<{
    path: string;
    oldString: string;
    newString: string;
    turn: number;
  }>,
  currentTurn: number,
  lookbackTurns = 5,
): RevertSignal | null {
  if (event.tool_name !== "Edit") return null;

  const path = (event.tool_input["file_path"] ?? "") as string;
  const newString = (event.tool_input["new_string"] ?? "") as string;
  if (!path || !newString) return null;

  // Look for inversion in recent edits on same path
  const recent = recentEdits.filter(
    (e) => e.path === path && currentTurn - e.turn <= lookbackTurns,
  );

  for (const prev of recent) {
    // Inversion heuristic: new edit's new_string ~= prev edit's old_string
    if (
      simpleSimilarity(newString.trim(), prev.oldString.trim()) > 0.85 &&
      newString.trim() !== prev.newString.trim()
    ) {
      return {
        tier: 2,
        weight: TIER_WEIGHTS[2],
        source: `Edit:inversion:${path}`,
        turn: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  return null;
}

// ─── Tier 3 detectors ─────────────────────────────────────────────

const TIER_3_NEGATION_REGEX =
  /\b(no|undo|stop|wrong|revert|nope|nah|don't|do not|that's not|not what)\b/i;

const TIER_3_POSITIVE_NEGATION = /\b(I see why you said|I understand the no|fair point)\b/i;

export function detectTier3(userMessage: string): RevertSignal | null {
  if (!userMessage) return null;
  if (TIER_3_POSITIVE_NEGATION.test(userMessage)) return null;
  if (!TIER_3_NEGATION_REGEX.test(userMessage)) return null;

  return {
    tier: 3,
    weight: TIER_WEIGHTS[3],
    source: `Utterance:${userMessage.slice(0, 80)}`,
    turn: 0,
    timestamp: new Date().toISOString(),
  };
}

// ─── Threshold logic ──────────────────────────────────────────────

export function shouldTrigger(
  state: SessionState,
  threshold = DEFAULT_THRESHOLD,
  windowSize = DEFAULT_WINDOW_SIZE,
): boolean {
  if (state.cooldown_remaining > 0) return false;

  const windowStart = state.turn_count - windowSize;
  const recentSignals = state.signals.filter((s) => s.turn > windowStart);
  const sum = recentSignals.reduce((acc, s) => acc + s.weight, 0);

  return sum >= threshold;
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Naive similarity for Tier 2 inversion detection.
 * Production version would use Levenshtein or AST diff.
 */
function simpleSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  // Simple normalized character overlap
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }
  return matches / longer.length;
}

// ─── TODO (D2-D3) ─────────────────────────────────────────────────
// - Tier 2: more robust inversion (token-based diff)
// - Add unit tests with fixture tool call events
// - Integrate with hook state.json (currently hook does basic detection;
//   this file provides richer logic invoked by bin/reflect.ts trigger handler)
