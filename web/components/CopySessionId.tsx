"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

interface CopySessionIdProps {
  value: string;
}

export function CopySessionId({ value }: CopySessionIdProps) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied session id" : "Copy session id"}
      title={copied ? "Copied" : value}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md",
        "border border-white/8 bg-white/[0.03] text-white/55",
        "transition-colors duration-150",
        "hover:border-white/15 hover:bg-white/[0.06] hover:text-white/90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-purple)]/50",
      )}
    >
      {copied ? (
        <Check className="h-3 w-3 text-[var(--color-brand-teal)]" strokeWidth={2.5} aria-hidden />
      ) : (
        <Copy className="h-3 w-3" strokeWidth={2} aria-hidden />
      )}
    </button>
  );
}
