import type { PatternCluster as PatternClusterType } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Sparkline } from "@/components/Sparkline";
import { ClusterDetails } from "@/components/ClusterDetails";
import { FadeInOnScroll } from "@/components/FadeInOnScroll";
import { ReflectionListItem } from "@/components/ReflectionListItem";
import { cn } from "@/lib/cn";

export interface PatternClusterProps {
  cluster: PatternClusterType;
  /**
   * Map of entry-identity → global log index. Used to link each row in the
   * reflection list to `/reflections#{globalIndex}`. Identity key is
   * `${session_id}|${timestamp}` which is unique per log entry in practice.
   * Missing keys fall back to the local position inside the cluster.
   */
  indexByKey?: Map<string, number>;
  className?: string;
}

function entryKey(e: PatternClusterType["entries"][number]): string {
  return `${e.session_id}|${e.timestamp}`;
}

/**
 * Cluster card. Server component — renders the header, sparkline,
 * synthesis, keyword chips, and a client-wrapped accordion for the
 * per-reflection rows.
 */
export function PatternCluster({ cluster, indexByKey, className }: PatternClusterProps) {
  const hasKeywords = cluster.shared_keywords.length > 0;

  return (
    <FadeInOnScroll className="h-full">
      <Card
        variant="elevated"
        padding="md"
        className={cn("flex flex-col gap-4 h-full", className)}
      >
        {/* Header row — label + count */}
        <div className="flex items-start justify-between gap-3">
          <h2
            className={cn(
              "font-mono text-base leading-snug tracking-tight",
              "text-white/90 break-words min-w-0",
            )}
            title={cluster.label}
          >
            {cluster.label}
          </h2>
          <Badge
            variant="scope-session"
            className="shrink-0 tabular-nums normal-case tracking-normal"
          >
            {cluster.count}×
          </Badge>
        </div>

        {/* Sparkline — temporal distribution across 7 buckets */}
        <div className="flex items-center gap-2">
          <Sparkline
            data={cluster.frequency_sparkline}
            width={120}
            height={20}
            aria-label={`Frequency distribution across ${cluster.frequency_sparkline.length} time buckets`}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
            frequency
          </span>
        </div>

        {/* Synthesis — AI-summary-feeling one-liner */}
        <div className="flex flex-col gap-1.5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-brand-teal)]/80">
            synthesis
          </h3>
          <p className="text-sm italic leading-relaxed text-white/80 line-clamp-3">
            {cluster.synthesis || "No synthesis available for this cluster."}
          </p>
        </div>

        {/* Shared keywords — the evidence of linkage */}
        {hasKeywords ? (
          <div className="flex flex-wrap gap-1.5">
            {cluster.shared_keywords.map((kw) => (
              <Badge
                key={kw}
                variant="neutral"
                className="normal-case tracking-normal font-mono text-[10px]"
              >
                {kw}
              </Badge>
            ))}
          </div>
        ) : null}

        {/* Footer — collapsible reflection list */}
        <div className="mt-auto pt-2 border-t border-white/5">
          <ClusterDetails count={cluster.count}>
            {cluster.entries.map((entry, i) => {
              const globalIdx = indexByKey?.get(entryKey(entry)) ?? i;
              return (
                <ReflectionListItem
                  key={`${entry.timestamp}-${i}`}
                  entry={entry}
                  index={globalIdx}
                  routePrefix="/reflections"
                />
              );
            })}
          </ClusterDetails>
        </div>
      </Card>
    </FadeInOnScroll>
  );
}
