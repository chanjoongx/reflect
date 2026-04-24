import Link from "next/link";
import { ExternalLink } from "lucide-react";

export function Footer() {
  return (
    <footer
      className="relative z-10 mt-16 border-t border-white/5 py-8 text-sm text-white/40"
      role="contentinfo"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="font-mono text-[12px] leading-relaxed">
          reflect v1 <span className="text-white/20">·</span> MIT{" "}
          <span className="text-white/20">·</span> localhost-only viewer
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
          <Link
            href="https://github.com/chanjoongx/reflect"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-white/50 transition-colors hover:text-white/90"
          >
            github.com/chanjoongx/reflect
            <ExternalLink aria-hidden className="h-3 w-3" strokeWidth={2} />
          </Link>
          <span aria-hidden className="text-white/20">·</span>
          <span className="text-white/40">
            built by{" "}
            <Link
              href="https://github.com/chanjoongx"
              target="_blank"
              rel="noreferrer noopener"
              className="text-white/60 underline-offset-4 transition-colors hover:text-white/90 hover:underline"
            >
              Chanjoong Kim
            </Link>
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-brand-purple)]/25 bg-[var(--color-brand-purple)]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-brand-purple)]/90"
            title="Built with Opus 4.7 hackathon · Cerebral Valley × Anthropic · 2026-04"
          >
            <span
              aria-hidden
              className="h-1 w-1 rounded-full bg-[var(--color-brand-purple)]"
            />
            Built with Opus 4.7
          </span>
        </div>
      </div>
    </footer>
  );
}
