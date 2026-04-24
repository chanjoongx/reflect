import { loadSnapshot } from "@/lib/safe-read";
import { ReflectionListClient } from "@/components/ReflectionListClient";
import { ReflectionDetailPanel } from "@/components/ReflectionDetailPanel";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function ReflectionsPage() {
  const snap = await loadSnapshot();

  const log = [...snap.log].sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return tb - ta;
  });

  if (log.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-white/95">
            Reflections
          </h1>
          <p className="mt-1 text-sm text-white/55">{snap.source_label}</p>
        </header>
        <Card
          variant="default"
          padding="lg"
          className="flex flex-col items-center justify-center gap-3 text-center min-h-[280px]"
        >
          <p className="text-base text-white/85 font-medium">
            No reflections logged yet.
          </p>
          <p className="max-w-md text-sm text-white/55">
            Enable logging with{" "}
            <code className="font-mono text-[12.5px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/80">
              REFLECT_LOG_ENABLED=1
            </code>{" "}
            and trigger a reflection to populate this view.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white/95">
            Reflections
          </h1>
          <p className="mt-1 text-sm text-white/55">
            {log.length} {log.length === 1 ? "entry" : "entries"} · newest first
          </p>
        </div>
        <Badge variant={snap.source === "live" ? "confidence-high" : "neutral"}>
          {snap.source === "live" ? "live" : "fixture"} · {snap.source_label}
        </Badge>
      </header>

      <div className="flex flex-col md:flex-row gap-5">
        <aside className="w-full md:w-2/5 md:sticky md:top-[72px] md:self-start">
          <Card
            variant="default"
            padding="none"
            className="overflow-hidden"
          >
            <ScrollArea maxHeight="calc(100vh - 140px)">
              <ReflectionListClient entries={log} />
            </ScrollArea>
          </Card>
        </aside>

        <section className="flex-1 min-w-0">
          <ReflectionDetailPanel entries={log} />
        </section>
      </div>
    </div>
  );
}
