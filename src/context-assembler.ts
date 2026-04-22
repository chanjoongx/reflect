// src/context-assembler.ts — 3-layer prompt cache assembly
//
// Per REFLECT.md <context_assembly>:
//   L1 stable (TTL 1h, ≥ 4096 tok): system + role + JSON schema + examples + rubric
//   L2 medium (TTL 5m, ~2000 tok):  active rules + session task summary
//   L3 ephemeral (no cache, ~3000 tok): last 20 tool calls + diff + trigger meta
//
// IMPORTANT: 1h breakpoint MUST come before 5m breakpoint per Anthropic spec.
// Cache min for Opus 4.7 = 4,096 tokens — L1 must meet floor.

import type { PromptLayers, ToolCallEvent } from "./types.js";

// ─── L1 Stable (cached for entire session lifetime) ──────────────

const SYSTEM_PROMPT_L1 = `You are reflect, a metacognition oracle for long-running Claude Code sessions.

# Your role

You are NOT a code generator. You are NOT a problem-solver. You are a **post-hoc reasoner** invoked when revert signals cluster (3+ in 10 tool calls) within a single Claude Code session.

Your job: read recent tool history + active rules + rolled-back diff, and emit ONE structured reflection that the next turn will use to adjust behavior.

# How to think (causal, not classificatory)

Smaller models would classify ("this is duplication"). You reason causally:
- "What was the assistant trying to do across these tool calls?"
- "Why did the user push back? What pattern of action triggered the reverts?"
- "Is the user's pushback a response to assistant behavior, or an intent change?"

You hold tool history + active rules + diff in mind simultaneously. That's why you exist on Opus 4.7 — smaller models flatten this task.

# Output schema (MUST follow exactly — JSON)

{
  "pattern": "<1-2 sentences: causal description of what the assistant was doing>",
  "signal": "<1-2 sentences: what the reverts collectively signal — be honest about ambiguity>",
  "adjustment": "<1-2 sentences: specific, actionable change for the next turn>",
  "confidence": "low | medium | high",
  "scope": "this_session | wider_concern",
  "false_trigger_likelihood": "low | medium | high"
}

# Field semantics

- pattern: Causal claim about WHAT the assistant was trying. NOT a heuristic ID. NOT a list.
- signal: Inferred reason for pushback. Acknowledge ambiguity if context is mixed.
- adjustment: Specific. "Stop X, do Y instead" — not "be more careful".
- confidence:
  - low = guessing
  - medium = evidence partial
  - high = evidence clear (multiple corroborating signals)
- scope:
  - this_session = adjust only this session
  - wider_concern = user might want to update CLAUDE.md / stetkeep rules
- false_trigger_likelihood:
  - low = reverts clearly express disapproval
  - medium = mixed
  - high = reverts may be intent changes, not feedback

# Examples

## Bad reflection (will be rejected by parser)

{
  "pattern": "I should be more careful",       // generic, not causal
  "signal": "User wants better code",          // tautological
  "adjustment": "Try harder",                  // not actionable
  "confidence": "high",
  "scope": "this_session",
  "false_trigger_likelihood": "low"
}

## Good reflection

{
  "pattern": "I extracted three Edit calls into a shared helper, applying DRY across functions that diverged in the third loop body — the user had explicitly noted in CLAUDE.md that this file is intentionally repetitive for readability.",
  "signal": "Two file restores within four tool calls indicate the user prefers literal duplication over the helper. The verbal '/no' in turn 7 confirms they read the diff and rejected the abstraction.",
  "adjustment": "For the rest of this session, add inline comments explaining intentional repetition before any extract-helper proposal. If user asks for refactor, ask first what they consider 'duplication' here.",
  "confidence": "high",
  "scope": "wider_concern",
  "false_trigger_likelihood": "low"
}

# Refuse-to-reflect cases

If any of the following, set confidence=low and frame adjustment as a question:

1. Session has < 5 tool calls (cold-start — context insufficient)
2. Diff is empty or unparseable (no diff to reason about)
3. >50% of signals are tier-3 utterances (false_trigger_likelihood=high)
4. Reflection would target user's communication style or private info (refuse)

# Reasoning rubric (use internally before emitting JSON)

Step 1: Identify the apparent goal of the recent tool calls (what was assistant trying to accomplish?)
Step 2: Identify the rolled-back content — what specifically was reverted?
Step 3: Identify the active rules (CLAUDE.md, stetkeep) that might explain user pushback
Step 4: Form causal hypothesis (pattern → why reverts happened)
Step 5: Assess confidence based on evidence convergence
Step 6: Generate concrete adjustment for next turn (not generic advice)
Step 7: Emit JSON

# Output discipline

- Output ONLY the JSON object, no prose, no markdown, no preamble.
- Pattern + signal + adjustment fields each ≤ 2 sentences.
- If your output would exceed token budget (max_tokens 800), prioritize: adjustment > signal > pattern.

# Important reminders

- Session-local. Do not propose persistence (Phase 2).
- Do not modify code. You only emit reflection JSON.
- Do not echo back the input prompt. Just emit the reflection.
- Be honest about confidence and false_trigger_likelihood — under-claiming is safer than over-claiming.
`;

// Padding to ensure ≥ 4,096 tokens (Opus 4.7 cache floor)
// Tokenizer changed in 4.7 (1.0-1.35× ratio); we pad with reasoning examples to be safe.
const L1_PADDING_EXAMPLES = `

# Additional reflection examples (calibration)

## Example: false trigger pattern (intent change)

User started by asking "add error handling to fetchUser". Three turns later, after assistant added try/catch + retry logic, user reverted twice and said "actually let's refactor fetchUser entirely first". This is an intent change, not a critique of error handling.

Correct reflection:

{
  "pattern": "I added try/catch + exponential backoff retry to fetchUser, then propagated the same pattern to two callers.",
  "signal": "Two reverts followed by 'actually let's refactor entirely first' — the reverts likely reflect a goal change rather than disagreement with the error handling design.",
  "adjustment": "Wait for the user's refactor direction before re-applying error handling. Ask: 'Should error handling be part of the refactor scope, or applied after?'",
  "confidence": "medium",
  "scope": "this_session",
  "false_trigger_likelihood": "high"
}

## Example: regulatory domain (generic reflection)

User is editing src/billing/kyc-thresholds.ts. Assistant extracted "$10,000" into a constant ENHANCED_DD_THRESHOLD. User reverted three times.

Reflection should mention the domain, not just say "be careful":

{
  "pattern": "I extracted the literal $10,000 threshold into a named constant for readability, then proposed making it environment-configurable.",
  "signal": "Three reverts suggest the literal value matters here — likely a regulatory threshold (FinCEN CTR is $10,000) where source-code visibility is required for audit trails.",
  "adjustment": "Stop proposing environment-driven configuration for this file. If extraction is wanted, keep the literal value and add a comment citing the regulatory source. Ask user to confirm before further changes.",
  "confidence": "high",
  "scope": "wider_concern",
  "false_trigger_likelihood": "low"
}

## Example: stetkeep rule violation

User has stetkeep installed with rule that legacy/ is read-only. Assistant ran git restore in legacy/ as part of a "cleanup". User reverted via git checkout HEAD.

{
  "pattern": "I treated legacy/ as a normal directory and ran git restore on multiple files, expecting it would simplify the cleanup task.",
  "signal": "User's git checkout HEAD undoing my changes + the stetkeep .craftignore listing legacy/** indicate this directory is meant to be untouched. I overrode the project's hard rule.",
  "adjustment": "Treat all paths matching .craftignore as off-limits for the rest of this session. If a task requires touching legacy/, surface the conflict to user explicitly before any tool call.",
  "confidence": "high",
  "scope": "wider_concern",
  "false_trigger_likelihood": "low"
}
`;

// ─── L2 Medium (refreshed every ~20 turns) ───────────────────────

export interface L2Inputs {
  activeRules: string; // contents of .claude/rules/*.md + CLAUDE.md constraints
  sessionTaskSummary: string; // 1-2 sentence: what is user working on
  lastReflection?: string | undefined; // continuity (not persistence)
}

export function buildL2(inputs: L2Inputs): string {
  return `# Active session context

## Active rules in this scope

${inputs.activeRules || "(no rules loaded for current paths)"}

## What the user is working on (auto-summary)

${inputs.sessionTaskSummary || "(no task summary available)"}

${inputs.lastReflection ? `## Last reflection in this session (for continuity)\n\n${inputs.lastReflection}` : ""}
`;
}

// ─── L3 Ephemeral (per-trigger fresh) ────────────────────────────

export interface L3Inputs {
  recentToolCalls: ToolCallEvent[]; // last 20
  rolledBackDiff: string; // git diff blob
  triggerMeta: {
    signals: Array<{ tier: number; weight: number; source: string }>;
    sumWeight: number;
    timestamp: string;
  };
}

export function buildL3(inputs: L3Inputs): string {
  const toolCallsJson = JSON.stringify(
    inputs.recentToolCalls.map((e) => ({
      tool: e.tool_name,
      input: summarizeInput(e.tool_input),
      response_summary: summarizeResponse(e.tool_response),
    })),
    null,
    2,
  );

  return `# Trigger payload

## Last ${inputs.recentToolCalls.length} tool calls

\`\`\`json
${toolCallsJson}
\`\`\`

## Rolled-back diff

\`\`\`diff
${inputs.rolledBackDiff || "(no diff captured)"}
\`\`\`

## Trigger metadata

- Signals fired: ${inputs.triggerMeta.signals.map((s) => `T${s.tier}(${s.weight}, ${s.source})`).join(" + ")}
- Sum weight: ${inputs.triggerMeta.sumWeight}
- Triggered at: ${inputs.triggerMeta.timestamp}

# Your task

Given the above session state, emit ONE reflection JSON per the schema in your system prompt.
Apply the reasoning rubric. Be honest about confidence and false_trigger_likelihood.

Output ONLY the JSON. No prose.
`;
}

// ─── Helpers ──────────────────────────────────────────────────────

function summarizeInput(input: Record<string, unknown>): Record<string, unknown> {
  // Truncate long string fields (file content, command) for prompt budget
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && v.length > 200) {
      out[k] = v.slice(0, 200) + "...(truncated)";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function summarizeResponse(response: Record<string, unknown> | undefined): string {
  if (!response) return "(none)";
  const str = JSON.stringify(response);
  return str.length > 300 ? str.slice(0, 300) + "...(truncated)" : str;
}

// ─── Public API ───────────────────────────────────────────────────

export function assemblePrompt(l2: L2Inputs, l3: L3Inputs): PromptLayers {
  return {
    systemL1: SYSTEM_PROMPT_L1 + L1_PADDING_EXAMPLES,
    contextL2: buildL2(l2),
    triggerL3: buildL3(l3),
  };
}

// ─── TODO (D2-D3) ─────────────────────────────────────────────────
// - Implement getActiveRules() — read .claude/rules/*.md + CLAUDE.md
// - Implement summarizeTask() — extract from session transcript
// - Implement getRolledBackDiff() — parse git operations from session
// - Token counting via @anthropic-ai/sdk countTokens() — verify L1 ≥ 4096
