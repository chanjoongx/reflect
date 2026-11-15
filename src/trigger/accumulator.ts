// src/trigger/accumulator.ts: when does a run of pushback verdicts become a reflection?
//
// v0.1.4 summed weighted signals into one monotonic integer and fired at 240.
// Replayed on real sessions it never fired (evals/FINDINGS.md, bench/FINDINGS.md):
// the weights assumed a user who reverts with git, and the integer never
// decayed, so the few signals it did see were spread across hours.
//
// v0.2 counts judged pushback turns inside a sliding window of USER TURNS. One
// correction is already in front of the agent, verbatim; reflecting on it adds
// little. Two inside a short window are a pattern the agent is not seeing,
// which is the thing a reflection can name. Policies are data so that
// bench/session-sim.ts can replay every one of them over cached verdicts.

import type { Label } from "../detect/types.js";

export type Confidence = "low" | "medium" | "high";

export interface TriggerPolicy {
  id: string;
  /** Pushback turns needed inside the window. */
  k: number;
  /** Window length in user turns, counting the current one. */
  window: number;
  /** User turns after a fire during which nothing can fire. */
  cooldown: number;
  /** Verdicts below this confidence are ignored. */
  minConfidence?: Confidence;
  /** The shipped default. Exactly one policy carries it. */
  isDefault?: boolean;
}

/**
 * Candidate policies. The default was chosen by bench/session-sim.ts on the
 * 2026-08 corpus, which is in-sample; the replay table is published next to
 * it so the choice can be argued with.
 */
export const TRIGGER_POLICIES: readonly TriggerPolicy[] = Object.freeze([
  { id: "each", k: 1, window: 1, cooldown: 0 },
  { id: "k2w4", k: 2, window: 4, cooldown: 3 },
  { id: "k2w6", k: 2, window: 6, cooldown: 3, isDefault: true },
  { id: "k2w8", k: 2, window: 8, cooldown: 3 },
  { id: "k3w8", k: 3, window: 8, cooldown: 3 },
  { id: "k2w6-med", k: 2, window: 6, cooldown: 3, minConfidence: "medium" },
]);

export function defaultPolicy(): TriggerPolicy {
  const p = TRIGGER_POLICIES.find((x) => x.isDefault);
  if (!p) throw new Error("no default trigger policy");
  return p;
}

export function policyById(id: string | undefined): TriggerPolicy {
  if (!id) return defaultPolicy();
  return TRIGGER_POLICIES.find((p) => p.id === id) ?? defaultPolicy();
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export interface PushbackSignal {
  label: Label;
  confidence: Confidence;
}

export interface Fire {
  /** Ids of the turns whose verdicts tripped the trigger, oldest first. */
  evidence: string[];
  policyId: string;
}

/**
 * Pure state machine. Feed it every user turn in order, with `null` for turns
 * that were not judged or were not pushback. Deterministic, so the hook and
 * the replay agree by construction.
 */
export class Accumulator {
  private readonly policy: TriggerPolicy;
  /** Turn ordinals (0-based) and ids of retained pushback turns. */
  private hits: Array<{ turn: number; id: string }> = [];
  private turn = -1;
  private cooldownUntil = -1;

  constructor(policy: TriggerPolicy) {
    this.policy = policy;
  }

  observe(id: string, signal: PushbackSignal | null): Fire | null {
    this.turn++;
    const p = this.policy;
    const counts =
      signal !== null && RANK[signal.confidence] >= RANK[p.minConfidence ?? "low"];
    if (counts) this.hits.push({ turn: this.turn, id });
    // Drop hits that slid out of the window.
    this.hits = this.hits.filter((h) => this.turn - h.turn < p.window);

    if (this.turn <= this.cooldownUntil) return null;
    if (!counts || this.hits.length < p.k) return null;

    const fire: Fire = { evidence: this.hits.map((h) => h.id), policyId: p.id };
    this.hits = [];
    this.cooldownUntil = this.turn + p.cooldown;
    return fire;
  }
}
