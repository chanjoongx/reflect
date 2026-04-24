"use client";

import { useId, useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { ArrowRight, Compass, Waves } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import {
  barGrow,
  cardReveal,
  sectionItem,
  sectionStagger,
  underlineSweep,
} from "@/lib/motion";
import { cn } from "@/lib/cn";
import type { CallCost, Reflection } from "@/lib/types";

export interface ReflectionCardProps {
  reflection: Reflection;
  metadata?: {
    timestamp?: string;
    cost?: CallCost;
    cache_hit_rate?: number;
    latency_ms?: number;
    session_id?: string;
  };
  variant?: "default" | "active" | "compact";
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

function formatRelative(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function formatUsd(usd?: number): string {
  if (usd == null) return "";
  return `$${usd.toFixed(4)}`;
}

function formatLatency(ms?: number): string {
  if (ms == null) return "";
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCacheHit(rate?: number): string {
  if (rate == null) return "";
  return `${Math.round(rate * 100)}%`;
}

function Body({ children }: { children: string }) {
  return (
    <div className="font-mono text-[13.5px] leading-[1.65] text-white/85 [&_p]:m-0 [&_p+p]:mt-2 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:bg-white/[0.05] [&_code]:px-1 [&_code]:py-[1px] [&_code]:rounded [&_strong]:text-white [&_em]:text-white/95 [&_a]:text-[var(--color-brand-purple)] [&_a:hover]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5">
      <Markdown rehypePlugins={SANITIZE_PLUGINS}>{children}</Markdown>
    </div>
  );
}

interface SectionProps {
  label: string;
  labelColor: string;
  borderColor: string;
  icon: ReactNode;
  body: string;
  emphasize?: boolean;
  reduced: boolean;
}

function Section({
  label,
  labelColor,
  borderColor,
  icon,
  body,
  emphasize,
  reduced,
}: SectionProps) {
  return (
    <motion.section
      variants={reduced ? undefined : sectionItem}
      className={cn(
        "relative pl-4 py-2",
        emphasize && "rounded-md bg-[var(--color-brand-teal)]/[0.03]"
      )}
    >
      <motion.span
        aria-hidden
        variants={reduced ? undefined : barGrow}
        style={{
          originY: 0,
          backgroundColor: borderColor,
        }}
        className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full"
      />
      <div className="relative flex items-center gap-2 mb-2">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-md"
          style={{ color: labelColor }}
          aria-hidden
        >
          {icon}
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: labelColor }}
        >
          {label}
        </span>
        {emphasize ? (
          <motion.span
            aria-hidden
            variants={reduced ? undefined : underlineSweep}
            style={{
              originX: 0,
              backgroundColor: labelColor,
            }}
            className="ml-1 block h-[1.5px] w-16 rounded-full opacity-80"
          />
        ) : null}
      </div>
      <Body>{body}</Body>
    </motion.section>
  );
}

export function ReflectionCard({
  reflection,
  metadata,
  variant = "default",
  className,
}: ReflectionCardProps) {
  const reduced = useReducedMotion() ?? false;
  const headerId = useId();

  const initial = reduced ? "visible" : "hidden";
  const animate = "visible";

  const relative = useMemo(
    () => formatRelative(metadata?.timestamp),
    [metadata?.timestamp]
  );

  const confidence = reflection.confidence;
  const scope = reflection.scope;
  const ft = reflection.false_trigger_likelihood;

  return (
    <motion.div
      role="article"
      aria-labelledby={headerId}
      initial={initial}
      animate={animate}
      variants={reduced ? undefined : cardReveal}
      className={cn(
        "relative",
        variant === "active" &&
          "rounded-xl ring-2 ring-[var(--color-brand-teal)]/30 animate-pulse",
        className
      )}
    >
      <Card
        variant="default"
        padding={variant === "compact" ? "sm" : "md"}
        className="relative overflow-hidden"
      >
        <header
          id={headerId}
          className="flex flex-wrap items-start justify-between gap-3 pb-3 mb-1 border-b border-white/[0.04]"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={confidenceVariantMap[confidence]}>
              {confidence} conf
            </Badge>
            <Badge
              variant={
                scope === "wider_concern" ? "scope-wider" : "scope-session"
              }
            >
              {scope === "wider_concern" ? "wider concern" : "this session"}
            </Badge>
            <Badge variant={ftVariantMap[ft]}>FT · {ft}</Badge>
          </div>
          {metadata?.timestamp ? (
            <time
              dateTime={metadata.timestamp}
              title={metadata.timestamp}
              className="font-mono text-[11px] text-white/45 tabular-nums"
            >
              {relative}
            </time>
          ) : null}
        </header>

        <motion.div
          variants={reduced ? undefined : sectionStagger}
          initial={initial}
          animate={animate}
          className="flex flex-col gap-3 pt-1"
        >
          <Section
            reduced={reduced}
            label="Pattern"
            labelColor="var(--color-brand-blue)"
            borderColor="var(--color-brand-blue)"
            icon={<Compass size={13} strokeWidth={2.25} />}
            body={reflection.pattern}
          />
          <Section
            reduced={reduced}
            label="Signal"
            labelColor="var(--color-brand-orange)"
            borderColor="var(--color-brand-orange)"
            icon={<Waves size={13} strokeWidth={2.25} />}
            body={reflection.signal}
          />
          <Section
            reduced={reduced}
            label="Adjustment"
            labelColor="var(--color-brand-teal)"
            borderColor="var(--color-brand-teal)"
            icon={<ArrowRight size={13} strokeWidth={2.25} />}
            body={reflection.adjustment}
            emphasize
          />
        </motion.div>

        {metadata &&
        (metadata.cost ||
          metadata.latency_ms != null ||
          metadata.cache_hit_rate != null) ? (
          <footer className="mt-4 pt-3 flex flex-wrap items-center gap-1.5 border-t border-white/[0.04]">
            <Pill
              tone="purple"
              size="sm"
              value="opus-4.7"
              label="model"
            />
            {metadata.latency_ms != null ? (
              <Pill
                tone="neutral"
                size="sm"
                value={formatLatency(metadata.latency_ms)}
                label="latency"
              />
            ) : null}
            {metadata.cache_hit_rate != null ? (
              <Pill
                tone="teal"
                size="sm"
                value={formatCacheHit(metadata.cache_hit_rate)}
                label="cache hit"
              />
            ) : null}
            {metadata.cost ? (
              <Pill
                tone="orange"
                size="sm"
                value={formatUsd(metadata.cost.usd)}
                label="cost"
              />
            ) : null}
          </footer>
        ) : null}
      </Card>
    </motion.div>
  );
}

export default ReflectionCard;
