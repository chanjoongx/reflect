"use client";

import { useEffect, useState } from "react";
import { ReflectionListItem } from "@/components/ReflectionListItem";
import type { LogEntry } from "@/lib/types";

export interface ReflectionListClientProps {
  entries: LogEntry[];
}

function parseHashIndex(hash: string, max: number): number | null {
  if (!hash || hash === "#") return null;
  const n = Number.parseInt(hash.replace(/^#/, ""), 10);
  if (!Number.isFinite(n) || n < 0 || n >= max) return null;
  return n;
}

export function ReflectionListClient({ entries }: ReflectionListClientProps) {
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

  return (
    <div role="listbox" aria-label="Reflections" className="flex flex-col">
      {entries.map((entry, i) => (
        <ReflectionListItem
          key={`${entry.timestamp}-${i}`}
          entry={entry}
          index={i}
          isActive={i === activeIdx}
        />
      ))}
    </div>
  );
}

export default ReflectionListClient;
