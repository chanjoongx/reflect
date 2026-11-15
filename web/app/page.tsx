import { loadSnapshot, pickSession } from "@/lib/safe-read";
import { DEFAULT_POLICY_ID, policyById } from "@/lib/session";
import type { TriggerPolicy } from "@/lib/types";
import { SessionState } from "@/components/SessionState";
import { SessionPicker } from "@/components/SessionPicker";
import { WindowMeter } from "@/components/WindowMeter";
import { CooldownPill } from "@/components/CooldownPill";
import { TurnTimeline } from "@/components/TurnTimeline";
import { SessionFeed } from "@/components/SessionFeed";
import { ActiveGuidanceCard } from "@/components/ActiveGuidanceCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const snap = await loadSnapshot();
  const session = pickSession(snap, (await searchParams).session);
  const isFixture = snap.source === "fixture";
  const policy: TriggerPolicy = session?.window.policy ?? (policyById(DEFAULT_POLICY_ID) as TriggerPolicy);

  return (
    <div className="mx-auto max-w-6xl space-y-12 px-6 py-12">
      <section className="flex min-h-[280px] flex-col justify-end gap-5 pb-4 pt-8">
        <div className="flex flex-wrap items-center gap-2.5">
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
            {isFixture ? "example data · fixture" : "reading local sessions"}
          </span>
          <span aria-hidden className="text-white/20">
            ·
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">{snap.source_label}</span>
          {snap.disabled ? (
            <span className="rounded-full border border-[rgba(239,116,116,0.3)] bg-[rgba(239,116,116,0.1)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#ef7474]">
              reflect is off for this project
            </span>
          ) : null}
        </div>
        <h1 className="text-5xl font-semibold tracking-tight text-white/95 sm:text-6xl">reflect</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-white/60">
          Notices when you keep pushing back on Claude Code, works out why, and tells the agent before its next
          step.
        </p>
        {isFixture ? (
          <p className="max-w-2xl text-[13px] leading-relaxed text-white/45">
            No sessions found in the project&apos;s <code className="font-mono text-[12px]">.reflect/sessions/</code>
            , so this is example data. Set <code className="font-mono text-[12px]">REFLECT_PROJECT_DIR</code> to
            the project you use reflect in.
            {snap.legacyFiles
              ? " That folder holds files from reflect 0.1 (state.json, session-log.jsonl), which this Viewer no longer reads."
              : ""}
          </p>
        ) : null}
      </section>

      <SessionPicker sessions={snap.sessions} activeId={session?.id ?? null} />

      <section
        aria-label="Session"
        className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr_auto] lg:items-stretch"
      >
        <SessionState session={session} />
        <div className="rounded-xl border border-white/5 bg-[#0F0F14] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex h-full flex-col justify-between gap-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">trigger window</span>
              <span
                className="font-mono text-[10px] uppercase tracking-wider text-white/30"
                title={session ? `policy from ${session.window.policySource}` : undefined}
              >
                {policy.id}
              </span>
            </div>
            {session ? (
              <WindowMeter window={session.window} />
            ) : (
              <p className="font-mono text-[11px] text-white/40">no session</p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-center rounded-xl border border-white/5 bg-[#0F0F14] px-6 py-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] lg:min-w-[180px]">
          <CooldownPill remaining={session?.window.cooldownLeft ?? 0} />
        </div>
      </section>

      {session && (session.truncated || session.badLines > 0) ? (
        <p className="font-mono text-[11px] text-[var(--color-brand-orange)]">
          {session.truncated ? "This log is over 4 MB; only its most recent part was read, so turn numbers start late. " : ""}
          {session.badLines > 0
            ? `${session.badLines} line${session.badLines === 1 ? " was" : "s were"} not a known event and ${session.badLines === 1 ? "was" : "were"} skipped.`
            : ""}
        </p>
      ) : null}

      <section aria-label="Current note">
        <ActiveGuidanceCard note={session?.current ?? null} policy={policy} />
      </section>

      {session ? (
        <>
          <section aria-label="Developer turns">
            <TurnTimeline turns={session.turns} fires={session.fires} notes={session.notes} />
          </section>
          <section aria-label="Session log">
            <SessionFeed feed={session.feed} />
          </section>
        </>
      ) : null}
    </div>
  );
}
