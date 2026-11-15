/**
 * Viewer-local types.
 *
 * The on-disk shape is reflect 0.2's per-session event log,
 * `<project>/.reflect/sessions/<session_id>/events.jsonl`, one JSON object per
 * line. The event union mirrors `HookEvent` in `src/hook/state.ts` and the note
 * mirrors `Reflection2` in `src/reflect/schema.ts`. The Viewer is a separate
 * package, so the shapes are copied here rather than imported. Keep them in
 * step when the hook's log format changes.
 */

/** SWE-chat labels, as in `src/detect/types.ts`. */
export type Label =
  | "correction"
  | "rejection"
  | "failure_report"
  | "instruction"
  | "question"
  | "affirmation"
  | "other";

export type Level = "low" | "medium" | "high";

export type DeliveryVia = "prompt" | "tool" | "session-start" | "command";

/** A reflection note (`Reflection2`). */
export interface Note {
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

/** One line of `events.jsonl` (`HookEvent`). */
export type HookEvent =
  | { t: "prompt"; at: string; promptId: string; chars: number }
  | {
      t: "verdict";
      at: string;
      promptId: string;
      label: Label;
      confidence: Level;
      evidence: string;
      rationale: string;
      priorSummary: string;
      prompt: string;
      model: string;
      costUSD: number;
      latencyMs: number;
    }
  | { t: "skip"; at: string; promptId: string; reason: string }
  | { t: "fire"; at: string; promptId: string; evidence: string[]; policyId: string }
  | {
      t: "guidance";
      at: string;
      id: string;
      promptId: string;
      reflection: Note;
      model: string;
      costUSD: number;
      latencyMs: number;
      manual?: boolean;
    }
  | { t: "delivered"; at: string; id: string; via: DeliveryVia }
  | { t: "error"; at: string; where: string; message: string };

/** Trigger policy, as in `src/trigger/accumulator.ts`. */
export interface TriggerPolicy {
  id: string;
  k: number;
  window: number;
  cooldown: number;
  minConfidence?: Level;
}

// ─── Derived views (built in lib/session.ts) ──────────────────────────

export interface VerdictView {
  at: string;
  label: Label;
  confidence: Level;
  evidence: string;
  rationale: string;
  model: string;
  costUSD: number;
  latencyMs: number;
}

/** One developer turn: a prompt event with its verdict or skip merged in. */
export interface TurnView {
  /** 1-based developer turn, numbered the way the hook numbers it. */
  n: number;
  promptId: string;
  at: string | null;
  chars: number | null;
  /**
   * pending: after the last judged turn, so the background judge may still answer.
   * unjudged: an earlier turn the judge never answered (an error, or the hook timed out).
   */
  status: "pushback" | "judged" | "skipped" | "pending" | "unjudged";
  verdict: VerdictView | null;
  skip: { at: string; reason: string } | null;
}

export interface FireView {
  at: string;
  /** Turn the fire was recorded on. */
  turn: number | null;
  policyId: string;
  /** Turns whose pushback verdicts tripped the trigger, oldest first. */
  evidenceTurns: number[];
}

export interface DeliveryView {
  at: string;
  via: DeliveryVia;
}

export type NoteState = "waiting" | "in-force" | "expired" | "superseded";

export interface NoteView {
  id: string;
  sessionId: string;
  at: string;
  turn: number | null;
  manual: boolean;
  model: string;
  costUSD: number;
  latencyMs: number;
  note: Note;
  evidenceTurns: number[];
  deliveries: DeliveryView[];
  state: NoteState;
  /** Developer turns left while the note is in force. */
  turnsLeft: number | null;
}

export interface ErrorView {
  at: string;
  where: string;
  message: string;
}

/** Chronological feed, in log order. Verdicts and skips are folded into their turn. */
export type FeedItem =
  | { kind: "turn"; turn: TurnView }
  | { kind: "fire"; fire: FireView }
  | { kind: "note"; note: NoteView }
  | { kind: "delivery"; at: string; via: DeliveryVia; noteId: string }
  | { kind: "error"; error: ErrorView };

export interface WindowCell {
  n: number;
  status: TurnView["status"];
  label: Label | null;
  /** Counts toward the next fire. */
  counted: boolean;
  /** Inside the cooldown after a fire. */
  cooldown: boolean;
}

export interface WindowView {
  policy: TriggerPolicy;
  policySource: "env" | ".env" | "last fire" | "default";
  currentTurn: number;
  cells: WindowCell[];
  counted: number;
  cooldownLeft: number;
  pending: number;
  /** A pushback on the next turn would trip the trigger. */
  nextPushbackFires: boolean;
}

export interface SpendView {
  usd: number;
  judgeUSD: number;
  reflectionUSD: number;
  capUSD: number;
  capSource: "env" | ".env" | "default";
  stoppedAtCap: boolean;
}

export interface SessionView {
  id: string;
  firstAt: string | null;
  lastAt: string | null;
  turns: TurnView[];
  feed: FeedItem[];
  fires: FireView[];
  notes: NoteView[];
  errors: ErrorView[];
  skips: number;
  pushbacks: number;
  judged: number;
  window: WindowView;
  spend: SpendView;
  /** The note in force, or the one waiting to be delivered. */
  current: NoteView | null;
  /** The log was larger than the read limit; only its tail was read. */
  truncated: boolean;
  /** Lines that were not valid JSON or not a known event. */
  badLines: number;
}

export interface PatternCluster {
  id: string;
  label: string;
  count: number;
  synthesis: string;
  entries: NoteView[];
  shared_keywords: string[];
  frequency_sparkline: number[];
}

/** Everything a page needs, passed from server to client. */
export interface ViewerSnapshot {
  source: "live" | "fixture";
  source_label: string;
  /** `.reflect/disabled` exists, or REFLECT_DISABLED=1. */
  disabled: boolean;
  /** 0.1 files (state.json, session-log.jsonl) found next to an empty sessions/ folder. */
  legacyFiles: boolean;
  /** Newest first. */
  sessions: SessionView[];
}
