import { cn } from "@/lib/cn";

export interface SparklineProps {
  data: number[];
  className?: string;
  /** Base fill color — CSS color string. Defaults to brand-purple. */
  color?: string;
  width?: number;
  height?: number;
  "aria-label"?: string;
}

/**
 * Micro-bar sparkline. Pure SVG, no dependencies.
 *
 * All bars share the full height range of `data` — so a single-bucket
 * dataset still renders at full height. Empty / all-zero data gets a
 * dashed placeholder line.
 */
export function Sparkline({
  data,
  className,
  color = "var(--color-brand-purple)",
  width = 84,
  height = 24,
  "aria-label": ariaLabel,
}: SparklineProps) {
  const len = data.length;
  const max = data.reduce((m, v) => (v > m ? v : m), 0);
  const allZero = max === 0 || len === 0;

  if (allZero) {
    // Empty placeholder — thin dashed line.
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel ?? "No data"}
        className={cn("block", className)}
      >
        <line
          x1={2}
          x2={width - 2}
          y1={height / 2}
          y2={height / 2}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const gap = 1.5;
  const barW = Math.max(1, (width - gap * (len - 1)) / len);
  const gradId = `spark-grad-${data.join("-")}-${width}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `Sparkline of ${len} buckets, max ${max}`}
      className={cn("block overflow-visible", className)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {data.map((v, i) => {
        const h = v === 0 ? 1.5 : Math.max(1.5, (v / max) * (height - 2));
        const x = i * (barW + gap);
        const y = height - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={0.75}
            fill={v === 0 ? "rgba(255,255,255,0.12)" : `url(#${gradId})`}
          />
        );
      })}
    </svg>
  );
}
