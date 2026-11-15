"use client";

import { useId, useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { ArrowRight, CircleQuestionMark, Compass, ListChecks, Waves } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { barGrow, cardReveal, sectionItem, sectionStagger, underlineSweep } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { VIA_TEXT, formatClock, formatRelative, formatUsd } from "@/lib/session";
import type { NoteView } from "@/lib/types";
import { NOTE_STATE_TEXT } from "./turn-style";

export interface ReflectionCardProps {
  view: NoteView;
  variant?: "default" | "active" | "compact";
  /** Show which session the note belongs to (pages that mix sessions). */
  showSession?: boolean;
  className?: string;
}

const SANITIZE_PLUGINS = [rehypeSanitize];

const confidenceVariantMap = {
  low: "confidence-low",
  medium: "confidence-medium",
  high: "confidence-high",
} as const;

const ftVariantMap = {
  low: "ft-low",
  medium: "ft-medium",
  high: "ft-high",
} as const;

function Body({ children }: { children: string }) {
  return (
    <div className="font-mono text-[13.5px] leading-[1.65] text-white/85 [&_p]:m-0 [&_p+p]:mt-2 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:bg-white/[0.05] [&_code]:px-1 [&_code]:py-[1px] [&_code]:rounded [&_strong]:text-white [&_em]:text-white/95 [&_a]:text-[var(--color-brand-purple)] [&_a:hover]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5">
      <Markdown rehypePlugins={SANITIZE_PLUGINS}>{children}</Markdown>
    </div>
  );
}

interface SectionProps {
  label: string;
  color: string;
  icon: ReactNode;
  body: string;
  emphasize?: boolean;
  reduced: boolean;
}

function Section({ label, color, icon, body, emphasize, reduced }: SectionProps) {
  return (
    <motion.section
      variants={reduced ? undefined : sectionItem}
      className={cn("relative py-2 pl-4", emphasize && "rounded-md bg-[var(--color-brand-teal)]/[0.03]")}
    >
      <motion.span
        aria-hidden
        variants={reduced ? undefined : barGrow}
        style={{ originY: 0, backgroundColor: color }}
        className="absolute bottom-1 left-0 top-1 w-[3px] rounded-full"
      />
      <div className="relative mb-2 flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md" style={{ color }} aria-hidden>
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color }}>
          {label}
        </span>
        {emphasize ? (
          <motion.span
            aria-hidden
            variants={reduced ? undefined : underlineSweep}
            style={{ originX: 0, backgroundColor: color }}
            className="ml-1 block h-[1.5px] w-16 rounded-full opacity-80"
          />
        ) : null}
      </div>
      <Body>{body}</Body>
    </motion.section>
  );
}

export function ReflectionCard({ view, variant = "default", showSession = false, className }: ReflectionCardProps) {
  const reduced = useReducedMotion() ?? false;
  const headerId = useId();
  const initial = reduced ? "visible" : "hidden";
  const relative = useMemo(() => formatRelative(view.at), [view.at]);
  const n = view.note;

  const stateText =
    view.state === "in-force" && view.turnsLeft !== null
      ? `${NOTE_STATE_TEXT[view.state]} · ${view.turnsLeft} turn${view.turnsLeft === 1 ? "" : "s"} left`
      : NOTE_STATE_TEXT[view.state];

  const origin = view.manual
    ? "requested with /chanjoongx-reflect:brain-reflect"
    : view.evidenceTurns.length
      ? `from pushback on turns ${view.evidenceTurns.join(", ")}`
      : view.turn !== null
        ? `at turn ${view.turn}`
        : "";

  return (
    <motion.div
      role="article"
      aria-labelledby={headerId}
      initial={initial}
      animate="visible"
      variants={reduced ? undefined : cardReveal}
      className={cn("relative", variant === "active" && "rounded-xl ring-2 ring-[var(--color-brand-teal)]/30", className)}
    >
      <Card variant="default" padding={variant === "compact" ? "sm" : "md"} className="relative overflow-hidden">
        <header
          id={headerId}
          className="mb-1 flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.04] pb-3"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={view.state === "in-force" ? "confidence-high" : view.state === "waiting" ? "confidence-medium" : "neutral"}>
              {stateText}
            </Badge>
            <Badge variant={confidenceVariantMap[n.confidence]}>{n.confidence} conf</Badge>
            <Badge variant={n.scope === "wider_concern" ? "scope-wider" : "scope-session"}>
              {n.scope === "wider_concern" ? "wider concern" : "this session"}
            </Badge>
            <Badge variant={ftVariantMap[n.false_trigger_likelihood]}>FT · {n.false_trigger_likelihood}</Badge>
          </div>
          <time dateTime={view.at} title={view.at} className="font-mono text-[11px] tabular-nums text-white/45">
            {relative}
          </time>
        </header>

        {origin || showSession ? (
          <p className="pb-1 pt-2 font-mono text-[11px] text-white/45">
            {origin}
            {showSession ? (
              <>
                {origin ? " · " : ""}session <span title={view.sessionId}>{view.sessionId.slice(0, 8)}</span>
              </>
            ) : null}
          </p>
        ) : null}

        <motion.div
          variants={reduced ? undefined : sectionStagger}
          initial={initial}
          animate="visible"
          className="flex flex-col gap-3 pt-1"
        >
          <Section
            reduced={reduced}
            label="Pattern"
            color="var(--color-brand-blue)"
            icon={<Compass size={13} strokeWidth={2.25} />}
            body={n.pattern || "(none given)"}
          />
          <Section
            reduced={reduced}
            label="Signal"
            color="var(--color-brand-orange)"
            icon={<Waves size={13} strokeWidth={2.25} />}
            body={n.signal || "(none given)"}
          />
          <Section
            reduced={reduced}
            label={`Adjustment · next ${n.expires_after_turns} turns`}
            color="var(--color-brand-teal)"
            icon={<ArrowRight size={13} strokeWidth={2.25} />}
            body={n.adjustment}
            emphasize
          />
          {n.verify ? (
            <Section
              reduced={reduced}
              label="Check first"
              color="var(--color-brand-purple)"
              icon={<ListChecks size={13} strokeWidth={2.25} />}
              body={n.verify}
            />
          ) : null}
          {n.counter_hypothesis ? (
            <Section
              reduced={reduced}
              label="Wrong if"
              color="rgba(255,255,255,0.55)"
              icon={<CircleQuestionMark size={13} strokeWidth={2.25} />}
              body={n.counter_hypothesis}
            />
          ) : null}
        </motion.div>

        <div className="mt-4 border-t border-white/[0.04] pt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Delivery</p>
          {view.deliveries.length === 0 ? (
            <p className="font-mono text-[12px] text-white/55">
              Not delivered yet. The agent gets it with its next tool call or your next prompt.
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {view.deliveries.map((d, i) => (
                <li key={`${d.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2 font-mono text-[12px] text-white/70">
                  <time dateTime={d.at} className="tabular-nums text-white/45">
                    {formatClock(d.at)}
                  </time>
                  <span>{VIA_TEXT[d.via] ?? d.via}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/[0.04] pt-3">
          {view.model ? <Pill tone="purple" size="sm" value={view.model} label="model" /> : null}
          {view.latencyMs > 0 ? (
            <Pill tone="neutral" size="sm" value={`${(view.latencyMs / 1000).toFixed(1)}s`} label="latency" />
          ) : null}
          <Pill tone="orange" size="sm" value={formatUsd(view.costUSD)} label="cost" />
          <Pill tone="neutral" size="sm" value={view.id} label="id" />
        </footer>
      </Card>
    </motion.div>
  );
}

export default ReflectionCard;
