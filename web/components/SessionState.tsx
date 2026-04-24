import type { ViewerSessionState } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { CopySessionId } from "./CopySessionId";

interface SessionStateProps {
  state: ViewerSessionState | null;
}

export function SessionState({ state }: SessionStateProps) {
  if (!state) {
    return (
      <Card variant="ghost" padding="md" className="border border-dashed border-white/8">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white/15" />
          </span>
          <span className="text-sm text-white/50">No session detected</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30">
            waiting for .reflect/state.json
          </span>
        </div>
      </Card>
    );
  }

  const shortId = state.session_id.length > 8 ? `${state.session_id.slice(0, 8)}…` : state.session_id;

  return (
    <Card variant="default" padding="md">
      <div className="grid grid-cols-3 gap-6">
        <Stat label="session">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-white/90">{shortId}</span>
            <CopySessionId value={state.session_id} />
          </div>
        </Stat>
        <Stat label="turns">
          <span className="font-mono text-xl tabular-nums text-white/95">
            {state.turn_count}
            <span className="ml-1.5 text-[11px] uppercase tracking-wider text-white/35 font-sans">turns</span>
          </span>
        </Stat>
        <Stat label="cooldown">
          <span className="font-mono text-xl tabular-nums text-white/95">
            {state.cooldown_remaining}
            <span className="ml-1.5 text-[11px] uppercase tracking-wider text-white/35 font-sans">
              turn{state.cooldown_remaining === 1 ? "" : "s"} left
            </span>
          </span>
        </Stat>
      </div>
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-white/40 font-sans">
        {label}
      </span>
      <div className="min-h-7">{children}</div>
    </div>
  );
}
