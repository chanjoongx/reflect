"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { FireView, NoteView, TurnView } from "@/lib/types";
import { LABEL_TEXT, PUSHBACK_LABELS, formatClock, skipText } from "@/lib/session";
import { sectionItem, sectionStagger } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { STATUS_TEXT, dotClasses, labelColor } from "./turn-style";

interface TurnTimelineProps {
  turns: TurnView[];
  fires: FireView[];
  notes: NoteView[];
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function describe(t: TurnView): string {
  if (t.status === "pushback" || t.status === "judged") {
    return `${t.verdict ? LABEL_TEXT[t.verdict.label] : ""}, ${t.verdict?.confidence} confidence`;
  }
  if (t.status === "skipped") return `skipped: ${skipText(t.skip?.reason ?? "")}`;
  return STATUS_TEXT[t.status];
}

/** One dot per developer turn, oldest on the left. Hover, focus or click a dot to see its verdict below. */
export function TurnTimeline({ turns, fires, notes }: TurnTimelineProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);

  const fireTurns = useMemo(() => new Set(fires.map((f) => f.turn).filter((n): n is number => n !== null)), [fires]);
  const noteTurns = useMemo(() => new Set(notes.map((n) => n.turn).filter((n): n is number => n !== null)), [notes]);

  const counts = useMemo(() => {
    const c = { correction: 0, rejection: 0, failure_report: 0, other: 0, skipped: 0 };
    for (const t of turns) {
      const l = t.verdict?.label;
      if (l === "correction" || l === "rejection" || l === "failure_report") c[l] += 1;
      else if (t.verdict) c.other += 1;
      else c.skipped += 1;
    }
    return c;
  }, [turns]);

  const shownN = hover ?? pinned ?? turns[turns.length - 1]?.n ?? null;
  const shown = turns.find((t) => t.n === shownN) ?? null;

  if (turns.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/8 bg-[var(--color-panel)] p-6">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-white/20" />
          <span className="text-sm text-white/50">No developer turns recorded yet</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
            waiting for the UserPromptSubmit hook
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-white/90">Developer turns</h2>
        <p className="mt-0.5 text-[11px] text-white/45">
          {turns.length} turn{turns.length === 1 ? "" : "s"} · oldest on the left · a ring marks a fire
        </p>
      </div>

      <div className="relative rounded-xl border border-white/8 bg-[var(--color-panel)] px-5 py-6">
        <div className="relative overflow-x-auto px-1 pb-1 pt-4">
          <motion.ol
            variants={sectionStagger}
            initial="hidden"
            animate="visible"
            className="relative flex min-h-[44px] items-center gap-3"
            aria-label="Developer turns"
          >
            <div aria-hidden className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/8" />
            {turns.map((t) => {
              const active = shown?.n === t.n;
              const fired = fireTurns.has(t.n);
              const label = t.verdict?.label ?? null;
              return (
                <motion.li key={t.promptId} variants={sectionItem} className="relative flex shrink-0 items-center">
                  <button
                    type="button"
                    onMouseEnter={() => setHover(t.n)}
                    onMouseLeave={() => setHover((v) => (v === t.n ? null : v))}
                    onFocus={() => setHover(t.n)}
                    onBlur={() => setHover((v) => (v === t.n ? null : v))}
                    onClick={() => setPinned(t.n)}
                    aria-pressed={pinned === t.n}
                    aria-label={`turn ${t.n}: ${describe(t)}${fired ? ", trigger fired" : ""}`}
                    className={cn(
                      "relative z-10 inline-flex h-5 w-5 items-center justify-center rounded-full",
                      "transition-transform duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-purple)]/60",
                      fired && "ring-2 ring-[var(--color-brand-teal)]/70 ring-offset-2 ring-offset-[var(--color-panel)]",
                      active ? "scale-125" : "scale-100",
                    )}
                    style={{ padding: 0, background: "transparent" }}
                  >
                    <span
                      className={cn("block rounded-full", dotClasses(t.status))}
                      style={
                        t.status === "pushback"
                          ? { backgroundColor: labelColor(label), boxShadow: `0 0 10px ${labelColor(label)}` }
                          : undefined
                      }
                    />
                  </button>
                  {noteTurns.has(t.n) ? (
                    <span
                      aria-hidden
                      className="absolute -top-3 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--color-brand-purple)]"
                    />
                  ) : null}
                </motion.li>
              );
            })}
          </motion.ol>
        </div>

        {shown ? (
          <div className="mt-5 border-t border-white/6 pt-4" aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] text-white/90">turn {shown.n}</span>
              <span
                className="font-mono text-[10px] uppercase tracking-wider"
                style={{ color: labelColor(shown.verdict?.label) }}
              >
                {describe(shown)}
                {fireTurns.has(shown.n) ? " · trigger fired" : ""}
              </span>
            </div>
            {shown.verdict?.evidence ? (
              <p className="mt-2 break-words font-mono text-[12px] leading-snug text-white/80">
                &ldquo;{truncate(shown.verdict.evidence, 240)}&rdquo;
              </p>
            ) : null}
            {shown.verdict?.rationale ? (
              <p className="mt-1 break-words text-[12px] leading-snug text-white/55">
                {truncate(shown.verdict.rationale, 300)}
              </p>
            ) : null}
            <p className="mt-2 font-mono text-[10px] text-white/40">
              {formatClock(shown.at)}
              {shown.chars !== null ? ` · ${shown.chars} chars` : ""}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {PUSHBACK_LABELS.map((l) => (
          <Legend key={l} swatch={<span className="h-3 w-3 rounded-full" style={{ backgroundColor: labelColor(l) }} />}>
            {LABEL_TEXT[l]} <span className="tabular-nums text-white/45">×{counts[l as keyof typeof counts]}</span>
          </Legend>
        ))}
        <Legend swatch={<span className="h-2 w-2 rounded-full bg-white/30" />}>
          other verdicts <span className="tabular-nums text-white/45">×{counts.other}</span>
        </Legend>
        <Legend swatch={<span className="h-2 w-2 rounded-full border border-white/25" />}>
          not judged <span className="tabular-nums text-white/45">×{counts.skipped}</span>
        </Legend>
        <Legend swatch={<span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand-purple)]" />}>note written</Legend>
      </div>
    </div>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-3 w-3 items-center justify-center">{swatch}</span>
      <span className="font-mono text-[11px] text-white/70">{children}</span>
    </div>
  );
}
