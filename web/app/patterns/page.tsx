import { loadSnapshot } from "@/lib/safe-read";
import { clusterReflections } from "@/lib/pattern-detector";
import { PatternCluster } from "@/components/PatternCluster";
import { ClusterArcGraph } from "@/components/ClusterArcGraph";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Patterns — reflect",
  description:
    "Cross-session drift patterns detected by client-side clustering over your reflection log.",
};

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMs = Date.now() - t;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 10) return `${w}w ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

export default async function PatternsPage() {
  const snap = await loadSnapshot();
  const clusters = clusterReflections(snap.log);

  const reflectionCount = snap.log.length;
  const sessionIds = new Set(snap.log.map((e) => e.session_id));
  const sessionCount = sessionIds.size;

  // Map of entry-identity -> global log index. Lets each cluster row link
  // back to its position in the full reflections list.
  const indexByKey = new Map<string, number>();
  snap.log.forEach((e, i) => {
    indexByKey.set(`${e.session_id}|${e.timestamp}`, i);
  });
  const earliestIso = snap.log.length
    ? snap.log.reduce(
        (acc, e) => (e.timestamp < acc ? e.timestamp : acc),
        snap.log[0]!.timestamp,
      )
    : null;
  const earliestRel = earliestIso ? relativeTime(earliestIso) : "—";

  const empty = clusters.length < 2;

  return (
    <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
      {/* Header */}
      <header className="flex flex-col gap-3 pb-6 sm:pb-8">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1 w-6 rounded-full bg-[var(--color-brand-purple)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            cross-session analysis
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white/95">
          Patterns
        </h1>
        <p className="max-w-2xl text-sm sm:text-base leading-relaxed text-white/55">
          Drift patterns detected across your sessions. Client-side clustering
          — no API calls, no external network, deterministic Jaccard over the
          reflection log you already have on disk.
        </p>
      </header>

      {/* Stat strip */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2.5 font-mono text-[11px] text-white/60 mb-8 sm:mb-10"
        role="status"
        aria-label="Pattern analysis statistics"
      >
        <span className="tabular-nums">
          <span className="text-white/90">{clusters.length}</span>{" "}
          <span className="text-white/35">clusters</span>
        </span>
        <span aria-hidden className="text-white/15">
          ·
        </span>
        <span className="tabular-nums">
          <span className="text-white/90">{reflectionCount}</span>{" "}
          <span className="text-white/35">reflections</span>
        </span>
        <span aria-hidden className="text-white/15">
          ·
        </span>
        <span className="tabular-nums">
          <span className="text-white/90">{sessionCount}</span>{" "}
          <span className="text-white/35">
            session{sessionCount === 1 ? "" : "s"}
          </span>
        </span>
        <span aria-hidden className="text-white/15">
          ·
        </span>
        <span className="tabular-nums">
          <span className="text-white/35">earliest</span>{" "}
          <span className="text-white/90">{earliestRel}</span>
        </span>
        <span aria-hidden className="text-white/15 ml-auto hidden sm:inline">
          ·
        </span>
        <span className="text-white/35 ml-auto sm:ml-0">{snap.source_label}</span>
      </div>

      {/* Body — either empty state or grid+arcs */}
      {empty ? (
        <EmptyState count={reflectionCount} />
      ) : (
        <div className="relative">
          <ClusterArcGraph clusters={clusters} />
          <div
            className={
              "relative grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5"
            }
          >
            {clusters.map((c) => (
              <PatternCluster key={c.id} cluster={c} indexByKey={indexByKey} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ count }: { count: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/5 bg-[#0F0F14] px-6 py-10 sm:px-10 sm:py-14">
      {/* Soft purple glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[var(--color-brand-purple)]/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-4 max-w-xl">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
          no drift yet
        </span>
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-white/90">
          You haven&apos;t drifted enough yet.
        </h2>
        <p className="text-sm leading-relaxed text-white/60">
          Clusters appear after <span className="text-white/85">≥2 reflections</span>
          {" "}with overlapping token signatures. Currently{" "}
          <span className="font-mono text-white/85 tabular-nums">{count}</span>{" "}
          logged — run reflect in a real long-running session and come back
          when the revert threshold fires a second time.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/install">
            <Button variant="primary" size="sm">
              Install reflect
            </Button>
          </Link>
          <Link href="/reflections">
            <Button variant="secondary" size="sm">
              See the single reflection
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
