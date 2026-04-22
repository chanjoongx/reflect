// reflect — shared type definitions
// Strict TypeScript with discriminated unions for Lab Lydia + Boris exhaustive checking.

export type Confidence = "low" | "medium" | "high";
export type Scope = "this_session" | "wider_concern";
export type FalseTriggerLikelihood = "low" | "medium" | "high";
export type SignalTier = 1 | 2 | 3;
export type Effort = "low" | "medium" | "high" | "xhigh";

/**
 * Structured reflection output from Opus 4.7.
 * MUST match the JSON schema in REFLECT.md <output_schema>.
 */
export interface Reflection {
  pattern: string;
  signal: string;
  adjustment: string;
  confidence: Confidence;
  scope: Scope;
  false_trigger_likelihood: FalseTriggerLikelihood;
}

/**
 * A single revert signal observed in the session.
 */
export interface RevertSignal {
  tier: SignalTier;
  weight: number; // 1.0 / 0.7 / 0.5
  source: string; // e.g., "Bash:git restore src/foo.ts"
  turn: number; // session turn count
  timestamp: string; // ISO 8601
}

/**
 * Tool call event from PostToolUse hook input.
 */
export interface ToolCallEvent {
  session_id: string;
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: Record<string, unknown> | undefined;
  tool_use_id: string;
  cwd: string;
  permission_mode?: string;
}

/**
 * Session state persisted in .reflect/state.json.
 */
export interface SessionState {
  session_id: string;
  signals: Array<{ weight: number; turn: number }>;
  cooldown_remaining: number;
  turn_count: number;
}

/**
 * Configuration loaded from environment + defaults.
 */
export interface ReflectConfig {
  apiKey: string;
  model: string;
  effort: Effort;
  triggerThreshold: number;
  cooldownTurns: number;
  windowSize: number;
  logEnabled: boolean;
  debug: boolean;
  disabled: boolean;
  maxOutputTokens: number;
}

/**
 * 3-layer prompt content.
 */
export interface PromptLayers {
  systemL1: string; // stable, ≥ 4096 tok, TTL 1h
  contextL2: string; // medium, ~2000 tok, TTL 5m
  triggerL3: string; // ephemeral, ~3000 tok
}

/**
 * Cost breakdown for an Opus 4.7 call.
 */
export interface CallCost {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens5m: number;
  cacheCreationTokens1h: number;
  totalUSD: number;
}

/**
 * Manual trigger scope.
 */
export type TriggerScope = "session" | "recent";

/**
 * Result of a single reflection invocation.
 */
export interface ReflectionResult {
  reflection: Reflection;
  cost: CallCost;
  cacheHitRate: number;
  latencyMs: number;
  guidanceFilePath: string;
}
