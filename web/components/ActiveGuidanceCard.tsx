import type { ActiveGuidance } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { ReflectionCard } from "@/components/ReflectionCard";
import { GhostPulse } from "./GhostPulse";

interface ActiveGuidanceCardProps {
  guidance: ActiveGuidance | null;
}

export function ActiveGuidanceCard({ guidance }: ActiveGuidanceCardProps) {
  if (!guidance) {
    return (
      <Card
        variant="ghost"
        padding="lg"
        className="border border-dashed border-white/10 bg-[var(--color-panel)]/40"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <GhostPulse />
            <div className="flex flex-col gap-0.5">
              <h2 className="text-sm font-semibold tracking-tight text-white/85">
                No active reflection
              </h2>
              <p className="text-[12px] text-white/50">
                Fires when 3 revert signals cluster (cum_x100 ≥ 240).
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-white/6 pt-4">
            <span className="text-[11px] text-white/45">Trigger manually with</span>
            <code className="rounded-md border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[11px] text-[var(--color-brand-purple)]">
              /brain-reflect
            </code>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <ReflectionCard
      reflection={guidance.reflection}
      metadata={{ timestamp: guidance.last_triggered }}
      variant="active"
    />
  );
}
