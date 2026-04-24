"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium tracking-tight",
    "transition-all duration-200 select-none whitespace-nowrap",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-purple)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
    "disabled:opacity-50 disabled:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-[var(--color-brand-purple)] text-[#0B0B0F]",
          "hover:bg-[#b59cff] hover:-translate-y-[1px]",
          "active:translate-y-0 active:bg-[#8f72e9]",
          "shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_0_0_1px_rgba(167,139,250,0.4)]",
        ],
        secondary: [
          "bg-white/[0.04] text-white/90 border border-white/10",
          "hover:bg-white/[0.08] hover:border-white/15 hover:text-white",
          "active:bg-white/[0.06]",
        ],
        ghost: [
          "bg-transparent text-white/80",
          "hover:bg-white/[0.05] hover:text-white",
          "active:bg-white/[0.08]",
        ],
        link: [
          "bg-transparent text-[var(--color-brand-purple)] px-0 h-auto",
          "hover:text-[#c4b1ff] hover:underline underline-offset-4",
          "active:text-[#8f72e9]",
        ],
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    compoundVariants: [
      {
        variant: "link",
        size: "sm",
        className: "h-auto px-0 text-xs",
      },
      {
        variant: "link",
        size: "md",
        className: "h-auto px-0 text-sm",
      },
      {
        variant: "link",
        size: "lg",
        className: "h-auto px-0 text-base",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export { buttonVariants };
