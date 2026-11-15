import type { WindowView } from "@/lib/types";
import { LABEL_TEXT } from "@/lib/session";
import { cn } from "@/lib/cn";
import { STATUS_TEXT, labelColor } from "./turn-style";

interface WindowMeterProps {
  window: WindowView;
}

/**
 * The trigger as the hook sees it: the last `window` developer turns, which of
 * them count toward the next fire, and the cooldown after the last one.
 */
export function WindowMeter({ window: w }: WindowMeterProps) {
  const { policy } = w;
  const empty = Array.from({ length: Math.max(0, policy.window - w.cells.length) });
  const full = w.counted >= policy.k;

  let status: string;
  if (w.currentTurn === 0) status = "no turns yet";
  else if (w.cooldownLeft > 0) status = "cooling down";
  else if (w.nextPushbackFires) status = "next pushback fires";
  else status = "watching";

  return (
    <div className="flex w-full flex-col gap-3">
      <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${policy.window}, minmax(0, 1fr))` }}>
        {empty.map((_, i) => (
          <li key={`empty-${i}`} aria-hidden className="flex flex-col items-center gap-1">
            <span className="h-7 w-full rounded-md border border-dashed border-white/[0.06]" />
            <span className="font-mono text-[10px] text-white/15">·</span>
          </li>
        ))}
        {w.cells.map((c) => {
          const text =
            c.status === "pushback" || c.status === "judged"
              ? `${c.label ? LABEL_TEXT[c.label] : STATUS_TEXT[c.status]}${c.counted ? ", counts" : ""}`
              : STATUS_TEXT[c.status];
          return (
            <li key={c.n} className="flex flex-col items-center gap-1" title={`turn ${c.n}: ${text}`}>
              <span
                className={cn(
                  "relative h-7 w-full overflow-hidden rounded-md border",
                  c.status === "pushback" ? "border-transparent" : "border-white/8 bg-white/[0.03]",
                  c.status === "pending" && "border-dashed border-[var(--color-brand-teal)]/50 animate-pulse",
                  (c.status === "skipped" || c.status === "unjudged") && "border-dashed",
                )}
                style={
                  c.status === "pushback"
                    ? {
                        backgroundColor: labelColor(c.label),
                        opacity: c.counted ? 1 : 0.35,
                        boxShadow: c.counted ? `0 0 10px ${labelColor(c.label)}` : "none",
                      }
                    : undefined
                }
              >
                {c.cooldown ? (
                  <span
                    aria-hidden
                    className="absolute inset-0"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(135deg, rgba(212,162,127,0.18) 0 3px, transparent 3px 7px)",
                    }}
                  />
                ) : null}
                <span className="sr-only">{`turn ${c.n}: ${text}${c.cooldown ? ", in cooldown" : ""}`}</span>
              </span>
              <span className="font-mono text-[10px] tabular-nums text-white/40">{c.n}</span>
            </li>
          );
        })}
      </ol>
      <div className="flex items-baseline justify-between gap-4 font-mono text-[11px]">
        <span className="text-white/55">
          pushback{" "}
          <span className={cn("tabular-nums", full ? "text-[var(--color-brand-teal)]" : "text-white/90")}>
            {w.counted}
          </span>
          <span className="text-white/35">
            {" "}
            / {policy.k} in {policy.window} turns
          </span>
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-white/35">{status}</span>
      </div>
      {w.pending > 0 ? (
        <p className="font-mono text-[10px] text-white/35">
          {w.pending} turn{w.pending === 1 ? "" : "s"} still with the judge
        </p>
      ) : null}
    </div>
  );
}
