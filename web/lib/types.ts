/**
 * Viewer-local types.
 *
 * Ground truth is the on-disk shape written by `hooks/reflect-trigger.sh` +
 * `src/logger.ts` + `src/guidance-injector.ts` — NOT `src/types.ts`
 * (pre-existing code/type drift, see BRAIN-CHECKSUM.md T1.3).
 *
 * Keep this file minimal + local. Never import from ../../src/types.
 */

/** `.reflect/state.json` — written by hooks/reflect-trigger.sh */
export interface ViewerSessionState {
  session_id: string;
  turn_count: number;
  /** Integer ×100 accumulator (shell-safe arithmetic). Threshold = 240. */
  cum_x100: number;
  cooldown_remaining: number;
}

/** `.reflect/recent-calls.jsonl` — one per PostToolUse hook fire. */
export interface RecentCall {
  turn: number;
  tool: string;
  /** 0 = non-revert, 1 = hard revert (+100), 2 = inferred (+70), 3 = utterance (+50) */
  tier: 0 | 1 | 2 | 3;
  input_summary: string;
  timestamp: string;
}

/** Reflection structured output from Opus 4.7. */
export interface Reflection {
  pattern: string;
  signal: string;
  adjustment: string;
  confidence: "low" | "medium" | "high";
  scope: "this_session" | "wider_concern";
  false_trigger_likelihood: "low" | "medium" | "high";
}

/** API call cost metadata. */
export interface CallCost {
  usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** `.reflect/session-log.jsonl` — one per reflection fire. Primary data source. */
export interface LogEntry {
  timestamp: string;
  session_id: string;
  reflection: Reflection;
  cost: CallCost;
  cache_hit_rate: number;
  latency_ms: number;
  trigger_meta: {
    sum_weight: number;
    signal_tiers: number[];
  };
  next_turn_acted_on_adjustment?: boolean;
  next_turn_summary?: string;
}

/** Parsed `.reflect/session-guidance.md` — single live reflection. */
export interface ActiveGuidance {
  last_triggered: string;
  reflection: Reflection;
}

/** Pattern cluster derived from N reflections (client-side analysis). */
export interface PatternCluster {
  id: string;
  label: string;
  count: number;
  synthesis: string;
  entries: LogEntry[];
  shared_keywords: string[];
  frequency_sparkline: number[];
}

/** Viewer-wide data snapshot passed from Server → Client. */
export interface ViewerSnapshot {
  state: ViewerSessionState | null;
  recent_calls: RecentCall[];
  active_guidance: ActiveGuidance | null;
  log: LogEntry[];
  source: "live" | "fixture";
  source_label: string;
}
