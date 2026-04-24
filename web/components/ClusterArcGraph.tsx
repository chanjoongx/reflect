"use client";

import { useMemo } from "react";
import type { PatternCluster } from "@/lib/types";
import { cn } from "@/lib/cn";

export interface ClusterArcGraphProps {
  clusters: PatternCluster[];
  className?: string;
}

interface Arc {
  i: number;
  j: number;
  weight: number;
}

/**
 * Decorative SVG that draws Bezier arcs between clusters sharing ≥1
 * keyword. Purely visual noise — the arcs hint at connectivity analysis
 * without attempting to be accurate positional layout.
 *
 * Renders nothing when < 3 clusters (no useful connectivity signal).
 */
export function ClusterArcGraph({ clusters, className }: ClusterArcGraphProps) {
  const { arcs, nodes } = useMemo(() => {
    if (clusters.length < 3) return { arcs: [] as Arc[], nodes: [] as number[] };

    const arcs: Arc[] = [];
    for (let i = 0; i < clusters.length; i++) {
      const a = new Set(clusters[i]!.shared_keywords);
      if (a.size === 0) continue;
      for (let j = i + 1; j < clusters.length; j++) {
        const b = clusters[j]!.shared_keywords;
        let shared = 0;
        for (const k of b) if (a.has(k)) shared++;
        if (shared >= 1) {
          arcs.push({ i, j, weight: shared });
        }
      }
    }
    return { arcs, nodes: clusters.map((_, i) => i) };
  }, [clusters]);

  if (clusters.length < 3) return null;

  const width = 1200;
  const height = 420;
  const padX = 60;
  const axisY = height / 2;
  const step = (width - padX * 2) / Math.max(1, nodes.length - 1);

  const x = (i: number) => padX + i * step;

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn(
        "absolute inset-0 h-full w-full pointer-events-none select-none",
        className,
      )}
    >
      <defs>
        <linearGradient id="arc-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-brand-purple)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--color-brand-purple)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--color-brand-purple)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g opacity={0.1}>
        {arcs.map((arc, idx) => {
          const x1 = x(arc.i);
          const x2 = x(arc.j);
          const mid = (x1 + x2) / 2;
          // Alternate arcs above / below for variety.
          const up = idx % 2 === 0;
          const spread = Math.abs(arc.j - arc.i);
          const curveHeight = Math.min(
            height / 2 - 24,
            40 + spread * 28,
          );
          const cy = up ? axisY - curveHeight : axisY + curveHeight;
          const d = `M ${x1} ${axisY} Q ${mid} ${cy} ${x2} ${axisY}`;
          return (
            <path
              key={`${arc.i}-${arc.j}`}
              d={d}
              fill="none"
              stroke="url(#arc-fade)"
              strokeWidth={1}
              strokeLinecap="round"
            />
          );
        })}
        {nodes.map((i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={axisY}
            r={2}
            fill="var(--color-brand-purple)"
          />
        ))}
      </g>
    </svg>
  );
}
