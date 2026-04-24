"use client";

import { useEffect, useState } from "react";
import { CornerDownRight } from "lucide-react";
import { ReflectionCard } from "@/components/ReflectionCard";
import { Card } from "@/components/ui/Card";
import type { LogEntry } from "@/lib/types";

export interface ReflectionDetailPanelProps {
  entries: LogEntry[];
}

function parseHashIndex(hash: string, max: number): number | null {
  if (!hash || hash === "#") return null;
  const n = Number.parseInt(hash.replace(/^#/, ""), 10);
  if (!Number.isFinite(n) || n < 0 || n >= max) return null;
  return n;
}

export function ReflectionDetailPanel({ entries }: ReflectionDetailPanelProps) {
  const [activeIdx, setActiveIdx] = useState<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const apply = () => {
      const idx = parseHashIndex(window.location.hash, entries.length);
      setActiveIdx(idx ?? 0);
    };

    apply();

    const onHash = () => apply();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [entries.length]);

  useEffect(() => {
    if (typeof window === "undefined" || entries.length === 0) return;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      let next: number | null = null;
      if (e.key === "ArrowDown" || e.key === "j") {
        next = Math.min(entries.length - 1, activeIdx + 1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        next = Math.max(0, activeIdx - 1);
      }
      if (next != null && next !== activeIdx) {
        e.preventDefault();
        window.location.hash = `#${next}`;
        const el = document.getElementById(`list-${next}`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries.length, activeIdx]);

  if (entries.length === 0) return null;

  const entry = entries[activeIdx] ?? entries[0];
  if (!entry) return null;

  return (
    <div key={activeIdx} className="flex flex-col gap-4">
      <ReflectionCard
        reflection={entry.reflection}
        metadata={{
          timestamp: entry.timestamp,
          cost: entry.cost,
          cache_hit_rate: entry.cache_hit_rate,
          latency_ms: entry.latency_ms,
          session_id: entry.session_id,
        }}
      />

      {entry.next_turn_summary ? (
        <Card variant="ghost" padding="sm" className="border border-white/[0.05] bg-white/[0.015]">
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-brand-purple)]"
              aria-hidden
            >
              <CornerDownRight size={14} strokeWidth={2.25} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45 mb-1">
                Next turn
              </p>
              <blockquote className="font-mono text-[12.5px] leading-[1.6] text-white/70 italic">
                {entry.next_turn_summary}
              </blockquote>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export default ReflectionDetailPanel;
