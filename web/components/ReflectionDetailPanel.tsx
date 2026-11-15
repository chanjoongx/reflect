"use client";

import { useEffect } from "react";
import { ReflectionCard } from "@/components/ReflectionCard";
import { useHashSelection } from "@/components/useHashSelection";
import type { NoteView } from "@/lib/types";

export interface ReflectionDetailPanelProps {
  notes: NoteView[];
}

export function ReflectionDetailPanel({ notes }: ReflectionDetailPanelProps) {
  const activeIdx = useHashSelection(notes);

  useEffect(() => {
    if (notes.length === 0) return;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      let next: number | null = null;
      if (e.key === "ArrowDown" || e.key === "j") next = Math.min(notes.length - 1, activeIdx + 1);
      else if (e.key === "ArrowUp" || e.key === "k") next = Math.max(0, activeIdx - 1);
      const target = next !== null && next !== activeIdx ? notes[next] : undefined;
      if (target) {
        e.preventDefault();
        window.location.hash = `#${target.id}`;
        document.getElementById(`list-${target.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notes, activeIdx]);

  const note = notes[activeIdx] ?? notes[0];
  if (!note) return null;

  return (
    <div key={note.id} className="flex flex-col gap-4">
      <ReflectionCard view={note} showSession />
    </div>
  );
}

export default ReflectionDetailPanel;
