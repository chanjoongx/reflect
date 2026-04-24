import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Roadmap — reflect",
  description:
    "v1 ships this week. The credits the hackathon might award are the runway for v2.",
};

type Milestone = {
  version: string;
  label: string;
  accent: "teal" | "orange" | "purple";
  bullets: (string | { text: string; strong?: string })[];
};

const milestones: Milestone[] = [
  {
    version: "v1",
    label: "shipped",
    accent: "teal",
    bullets: [
      "Single-shot Opus 4.7 reflection",
      "3-tier revert detection (git restore / rm / utterance)",
      "3-layer prompt cache (L1 1h, L2 5m, L3 ephemeral)",
      "Honest failure modes documented + tested",
      "Managed Agents: deliberately NOT used (single-shot is the correct primitive)",
    ],
  },
  {
    version: "v1.1",
    label: "next month",
    accent: "orange",
    bullets: [
      "Deep-reflect mode — optional multi-turn reflection when user opts in",
      "Domain rule injection — user supplies .reflect/domain-rules.md for tax / KYC / GDPR domains",
      "Viewer live-tail via SSE (currently page refresh to update)",
    ],
  },
  {
    version: "v2",
    label: "reflect Cloud",
    accent: "purple",
    bullets: [
      "Opt-in team sync for cross-session pattern aggregation",
      "Anonymized drift signal sharing across teammates",
      "Organizational memory that respects session-locality",
      "Team dashboard for drift hotspot analysis",
      {
        text: "would cover ~6 months of Cloud beta for ~100 paying teams. Credits-as-runway narrative.",
        strong: "Funded by hackathon credits: the $50k",
      },
    ],
  },
];

const accentRing: Record<Milestone["accent"], string> = {
  teal: "border-[var(--color-brand-teal)]/40 bg-[rgba(95,229,212,0.12)] text-[var(--color-brand-teal)]",
  orange:
    "border-[var(--color-brand-orange)]/40 bg-[rgba(212,162,127,0.12)] text-[var(--color-brand-orange)]",
  purple:
    "border-[var(--color-brand-purple)]/40 bg-[rgba(167,139,250,0.12)] text-[var(--color-brand-purple)]",
};

const accentBadge: Record<Milestone["accent"], string> = {
  teal: "text-[var(--color-brand-teal)]",
  orange: "text-[var(--color-brand-orange)]",
  purple: "text-[var(--color-brand-purple)]",
};

const accentBullet: Record<Milestone["accent"], string> = {
  teal: "bg-[var(--color-brand-teal)]",
  orange: "bg-[var(--color-brand-orange)]",
  purple: "bg-[var(--color-brand-purple)]",
};

const sidebarLinks = [
  {
    href: "https://github.com/chanjoongx/reflect/blob/main/experiments/ablation-with-without.md",
    title: "experiments/ablation-with-without.md",
    note: "Why we deferred the controlled ablation",
  },
  {
    href: "https://github.com/chanjoongx/reflect",
    title: "hackathon/DOGFOOD-LOG.md",
    note: "CJ's real 4-day usage",
  },
  {
    href: "https://github.com/chanjoongx/reflect/blob/main/docs/measurements.md",
    title: "docs/measurements.md",
    note: "Cache hit rates, cost math, token counts",
  },
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="flex flex-col gap-3 border-b border-white/5 pb-8">
        <div className="flex items-center gap-2">
          <Badge variant="scope-wider">Trajectory</Badge>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
            v1 · v1.1 · v2
          </span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-white/95">
          Roadmap
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-white/60">
          v1 ships this week. The credits the hackathon might award are the
          runway for v2.
        </p>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_18rem]">
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-[var(--color-brand-teal)]/40 via-[var(--color-brand-orange)]/30 to-[var(--color-brand-purple)]/40"
          />
          <ol className="flex flex-col gap-8">
            {milestones.map((m) => (
              <li key={m.version} className="relative pl-12">
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 top-6 inline-flex h-8 w-8 items-center justify-center rounded-full border",
                    accentRing[m.accent],
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      accentBullet[m.accent],
                    )}
                  />
                </span>

                <Card variant="elevated" padding="lg">
                  <CardHeader>
                    <div className="flex flex-wrap items-baseline gap-3">
                      <CardTitle
                        className={cn("text-xl", accentBadge[m.accent])}
                      >
                        {m.version}
                      </CardTitle>
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
                        {m.label}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-2.5">
                      {m.bullets.map((bullet, i) => {
                        const isObj = typeof bullet !== "string";
                        return (
                          <li
                            key={i}
                            className="flex items-start gap-3 text-[14px] leading-relaxed text-white/75"
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "mt-2 h-1 w-1 shrink-0 rounded-full",
                                accentBullet[m.accent],
                              )}
                            />
                            {isObj ? (
                              <span>
                                <span className="font-medium text-white/95">
                                  {bullet.strong}
                                </span>{" "}
                                {bullet.text}
                              </span>
                            ) : (
                              <span>{bullet}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card variant="default" padding="lg">
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-[0.14em] text-white/50">
                Evidence + decision log
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-3">
                {sidebarLinks.map((l) => (
                  <li key={l.title}>
                    <Link
                      href={l.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="group flex flex-col gap-1 rounded-md border border-transparent px-3 py-2 transition-colors hover:border-white/10 hover:bg-white/[0.03]"
                    >
                      <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-[var(--color-brand-purple)] transition-colors group-hover:text-[#c4b1ff]">
                        {l.title}
                        <ExternalLink
                          aria-hidden
                          className="h-3 w-3"
                          strokeWidth={2}
                        />
                      </span>
                      <span className="text-[12px] leading-relaxed text-white/50">
                        {l.note}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>

      <footer className="mt-16 border-t border-white/5 pt-6">
        <p className="text-center text-[13px] italic leading-relaxed text-white/40">
          reflect is opt-in, session-local by default, and never trains any
          model.
        </p>
      </footer>
    </div>
  );
}
