/**
 * Turns one session's event log into the views the pages render.
 *
 * Pure functions, no file access. The rules follow `src/hook/run.ts`:
 *   - developer turns are numbered by first `prompt` event (`promptOrder`)
 *   - spend is the sum of `costUSD` on `verdict` and `guidance` events
 *   - a note is in force from its first `delivered` event for
 *     `expires_after_turns` developer turns (`activeGuidance`), and waiting
 *     while it has no `delivered` event (`pendingGuidance`)
 * and the trigger follows `src/trigger/accumulator.ts`: pushback turns inside
 * a sliding window of `window` turns, cleared by a fire, then `cooldown`
 * turns in which nothing fires.
 */

import type {
  ErrorView,
  FeedItem,
  FireView,
  HookEvent,
  Label,
  Level,
  NoteView,
  SessionView,
  SpendView,
  TriggerPolicy,
  TurnView,
  ViewerSnapshot,
  WindowCell,
  WindowView,
} from "./types";

export const PUSHBACK_LABELS: readonly Label[] = ["correction", "rejection", "failure_report"];

export function isPushback(label: Label): boolean {
  return PUSHBACK_LABELS.includes(label);
}

export const TRIGGER_POLICIES: readonly TriggerPolicy[] = [
  { id: "each", k: 1, window: 1, cooldown: 0 },
  { id: "k2w4", k: 2, window: 4, cooldown: 3 },
  { id: "k2w6", k: 2, window: 6, cooldown: 3 },
  { id: "k2w8", k: 2, window: 8, cooldown: 3 },
  { id: "k3w8", k: 3, window: 8, cooldown: 3 },
  { id: "k2w6-med", k: 2, window: 6, cooldown: 3, minConfidence: "medium" },
];

export const DEFAULT_POLICY_ID = "k2w6";
export const DEFAULT_CAP_USD = 0.5;

export function policyById(id: string | undefined): TriggerPolicy | null {
  if (!id) return null;
  return TRIGGER_POLICIES.find((p) => p.id === id) ?? null;
}

const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };

/** Settings the hook reads from its environment; the Viewer sees only what is in its own env or the project's `.env`. */
export interface ViewerConfig {
  policyId?: { value: string; source: "env" | ".env" };
  capUSD?: { value: number; source: "env" | ".env" };
}

type Ev<T extends HookEvent["t"]> = Extract<HookEvent, { t: T }>;

/** Accepts a parsed line only if it has the fields the views read. */
export function asEvent(v: unknown): HookEvent | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  const s = (k: string) => typeof e[k] === "string";
  const n = (k: string) => typeof e[k] === "number" && Number.isFinite(e[k]);
  if (!s("t") || !s("at")) return null;
  switch (e.t) {
    case "prompt":
      return s("promptId") ? (e as unknown as HookEvent) : null;
    case "verdict":
      return s("promptId") && s("label") && s("confidence") && n("costUSD")
        ? ({ evidence: "", rationale: "", priorSummary: "", prompt: "", model: "", latencyMs: 0, ...e } as unknown as HookEvent)
        : null;
    case "skip":
      return s("promptId") && s("reason") ? (e as unknown as HookEvent) : null;
    case "fire":
      return s("promptId") && Array.isArray(e.evidence) && s("policyId") ? (e as unknown as HookEvent) : null;
    case "guidance": {
      const r = e.reflection as Record<string, unknown> | undefined;
      if (!s("id") || !s("promptId") || !n("costUSD") || !r || typeof r !== "object") return null;
      if (typeof r.adjustment !== "string" || typeof r.confidence !== "string") return null;
      return {
        model: "",
        latencyMs: 0,
        ...e,
        reflection: {
          pattern: "",
          signal: "",
          scope: "this_session",
          false_trigger_likelihood: "medium",
          counter_hypothesis: "",
          verify: "",
          expires_after_turns: 8,
          ...r,
        },
      } as unknown as HookEvent;
    }
    case "delivered":
      return s("id") && s("via") ? (e as unknown as HookEvent) : null;
    case "error":
      return s("where") && s("message") ? (e as unknown as HookEvent) : null;
    default:
      return null;
  }
}

function promptOrder(events: HookEvent[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const e of events) {
    if (e.t === "prompt" && !seen.has(e.promptId)) {
      seen.add(e.promptId);
      order.push(e.promptId);
    }
  }
  // A verdict or skip without a prompt event (the prompt hook timed out) still gets a row.
  for (const e of events) {
    if ((e.t === "verdict" || e.t === "skip") && !seen.has(e.promptId)) {
      seen.add(e.promptId);
      order.push(e.promptId);
    }
  }
  return order;
}

function resolvePolicy(events: HookEvent[], cfg: ViewerConfig): Pick<WindowView, "policy" | "policySource"> {
  const fromCfg = policyById(cfg.policyId?.value);
  if (fromCfg && cfg.policyId) return { policy: fromCfg, policySource: cfg.policyId.source };
  const lastFire = [...events].reverse().find((e): e is Ev<"fire"> => e.t === "fire");
  const fromFire = policyById(lastFire?.policyId);
  if (fromFire) return { policy: fromFire, policySource: "last fire" };
  return { policy: policyById(DEFAULT_POLICY_ID) as TriggerPolicy, policySource: "default" };
}

export function buildSession(
  id: string,
  events: HookEvent[],
  cfg: ViewerConfig,
  meta: { truncated: boolean; badLines: number },
): SessionView {
  const order = promptOrder(events);
  const turnOf = (promptId: string): number | null => {
    const i = order.indexOf(promptId);
    return i >= 0 ? i + 1 : null;
  };

  // Turns. A later verdict for the same prompt replaces an earlier one, as in the hook's Map.
  const prompts = new Map<string, Ev<"prompt">>();
  const verdicts = new Map<string, Ev<"verdict">>();
  const skips = new Map<string, Ev<"skip">>();
  for (const e of events) {
    if (e.t === "prompt" && !prompts.has(e.promptId)) prompts.set(e.promptId, e);
    else if (e.t === "verdict") verdicts.set(e.promptId, e);
    else if (e.t === "skip" && !skips.has(e.promptId)) skips.set(e.promptId, e);
  }
  const turns: TurnView[] = order.map((pid, i) => {
    const p = prompts.get(pid);
    const v = verdicts.get(pid);
    const s = skips.get(pid);
    return {
      n: i + 1,
      promptId: pid,
      at: p?.at ?? v?.at ?? s?.at ?? null,
      chars: p?.chars ?? null,
      status: v ? (isPushback(v.label) ? "pushback" : "judged") : s ? "skipped" : "pending",
      verdict: v
        ? {
            at: v.at,
            label: v.label,
            confidence: v.confidence,
            evidence: v.evidence,
            rationale: v.rationale,
            model: v.model,
            costUSD: v.costUSD,
            latencyMs: v.latencyMs,
          }
        : null,
      skip: s ? { at: s.at, reason: s.reason } : null,
    };
  });
  let lastAnswered = -1;
  turns.forEach((t, i) => {
    if (t.status !== "pending") lastAnswered = i;
  });
  turns.forEach((t, i) => {
    if (t.status === "pending" && i < lastAnswered) t.status = "unjudged";
  });

  // Fires.
  const fireViews = new Map<Ev<"fire">, FireView>();
  for (const e of events) {
    if (e.t !== "fire") continue;
    fireViews.set(e, {
      at: e.at,
      turn: turnOf(e.promptId),
      policyId: e.policyId,
      evidenceTurns: e.evidence.map(turnOf).filter((n): n is number => n !== null),
    });
  }
  const fires = [...fireViews.values()];

  // Notes and their deliveries.
  const guidance = events
    .map((e, idx) => ({ e, idx }))
    .filter((x): x is { e: Ev<"guidance">; idx: number } => x.e.t === "guidance");
  const notes: NoteView[] = guidance.map(({ e: g, idx }, gi) => {
    const deliveries = events
      .slice(idx + 1)
      .filter((d): d is Ev<"delivered"> => d.t === "delivered" && d.id === g.id)
      .map((d) => ({ at: d.at, via: d.via }));
    const firstDelivered = events.findIndex((d, j) => j > idx && d.t === "delivered" && d.id === g.id);
    const next = guidance[gi + 1];
    const end = next ? next.idx : events.length;
    const turnsSince =
      firstDelivered >= 0 ? events.slice(firstDelivered + 1, end).filter((x) => x.t === "prompt").length : 0;
    const expiry = g.reflection.expires_after_turns;
    let state: NoteView["state"];
    let turnsLeft: number | null = null;
    if (firstDelivered < 0) state = next ? "superseded" : "waiting";
    else if (turnsSince >= expiry) state = "expired";
    else if (next) state = "superseded";
    else {
      state = "in-force";
      turnsLeft = expiry - turnsSince;
    }
    const fire = g.manual
      ? undefined
      : [...events].reverse().find((f): f is Ev<"fire"> => f.t === "fire" && f.promptId === g.promptId);
    return {
      id: g.id,
      sessionId: id,
      at: g.at,
      turn: turnOf(g.promptId),
      manual: g.manual === true,
      model: g.model,
      costUSD: g.costUSD,
      latencyMs: g.latencyMs,
      note: g.reflection,
      evidenceTurns: fire ? (fireViews.get(fire)?.evidenceTurns ?? []) : [],
      deliveries,
      state,
      turnsLeft,
    };
  });
  const noteById = new Map(notes.map((n) => [n.id, n]));

  const errors: ErrorView[] = events
    .filter((e): e is Ev<"error"> => e.t === "error")
    .map((e) => ({ at: e.at, where: e.where, message: e.message }));

  // Feed, in log order.
  const turnByPid = new Map(turns.map((t) => [t.promptId, t]));
  const feed: FeedItem[] = [];
  const shown = new Set<string>();
  for (const e of events) {
    if (e.t === "prompt" || e.t === "verdict" || e.t === "skip") {
      if (shown.has(e.promptId)) continue;
      // An orphan verdict or skip appears where it was written; a normal one waits for its prompt.
      if (e.t !== "prompt" && prompts.has(e.promptId)) continue;
      const t = turnByPid.get(e.promptId);
      if (t) {
        feed.push({ kind: "turn", turn: t });
        shown.add(e.promptId);
      }
    } else if (e.t === "fire") {
      const f = fireViews.get(e);
      if (f) feed.push({ kind: "fire", fire: f });
    } else if (e.t === "guidance") {
      const n = noteById.get(e.id);
      if (n) feed.push({ kind: "note", note: n });
    } else if (e.t === "delivered") {
      feed.push({ kind: "delivery", at: e.at, via: e.via, noteId: e.id });
    } else if (e.t === "error") {
      feed.push({ kind: "error", error: { at: e.at, where: e.where, message: e.message } });
    }
  }

  // Trigger state, from the recorded fires: a fire clears the window and starts the cooldown.
  const { policy, policySource } = resolvePolicy(events, cfg);
  const currentTurn = turns.length;
  const lastFireTurn = fires.reduce((m, f) => (f.turn !== null && f.turn > m ? f.turn : m), 0);
  const cooldownLeft = lastFireTurn > 0 ? Math.max(0, lastFireTurn + policy.cooldown - currentTurn) : 0;
  const minRank = RANK[policy.minConfidence ?? "low"];
  const counts = (t: TurnView) =>
    t.status === "pushback" && t.verdict !== null && RANK[t.verdict.confidence] >= minRank;
  const windowStart = Math.max(1, currentTurn - policy.window + 1);
  const cells: WindowCell[] = turns
    .filter((t) => t.n >= windowStart)
    .map((t) => ({
      n: t.n,
      status: t.status,
      label: t.verdict?.label ?? null,
      counted: t.n > lastFireTurn && counts(t),
      cooldown: lastFireTurn > 0 && t.n > lastFireTurn && t.n <= lastFireTurn + policy.cooldown,
    }));
  // On the next turn the oldest cell slides out; the cooldown has to be over by then.
  const stillInWindow = cells.filter((c) => c.counted && c.n >= currentTurn + 2 - policy.window).length;
  const window: WindowView = {
    policy,
    policySource,
    currentTurn,
    cells,
    counted: cells.filter((c) => c.counted).length,
    cooldownLeft,
    pending: turns.filter((t) => t.status === "pending").length,
    nextPushbackFires: cooldownLeft === 0 && stillInWindow + 1 >= policy.k,
  };

  // Spend.
  let judgeUSD = 0;
  let reflectionUSD = 0;
  for (const e of events) {
    if (e.t === "verdict") judgeUSD += e.costUSD;
    else if (e.t === "guidance") reflectionUSD += e.costUSD;
  }
  const spend: SpendView = {
    usd: judgeUSD + reflectionUSD,
    judgeUSD,
    reflectionUSD,
    capUSD: cfg.capUSD?.value ?? DEFAULT_CAP_USD,
    capSource: cfg.capUSD?.source ?? "default",
    stoppedAtCap: events.some((e) => e.t === "skip" && e.reason === "budget"),
  };

  const last = notes[notes.length - 1];
  const current = last && (last.state === "in-force" || last.state === "waiting") ? last : null;

  return {
    id,
    firstAt: events[0]?.at ?? null,
    lastAt: events[events.length - 1]?.at ?? null,
    turns,
    feed,
    fires,
    notes,
    errors,
    skips: turns.filter((t) => t.status === "skipped").length,
    pushbacks: turns.filter((t) => t.status === "pushback").length,
    judged: turns.filter((t) => t.verdict !== null).length,
    window,
    spend,
    current,
    truncated: meta.truncated,
    badLines: meta.badLines,
  };
}

/** Every note across sessions, newest first. /reflections and /patterns share this order. */
export function allNotes(snap: ViewerSnapshot): NoteView[] {
  return snap.sessions
    .flatMap((s) => s.notes)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export const LABEL_TEXT: Record<Label, string> = {
  correction: "correction",
  rejection: "rejection",
  failure_report: "failure report",
  instruction: "instruction",
  question: "question",
  affirmation: "affirmation",
  other: "other",
};

export const SKIP_TEXT: Record<string, string> = {
  budget: "spend cap reached",
  session_opener: "first message of the session",
  consecutive_user_message: "no agent turn since the last message",
};

export function skipText(reason: string): string {
  return SKIP_TEXT[reason] ?? reason.replace(/[_-]+/g, " ");
}

export const VIA_TEXT: Record<string, string> = {
  prompt: "with the next prompt",
  tool: "after a tool call",
  "session-start": "again after compaction or resume",
  command: "through /chanjoongx-reflect:brain-reflect",
};

export function formatUsd(v: number): string {
  return `$${v.toFixed(v > 0 && v < 0.01 ? 5 : 4)}`;
}

export function formatRelative(iso: string | null | undefined, suffix = " ago"): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s${suffix}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m${suffix}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h${suffix}`;
  const d = Math.round(h / 24);
  return `${d}d${suffix}`;
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(5, 19) + " UTC";
}
