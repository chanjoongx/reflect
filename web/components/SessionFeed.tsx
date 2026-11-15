import Link from "next/link";
import type { FeedItem } from "@/lib/types";
import { LABEL_TEXT, VIA_TEXT, formatClock, formatUsd, skipText } from "@/lib/session";
import { cn } from "@/lib/cn";
import { STATUS_TEXT, labelColor } from "./turn-style";

interface SessionFeedProps {
  feed: FeedItem[];
}

/** The session's log in the order it was written, newest at the bottom. */
export function SessionFeed({ feed }: SessionFeedProps) {
  if (feed.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-white/90">Session log</h2>
        <p className="mt-0.5 text-[11px] text-white/45">
          events.jsonl in order · each turn shows its verdict even when the judge answered later
        </p>
      </div>
      <ol className="flex flex-col divide-y divide-white/[0.04] overflow-hidden rounded-xl border border-white/8 bg-[var(--color-panel)]">
        {feed.map((item, i) => (
          <li key={i} className="px-4 py-3">
            <Row item={item} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function Time({ at }: { at: string | null }) {
  if (!at) return <span className="w-28 shrink-0" />;
  return (
    <time dateTime={at} title={at} className="w-28 shrink-0 font-mono text-[10.5px] tabular-nums text-white/35">
      {formatClock(at).replace(" UTC", "")}
    </time>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color }}>
      {children}
    </span>
  );
}

function Row({ item }: { item: FeedItem }) {
  switch (item.kind) {
    case "turn": {
      const t = item.turn;
      const v = t.verdict;
      return (
        <div className="flex gap-3">
          <Time at={t.at} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-[12px] text-white/85">turn {t.n}</span>
              {v ? (
                <>
                  <Tag color={labelColor(v.label)}>{LABEL_TEXT[v.label]}</Tag>
                  <span className="font-mono text-[10px] text-white/40">{v.confidence} confidence</span>
                  <span className="font-mono text-[10px] text-white/30">{formatUsd(v.costUSD)}</span>
                </>
              ) : t.status === "skipped" ? (
                <Tag color="rgba(255,255,255,0.4)">skipped: {skipText(t.skip?.reason ?? "")}</Tag>
              ) : (
                <Tag color={t.status === "pending" ? "var(--color-brand-teal)" : "rgba(255,255,255,0.4)"}>
                  {STATUS_TEXT[t.status]}
                </Tag>
              )}
            </div>
            {v?.evidence ? (
              <p className="break-words font-mono text-[12px] leading-snug text-white/75">&ldquo;{v.evidence}&rdquo;</p>
            ) : null}
            {v?.rationale ? <p className="break-words text-[12px] leading-snug text-white/45">{v.rationale}</p> : null}
          </div>
        </div>
      );
    }
    case "fire": {
      const f = item.fire;
      return (
        <div className="flex gap-3">
          <Time at={f.at} />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Tag color="var(--color-brand-teal)">trigger fired</Tag>
            <span className="font-mono text-[12px] text-white/75">
              {f.turn !== null ? `on turn ${f.turn}` : ""}
              {f.evidenceTurns.length ? `, pushback on turns ${f.evidenceTurns.join(", ")}` : ""}
            </span>
            <span className="font-mono text-[10px] text-white/35">policy {f.policyId}</span>
          </div>
        </div>
      );
    }
    case "note": {
      const n = item.note;
      return (
        <div className="flex gap-3">
          <Time at={n.at} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Tag color="var(--color-brand-purple)">{n.manual ? "note requested" : "note written"}</Tag>
              <Link
                href={`/reflections#${n.id}`}
                className="font-mono text-[12px] text-[var(--color-brand-purple)] underline-offset-4 hover:underline"
              >
                {n.id}
              </Link>
              <span className="font-mono text-[10px] text-white/35">
                {n.model} · {formatUsd(n.costUSD)} · {(n.latencyMs / 1000).toFixed(1)}s
              </span>
            </div>
            <p className="break-words font-mono text-[12px] leading-snug text-white/75">{n.note.adjustment}</p>
          </div>
        </div>
      );
    }
    case "delivery":
      return (
        <div className="flex gap-3">
          <Time at={item.at} />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Tag color="rgba(95,229,212,0.7)">delivered</Tag>
            <span className="font-mono text-[12px] text-white/65">
              {item.noteId} {VIA_TEXT[item.via] ?? item.via}
            </span>
          </div>
        </div>
      );
    case "error":
      return (
        <div className="flex gap-3">
          <Time at={item.error.at} />
          <div className={cn("flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2")}>
            <Tag color="#ef7474">error in {item.error.where}</Tag>
            <span className="break-words font-mono text-[12px] text-white/65">{item.error.message}</span>
          </div>
        </div>
      );
  }
}
