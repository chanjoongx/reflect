"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { ease } from "@/lib/motion";

export interface ClusterDetailsProps {
  count: number;
  children: ReactNode;
  className?: string;
}

/**
 * Accordion toggle wrapped around the server-rendered reflection list.
 * Server owns the children (the actual reflection rows); client owns
 * only the open/close state + animation.
 */
export function ClusterDetails({ count, children, className }: ClusterDetailsProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const btnId = useId();

  return (
    <div className={cn("flex flex-col", className)}>
      <button
        id={btnId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 -mx-2",
          "text-xs font-medium text-white/55 hover:text-white/85 hover:bg-white/[0.03]",
          "transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-purple)]/60",
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <span>
            {open ? "Hide" : "Show"} {count} reflection{count === 1 ? "" : "s"}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={panelId}
            role="region"
            aria-labelledby={btnId}
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            className="overflow-hidden"
          >
            <div className="pt-3 flex flex-col divide-y divide-white/5 border-t border-white/5 mt-2">
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
