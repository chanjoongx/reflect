"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5",
    "text-[11px] font-medium tracking-wide uppercase",
    "border transition-colors duration-200 whitespace-nowrap",
  ],
  {
    variants: {
      variant: {
        neutral:
          "bg-white/[0.04] text-white/70 border-white/10",

        "confidence-high":
          "bg-[rgba(95,229,212,0.12)] text-[var(--color-brand-teal)] border-[rgba(95,229,212,0.3)]",
        "confidence-medium":
          "bg-[rgba(212,162,127,0.12)] text-[var(--color-brand-orange)] border-[rgba(212,162,127,0.3)]",
        "confidence-low":
          "bg-white/[0.04] text-white/50 border-white/10",

        "ft-low":
          "bg-[rgba(95,229,212,0.1)] text-[var(--color-brand-teal)] border-[rgba(95,229,212,0.25)]",
        "ft-medium":
          "bg-[rgba(212,162,127,0.1)] text-[var(--color-brand-orange)] border-[rgba(212,162,127,0.25)]",
        "ft-high":
          "bg-[rgba(239,116,116,0.12)] text-[#ef7474] border-[rgba(239,116,116,0.3)]",

        "scope-session":
          "bg-[rgba(167,139,250,0.12)] text-[var(--color-brand-purple)] border-[rgba(167,139,250,0.3)]",
        "scope-wider":
          "bg-[rgba(122,183,252,0.12)] text-[var(--color-brand-blue)] border-[rgba(122,183,252,0.3)]",

        "tier-0":
          "bg-white/[0.03] text-white/40 border-white/8",
        "tier-1":
          "bg-[rgba(122,183,252,0.1)] text-[var(--color-brand-blue)] border-[rgba(122,183,252,0.25)]",
        "tier-2":
          "bg-[rgba(212,162,127,0.1)] text-[var(--color-brand-orange)] border-[rgba(212,162,127,0.25)]",
        "tier-3":
          "bg-[rgba(167,139,250,0.12)] text-[var(--color-brand-purple)] border-[rgba(167,139,250,0.3)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
});

export { badgeVariants };
