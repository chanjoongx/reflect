"use client";

import { ReflectionListItem } from "@/components/ReflectionListItem";
import { useHashSelection } from "@/components/useHashSelection";
import type { NoteView } from "@/lib/types";

export interface ReflectionListClientProps {
  notes: NoteView[];
}

export function ReflectionListClient({ notes }: ReflectionListClientProps) {
  const activeIdx = useHashSelection(notes);

  return (
    <div role="listbox" aria-label="Notes" className="flex flex-col">
      {notes.map((note, i) => (
        <ReflectionListItem key={note.id} note={note} isActive={i === activeIdx} />
      ))}
    </div>
  );
}

export default ReflectionListClient;
