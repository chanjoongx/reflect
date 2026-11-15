import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Roadmap · reflect",
  description: "What 0.1 did, what 0.2 changed, and what is still unmeasured.",
};

type Milestone = {
  version: string;
  label: string;
  accent: "teal" | "orange" | "purple";
  bullets: string[];
};

const milestones: Milestone[] = [
  {
    version: "0.1",
    label: "April 2026 · replaced",
    accent: "orange",
    bullets: [
      "Built at the Built with Opus 4.7 hackathon. It counted git reverts, deleted files and English phrases, and asked Opus 4.7 for a reflection when the weighted count reached 240.",
      "Shell hooks kept the count in .reflect/state.json, and a path-scoped rule was meant to load the result from session-guidance.md.",
      "Measured afterwards, it never fired: zero reflections over 109 real sessions in July, and 0 of 141 pushback turns found on an 837-turn benchmark.",
    ],
  },
  {
    version: "0.2",
    label: "built · not yet released",
    accent: "teal",
    bullets: [
      "Each message after the agent's first reply is judged by Claude Haiku 5.5, with the agent's previous turn beside it. The judge runs in the background.",
      "Two pushbacks (correction, rejection or failure report) within six developer turns trigger a note, followed by three turns of cooldown.",
      "Claude Opus 5.5 writes the note from exactly those turns: the pattern, what the pushback is about, one adjustment, a check to run first, how the note could be wrong, and an expiry of 3 to 12 turns.",
      "The agent receives the note once, as hook context on its next tool call or prompt, and again after a compaction while the note is in force.",
      "Each session is one append-only log in .reflect/sessions/, deleted 7 days after its last event. A per-session spend cap (default $0.50) stops the API calls. This Viewer reads that log.",
    ],
  },
  {
    version: "next",
    label: "open questions",
    accent: "purple",
    bullets: [
      "Rerun the benchmark with the Haiku 5.5 judge. The published precision and recall were measured with Haiku 4.5.",
      "Have a person check the reference labels, which today come from Claude Opus 5.",
      "Find out in real sessions whether a delivered note changes what the agent does next.",
      "Measure what a note costs on Opus 5.5; the current figure is an estimate.",
      "Recall: the judge misses about half of real pushback, mostly by reading a correction as a new instruction.",
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
    href: "https://github.com/chanjoongx/reflect/blob/main/bench/FINDINGS.md",
    title: "bench/FINDINGS.md",
    note: "Why 0.1 never fired, and how the 0.2 judge and trigger were measured",
  },
  {
    href: "https://github.com/chanjoongx/reflect/blob/main/CHANGELOG.md",
    title: "CHANGELOG.md",
    note: "What 0.2 changed, added and removed, and its known gaps",
  },
  {
    href: "https://github.com/chanjoongx/reflect/blob/main/docs/v0.1/experiments/ablation-with-without.md",
    title: "docs/v0.1/experiments/ablation-with-without.md",
    note: "0.1: why the controlled ablation was deferred",
  },
  {
    href: "https://github.com/chanjoongx/reflect/blob/main/docs/v0.1/measurements.md",
    title: "docs/v0.1/measurements.md",
    note: "0.1: cache hit rates, cost and token counts",
  },
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="flex flex-col gap-3 border-b border-white/5 pb-8">
        <div className="flex items-center gap-2">
          <Badge variant="scope-wider">Trajectory</Badge>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">0.1 · 0.2 · next</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-white/95">Roadmap</h1>
        <p className="max-w-2xl text-base leading-relaxed text-white/60">
          What the hackathon build did, what 0.2 replaced it with, and what has not been measured yet.
        </p>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_18rem]">
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-2 left-[15px] top-2 w-px bg-gradient-to-b from-[var(--color-brand-orange)]/30 via-[var(--color-brand-teal)]/40 to-[var(--color-brand-purple)]/40"
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
                  <span className={cn("h-2 w-2 rounded-full", accentBullet[m.accent])} />
                </span>

                <Card variant="elevated" padding="lg">
                  <CardHeader>
                    <div className="flex flex-wrap items-baseline gap-3">
                      <CardTitle className={cn("text-xl", accentBadge[m.accent])}>{m.version}</CardTitle>
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
                        {m.label}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-2.5">
                      {m.bullets.map((bullet, i) => (
                        <li key={i} className="flex items-start gap-3 text-[14px] leading-relaxed text-white/75">
                          <span
                            aria-hidden
                            className={cn("mt-2 h-1 w-1 shrink-0 rounded-full", accentBullet[m.accent])}
                          />
                          <span>{bullet}</span>
                        </li>
                      ))}
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
                Evidence and decisions
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
                      <span className="inline-flex items-center gap-1.5 break-all font-mono text-[12px] text-[var(--color-brand-purple)] transition-colors group-hover:text-[#c4b1ff]">
                        {l.title}
                        <ExternalLink aria-hidden className="h-3 w-3 shrink-0" strokeWidth={2} />
                      </span>
                      <span className="text-[12px] leading-relaxed text-white/50">{l.note}</span>
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
          Everything reflect keeps stays in .reflect/ in your project. Nothing is shared between sessions.
        </p>
      </footer>
    </div>
  );
}
