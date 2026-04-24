"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { RecentCall } from "@/lib/types";
import { sectionStagger, sectionItem, ease } from "@/lib/motion";
import { cn } from "@/lib/cn";

interface CallTimelineProps {
  calls: RecentCall[];
  cumX100: number;
}

const THRESHOLD = 240;

const TIER_LABELS: Record<0 | 1 | 2 | 3, string> = {
  0: "non-revert",
  1: "hard revert",
  2: "inferred",
  3: "utterance",
};

const TIER_WEIGHTS: Record<0 | 1 | 2 | 3, number> = {
  0: 0,
  1: 100,
  2: 70,
  3: 50,
};

function dotClassesFor(tier: 0 | 1 | 2 | 3): string {
  switch (tier) {
    case 1:
      return "bg-[var(--color-brand-blue)] w-3 h-3 shadow-[0_0_10px_rgba(122,183,252,0.55)]";
    case 2:
      return "bg-[var(--color-brand-orange)] w-3 h-3 shadow-[0_0_10px_rgba(212,162,127,0.5)]";
    case 3:
      return "bg-[var(--color-brand-purple)] w-2.5 h-2.5 shadow-[0_0_8px_rgba(167,139,250,0.5)]";
    case 0:
    default:
      return "bg-white/25 w-2 h-2";
  }
}

function legendDotClasses(tier: 0 | 1 | 2 | 3): string {
  switch (tier) {
    case 1:
      return "bg-[var(--color-brand-blue)]";
    case 2:
      return "bg-[var(--color-brand-orange)]";
    case 3:
      return "bg-[var(--color-brand-purple)]";
    case 0:
    default:
      return "bg-white/25";
  }
}

function truncate(s: string, max = 40): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace("T", " ").replace("Z", " UTC").slice(5, 23);
  } catch {
    return iso;
  }
}

export function CallTimeline({ calls, cumX100 }: CallTimelineProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const counts = useMemo(() => {
    const c: Record<0 | 1 | 2 | 3, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const call of calls) {
      const t = (call.tier >= 0 && call.tier <= 3 ? call.tier : 0) as 0 | 1 | 2 | 3;
      c[t] += 1;
    }
    return c;
  }, [calls]);

  const safeCum = Math.max(0, cumX100);
  const pct = Math.min(100, (safeCum / THRESHOLD) * 100);
  const over = safeCum >= THRESHOLD;

  if (calls.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/8 bg-[var(--color-panel)] p-6">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-white/20" />
          <span className="text-sm text-white/50">No tool calls recorded yet</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
            waiting for PostToolUse hook
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white/90 tracking-tight">Tool call timeline</h2>
          <p className="mt-0.5 text-[11px] text-white/45">
            last {calls.length} call{calls.length === 1 ? "" : "s"} · newest on right
          </p>
        </div>
        <div className="flex items-baseline gap-2 font-mono text-[11px]">
          <span className="text-white/45">cum_x100</span>
          <span
            className={cn(
              "tabular-nums",
              over ? "text-[var(--color-brand-teal)]" : "text-white/90",
            )}
          >
            {safeCum}
          </span>
          <span className="text-white/30">/ {THRESHOLD}</span>
        </div>
      </div>

      <div className="relative">
        <div className="relative h-1.5 w-full overflow-hidden rounded-full border border-white/8 bg-white/[0.04]">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.55, ease }}
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              backgroundColor: over
                ? "var(--color-brand-teal)"
                : pct >= 60
                  ? "var(--color-brand-teal)"
                  : "rgba(255,255,255,0.32)",
              boxShadow: over ? "0 0 10px rgba(95,229,212,0.5)" : "none",
            }}
          />
          <span
            aria-hidden
            className="absolute top-[-3px] bottom-[-3px] w-px bg-white/60"
            style={{ right: 0 }}
          />
        </div>
        <span className="absolute -top-5 right-0 font-mono text-[10px] tracking-tight text-white/40">
          240
        </span>
      </div>

      <div className="relative rounded-xl border border-white/8 bg-[var(--color-panel)] px-5 py-6">
        <div className="relative overflow-x-auto">
          <motion.ol
            variants={sectionStagger}
            initial="hidden"
            animate="visible"
            className="relative flex min-h-[44px] items-center gap-3"
            aria-label="Recent tool calls"
          >
            <div
              aria-hidden
              className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/8"
            />
            {calls.map((call, idx) => {
              const tier = (call.tier >= 0 && call.tier <= 3 ? call.tier : 0) as 0 | 1 | 2 | 3;
              const active = hoverIdx === idx;
              return (
                <motion.li
                  key={`${call.turn}-${idx}`}
                  variants={sectionItem}
                  className="relative flex shrink-0 items-center"
                >
                  <button
                    type="button"
                    onMouseEnter={() => setHoverIdx(idx)}
                    onMouseLeave={() => setHoverIdx((v) => (v === idx ? null : v))}
                    onFocus={() => setHoverIdx(idx)}
                    onBlur={() => setHoverIdx((v) => (v === idx ? null : v))}
                    aria-label={`turn ${call.turn}, tool ${call.tool}, tier ${tier}`}
                    className={cn(
                      "relative z-10 inline-flex items-center justify-center rounded-full",
                      "border border-white/10 ring-2 ring-[var(--color-panel)]",
                      "transition-transform duration-150",
                      "focus-visible:outline-none focus-visible:ring-[var(--color-brand-purple)]/60",
                      active ? "scale-125" : "scale-100",
                    )}
                    style={{ padding: 0, background: "transparent" }}
                  >
                    <span className={cn("block rounded-full", dotClassesFor(tier))} />
                  </button>
                  {active ? (
                    <div
                      role="tooltip"
                      className={cn(
                        "absolute bottom-full left-1/2 z-20 mb-3 w-64 -translate-x-1/2",
                        "rounded-lg border border-white/10 bg-[#121218] p-3 shadow-xl",
                        "text-left",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-white/90">
                          turn {call.turn}
                        </span>
                        <span
                          className={cn(
                            "font-mono text-[10px] uppercase tracking-wider",
                            tier === 0 && "text-white/40",
                            tier === 1 && "text-[var(--color-brand-blue)]",
                            tier === 2 && "text-[var(--color-brand-orange)]",
                            tier === 3 && "text-[var(--color-brand-purple)]",
                          )}
                        >
                          tier {tier} · +{TIER_WEIGHTS[tier]}
                        </span>
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-[var(--color-brand-teal)]">
                        {call.tool}
                      </div>
                      <div className="mt-1 font-mono text-[11px] leading-snug text-white/70 break-words">
                        {truncate(call.input_summary)}
                      </div>
                      <div className="mt-2 border-t border-white/6 pt-1.5 font-mono text-[10px] text-white/40">
                        {formatTime(call.timestamp)}
                      </div>
                    </div>
                  ) : null}
                </motion.li>
              );
            })}
          </motion.ol>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {([1, 2, 3, 0] as const).map((tier) => (
          <div key={tier} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-block rounded-full",
                legendDotClasses(tier),
                tier === 1 || tier === 2 ? "h-3 w-3" : tier === 3 ? "h-2.5 w-2.5" : "h-2 w-2",
              )}
            />
            <span className="font-mono text-[11px] text-white/70">
              {TIER_LABELS[tier]}
              {tier !== 0 ? (
                <span className="text-white/35"> +{TIER_WEIGHTS[tier]}</span>
              ) : null}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-white/45">
              ×{counts[tier]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
