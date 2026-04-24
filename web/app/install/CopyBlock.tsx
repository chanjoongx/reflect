"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

export function CopyBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — fall through silently.
    }
  }, [code]);

  return (
    <div className="group relative">
      {language ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/30"
        >
          {language}
        </span>
      ) : null}
      <pre
        className={cn(
          "overflow-x-auto rounded-lg border border-white/8 bg-[#07070a] px-4 py-3 pr-12 font-mono text-[13px] leading-relaxed text-white/85",
          language && "pt-6",
        )}
      >
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        className={cn(
          "absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-white/60",
          "transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white/90",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand-purple)]/60",
          copied && "border-[var(--color-brand-teal)]/40 text-[var(--color-brand-teal)]",
        )}
      >
        {copied ? (
          <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} />
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}
