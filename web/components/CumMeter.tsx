"use client";

import { motion } from "framer-motion";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/cn";

interface CumMeterProps {
  cumX100: number;
}

const THRESHOLD = 240;

export function CumMeter({ cumX100 }: CumMeterProps) {
  const safe = Math.max(0, cumX100);
  const rawPct = (safe / THRESHOLD) * 100;
  const pct = Math.min(100, rawPct);
  const over = safe >= THRESHOLD;
  const ratio = Math.min(1, safe / THRESHOLD);

  const fillColor = over
    ? "var(--color-brand-teal)"
    : ratio < 0.6
      ? "rgba(255, 255, 255, 0.32)"
      : "var(--color-brand-teal)";

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="relative">
        <div
          className={cn(
            "relative h-2 w-full overflow-hidden rounded-full",
            "bg-white/[0.05] border border-white/8",
          )}
        >
          <motion.div
            initial={{ width: "0%" }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease }}
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              backgroundColor: fillColor,
              boxShadow: over
                ? "0 0 12px rgba(95, 229, 212, 0.55)"
                : ratio >= 0.6
                  ? "0 0 8px rgba(95, 229, 212, 0.25)"
                  : "none",
            }}
          />
          {over ? (
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                boxShadow: "0 0 0 2px rgba(95, 229, 212, 0.55)",
              }}
              animate={{ opacity: [0.35, 0.85, 0.35] }}
              transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
            />
          ) : null}
          <span
            aria-hidden
            className="absolute top-[-2px] bottom-[-2px] w-px bg-white/55"
            style={{ left: "calc(100% - 0.5px)" }}
          />
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-4 font-mono text-[11px]">
        <span className="text-white/55">
          cum_x100:{" "}
          <span
            className={cn(
              "tabular-nums",
              over ? "text-[var(--color-brand-teal)]" : "text-white/90",
            )}
          >
            {safe}
          </span>
          <span className="text-white/35"> / {THRESHOLD}</span>
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-white/35">
          {over ? "threshold reached" : "accumulating"}
        </span>
      </div>
    </div>
  );
}
