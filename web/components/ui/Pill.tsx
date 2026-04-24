"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const pillVariants = cva(
  [
    "inline-flex items-center gap-1.5 rounded-full",
    "border border-white/10 bg-white/[0.03]",
    "px-3 py-1 font-mono",
    "transition-colors duration-200",
  ],
  {
    variants: {
      tone: {
        neutral: "text-white/80",
        purple: "border-[rgba(167,139,250,0.25)] bg-[rgba(167,139,250,0.08)] text-[var(--color-brand-purple)]",
        teal: "border-[rgba(95,229,212,0.25)] bg-[rgba(95,229,212,0.08)] text-[var(--color-brand-teal)]",
        orange: "border-[rgba(212,162,127,0.25)] bg-[rgba(212,162,127,0.08)] text-[var(--color-brand-orange)]",
        blue: "border-[rgba(122,183,252,0.25)] bg-[rgba(122,183,252,0.08)] text-[var(--color-brand-blue)]",
      },
      size: {
        sm: "text-[11px] h-6",
        md: "text-xs h-7",
        lg: "text-sm h-8",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "md",
    },
  }
);

export interface PillProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  label?: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
}

export const Pill = forwardRef<HTMLSpanElement, PillProps>(function Pill(
  { className, tone, size, label, value, icon, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={cn(pillVariants({ tone, size }), className)}
      {...props}
    >
      {icon ? <span className="flex shrink-0 items-center text-current/80">{icon}</span> : null}
      <span className="tabular-nums leading-none">{value}</span>
      {label ? (
        <span className="text-[10px] uppercase tracking-wider text-white/45 font-sans leading-none">
          {label}
        </span>
      ) : null}
    </span>
  );
});

export { pillVariants };
