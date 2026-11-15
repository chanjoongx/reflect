import type { Label, NoteState, TurnView } from "@/lib/types";

/** Text colour per pushback label; every other label shares the neutral tone. */
export const LABEL_COLOR: Partial<Record<Label, string>> = {
  correction: "var(--color-brand-orange)",
  rejection: "#ef7474",
  failure_report: "var(--color-brand-blue)",
};

export const NEUTRAL_COLOR = "rgba(255,255,255,0.55)";

export function labelColor(label: Label | null | undefined): string {
  return (label && LABEL_COLOR[label]) || NEUTRAL_COLOR;
}

/** Classes for a turn's dot: filled for judged turns, hollow for the rest. */
export function dotClasses(status: TurnView["status"]): string {
  switch (status) {
    case "pushback":
      return "h-3 w-3";
    case "judged":
      return "h-2 w-2 bg-white/30";
    case "skipped":
      return "h-2 w-2 border border-white/25 bg-transparent";
    case "unjudged":
      return "h-2 w-2 border border-dashed border-white/30 bg-transparent";
    case "pending":
    default:
      return "h-2.5 w-2.5 border border-dashed border-[var(--color-brand-teal)]/70 bg-transparent animate-pulse";
  }
}

export const STATUS_TEXT: Record<TurnView["status"], string> = {
  pushback: "pushback",
  judged: "judged",
  skipped: "skipped",
  unjudged: "no verdict",
  pending: "judge running",
};

export const NOTE_STATE_TEXT: Record<NoteState, string> = {
  waiting: "waiting for delivery",
  "in-force": "in force",
  expired: "expired",
  superseded: "replaced by a later note",
};
