"use client";

import { useEffect, useState } from "react";

/** Index of the note named by the URL hash (`#<note id>`), or 0. Follows hash changes. */
export function useHashSelection(notes: ReadonlyArray<{ id: string }>): number {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const apply = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      const i = id ? notes.findIndex((n) => n.id === id) : -1;
      setIdx(i >= 0 ? i : 0);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [notes]);

  return idx;
}
