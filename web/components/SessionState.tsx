import type { SessionView } from "@/lib/types";
import { formatUsd } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { CopySessionId } from "./CopySessionId";

interface SessionStateProps {
  session: SessionView | null;
}

export function SessionState({ session }: SessionStateProps) {
  if (!session) {
    return (
      <Card variant="ghost" padding="md" className="border border-dashed border-white/8">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white/15" />
          </span>
          <span className="text-sm text-white/50">No session recorded</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
            waiting for .reflect/sessions/
          </span>
        </div>
      </Card>
    );
  }

  const shortId = session.id.length > 8 ? `${session.id.slice(0, 8)}…` : session.id;
  const { spend } = session;
  const pct = spend.capUSD > 0 ? Math.min(100, (spend.usd / spend.capUSD) * 100) : 100;
  const over = spend.usd >= spend.capUSD;

  return (
    <Card variant="default" padding="md">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Stat label="session">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-white/90" title={session.id}>
              {shortId}
            </span>
            <CopySessionId value={session.id} />
          </div>
        </Stat>
        <Stat label="developer turns">
          <span className="font-mono text-xl tabular-nums text-white/95">
            {session.turns.length}
            <span className="ml-1.5 font-sans text-[11px] uppercase tracking-wider text-white/35">
              {session.judged} judged
            </span>
          </span>
          {session.errors.length > 0 ? (
            <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-[#ef7474]/80">
              {session.errors.length} error{session.errors.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </Stat>
        <Stat label="spend">
          <span className="font-mono text-xl tabular-nums text-white/95">
            {formatUsd(spend.usd)}
            <span className="ml-1.5 font-sans text-[11px] uppercase tracking-wider text-white/35">
              of {formatUsd(spend.capUSD)}
            </span>
          </span>
          <div
            className="mt-2 h-1 w-full overflow-hidden rounded-full border border-white/8 bg-white/[0.04]"
            role="meter"
            aria-label="Spend against the per-session cap"
            aria-valuemin={0}
            aria-valuemax={spend.capUSD}
            aria-valuenow={spend.usd}
          >
            <div
              className={cn("h-full rounded-full", over ? "bg-[#ef7474]" : "bg-[var(--color-brand-orange)]")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="mt-1.5 block font-mono text-[10px] text-white/35">
            judge {formatUsd(spend.judgeUSD)} · notes {formatUsd(spend.reflectionUSD)} · cap{" "}
            {spend.capSource === "default" ? "default" : `from ${spend.capSource}`}
            {spend.stoppedAtCap ? " · stopped at cap" : ""}
          </span>
        </Stat>
      </div>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</span>
      <div className="min-h-7">{children}</div>
    </div>
  );
}
