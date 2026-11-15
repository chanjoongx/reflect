import Link from "next/link";
import type { SessionView } from "@/lib/types";
import { formatRelative, formatUsd } from "@/lib/session";
import { cn } from "@/lib/cn";

interface SessionPickerProps {
  sessions: SessionView[];
  activeId: string | null;
}

/** Recorded sessions, newest first. reflect deletes a session 7 days after its last event. */
export function SessionPicker({ sessions, activeId }: SessionPickerProps) {
  if (sessions.length === 0) return null;
  return (
    <nav aria-label="Sessions" className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">
        sessions · {sessions.length} recorded · newest first
      </span>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {sessions.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id} className="shrink-0">
              <Link
                href={`/?session=${encodeURIComponent(s.id)}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-[11rem] flex-col gap-1 rounded-lg border px-3 py-2 transition-colors",
                  active
                    ? "border-[var(--color-brand-purple)]/40 bg-[var(--color-brand-purple)]/[0.06]"
                    : "border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] text-white/85" title={s.id}>
                    {s.id.slice(0, 8)}
                  </span>
                  <span className="font-mono text-[10px] text-white/40">{formatRelative(s.lastAt)}</span>
                </span>
                <span className="font-mono text-[10px] text-white/45">
                  {s.turns.length} turns · {s.pushbacks} pushback · {s.notes.length} note
                  {s.notes.length === 1 ? "" : "s"} · {formatUsd(s.spend.usd)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
