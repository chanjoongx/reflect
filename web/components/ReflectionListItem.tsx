import { Check, Minus, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { LogEntry } from "@/lib/types";

export interface ReflectionListItemProps {
  entry: LogEntry;
  index: number;
  isActive?: boolean;
  /**
   * When the list is rendered outside of `/reflections` (e.g. inside
   * `/patterns` cluster detail), pass `/reflections` so the href resolves
   * to the reflections page hash instead of updating the current page's hash.
   */
  routePrefix?: string;
}

const confidenceVariantMap = {
  low: "confidence-low",
  medium: "confidence-medium",
  high: "confidence-high",
} as const;

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n).trimEnd()}…`;
}

export function ReflectionListItem({
  entry,
  index,
  isActive = false,
  routePrefix = "",
}: ReflectionListItemProps) {
  const acted = entry.next_turn_acted_on_adjustment;
  const actedIcon =
    acted === true ? (
      <Check
        size={12}
        strokeWidth={2.5}
        className="text-[var(--color-brand-teal)]"
        aria-label="Acted on adjustment"
      />
    ) : acted === false ? (
      <X
        size={12}
        strokeWidth={2.5}
        className="text-[#ef7474]"
        aria-label="Did not act on adjustment"
      />
    ) : (
      <Minus
        size={12}
        strokeWidth={2.5}
        className="text-[var(--color-brand-orange)]"
        aria-label="Outcome unknown"
      />
    );

  return (
    <a
      href={`${routePrefix}#${index}`}
      id={`list-${index}`}
      data-index={index}
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
          "bg-[var(--color-brand-purple)]/[0.06] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-[var(--color-brand-purple)]"
      )}
    >
      <time
        dateTime={entry.timestamp}
        title={entry.timestamp}
        className="shrink-0 w-9 font-mono text-[11px] tabular-nums text-white/45"
      >
        {formatRelative(entry.timestamp)}
      </time>

      <p
        className={cn(
          "flex-1 min-w-0 text-[12.5px] leading-snug text-white/75 group-hover:text-white/90",
          isActive && "text-white/95"
        )}
      >
        {truncate(entry.reflection.pattern, 80)}
      </p>

      <div className="shrink-0 flex items-center gap-1.5">
        <Badge
          variant={confidenceVariantMap[entry.reflection.confidence]}
          className="!text-[9.5px] !py-0 !px-1.5"
        >
          {entry.reflection.confidence[0]?.toUpperCase()}
        </Badge>
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/[0.04]">
          {actedIcon}
        </span>
      </div>
    </a>
  );
}

export default ReflectionListItem;
