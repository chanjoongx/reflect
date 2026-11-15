import { Check, Clock, Minus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/session";
import type { NoteView } from "@/lib/types";
import { NOTE_STATE_TEXT } from "./turn-style";

export interface ReflectionListItemProps {
  note: NoteView;
  isActive?: boolean;
  /**
   * When the list is rendered outside of `/reflections` (e.g. inside a
   * `/patterns` cluster), pass `/reflections` so the link opens the note there
   * instead of changing the current page's hash.
   */
  routePrefix?: string;
}

const confidenceVariantMap = {
  low: "confidence-low",
  medium: "confidence-medium",
  high: "confidence-high",
} as const;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n).trimEnd()}…`;
}

export function ReflectionListItem({ note, isActive = false, routePrefix = "" }: ReflectionListItemProps) {
  const icon =
    note.state === "in-force" ? (
      <Check size={12} strokeWidth={2.5} className="text-[var(--color-brand-teal)]" aria-hidden />
    ) : note.state === "waiting" ? (
      <Clock size={12} strokeWidth={2.5} className="text-[var(--color-brand-orange)]" aria-hidden />
    ) : (
      <Minus size={12} strokeWidth={2.5} className="text-white/40" aria-hidden />
    );

  return (
    <a
      href={`${routePrefix}#${note.id}`}
      id={`list-${note.id}`}
      data-active={isActive || undefined}
      role="option"
      aria-selected={isActive}
      className={cn(
        "group relative flex items-center gap-3 px-3 py-2.5",
        "border-b border-white/[0.04]",
        "transition-colors duration-150",
        "focus:outline-none focus-visible:bg-white/[0.04]",
        "hover:bg-white/[0.03]",
        isActive &&
          "bg-[var(--color-brand-purple)]/[0.06] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[var(--color-brand-purple)]",
      )}
    >
      <time
        dateTime={note.at}
        title={note.at}
        className="w-9 shrink-0 font-mono text-[11px] tabular-nums text-white/45"
      >
        {formatRelative(note.at, "")}
      </time>

      <p
        className={cn(
          "min-w-0 flex-1 text-[12.5px] leading-snug text-white/75 group-hover:text-white/90",
          isActive && "text-white/95",
        )}
      >
        {truncate(note.note.pattern || note.note.adjustment, 80)}
      </p>

      <div className="flex shrink-0 items-center gap-1.5">
        {note.manual ? (
          <Badge variant="neutral" className="!px-1.5 !py-0 !text-[9.5px]">
            M
          </Badge>
        ) : null}
        <Badge variant={confidenceVariantMap[note.note.confidence]} className="!px-1.5 !py-0 !text-[9.5px]">
          {note.note.confidence[0]?.toUpperCase()}
        </Badge>
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/[0.04]"
          title={NOTE_STATE_TEXT[note.state]}
        >
          {icon}
          <span className="sr-only">{NOTE_STATE_TEXT[note.state]}</span>
        </span>
      </div>
    </a>
  );
}

export default ReflectionListItem;
