import { loadSnapshot } from "@/lib/safe-read";
import { SessionState } from "@/components/SessionState";
import { CumMeter } from "@/components/CumMeter";
import { CooldownPill } from "@/components/CooldownPill";
import { CallTimeline } from "@/components/CallTimeline";
import { ActiveGuidanceCard } from "@/components/ActiveGuidanceCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const snap = await loadSnapshot();
  const cum = snap.state?.cum_x100 ?? 0;
  const cooldown = snap.state?.cooldown_remaining ?? 0;
  const isFixture = snap.source === "fixture";

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-12">
      <section className="flex min-h-[280px] flex-col justify-end gap-5 pt-8 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="relative inline-flex h-2 w-2" aria-hidden>
            <span
              className={
                isFixture
                  ? "absolute inline-flex h-full w-full rounded-full bg-white/25"
                  : "absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-brand-teal)]/60 [animation-duration:2.4s]"
              }
            />
            <span
              className={
                isFixture
                  ? "relative inline-flex h-2 w-2 rounded-full bg-white/35"
                  : "relative inline-flex h-2 w-2 rounded-full bg-[var(--color-brand-teal)]"
              }
            />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            {isFixture ? "example data · fixture" : "watching localhost session"}
          </span>
          <span aria-hidden className="text-white/20">·</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
            {snap.source_label}
          </span>
        </div>
        <h1 className="text-5xl font-semibold tracking-tight text-white/95 sm:text-6xl">
          reflect
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-white/60">
          session-local metacognition for Claude Code
        </p>
      </section>

      <section aria-label="Live session" className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr_auto] lg:items-stretch">
        <SessionState state={snap.state} />
        <div className="rounded-xl border border-white/5 bg-[#0F0F14] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex h-full flex-col justify-between gap-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">
                reflection meter
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-white/30">
                threshold 240
              </span>
            </div>
            <CumMeter cumX100={cum} />
          </div>
        </div>
        <div className="flex items-center justify-center rounded-xl border border-white/5 bg-[#0F0F14] px-6 py-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] lg:min-w-[180px]">
          <CooldownPill remaining={cooldown} />
        </div>
      </section>

      <section aria-label="Active guidance">
        <ActiveGuidanceCard guidance={snap.active_guidance} />
      </section>

      <section aria-label="Tool call timeline">
        <CallTimeline calls={snap.recent_calls} cumX100={cum} />
      </section>
    </div>
  );
}
