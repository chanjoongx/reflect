import { loadSnapshot } from "@/lib/safe-read";
import { allNotes } from "@/lib/session";
import { ReflectionListClient } from "@/components/ReflectionListClient";
import { ReflectionDetailPanel } from "@/components/ReflectionDetailPanel";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function ReflectionsPage() {
  const snap = await loadSnapshot();
  const notes = allNotes(snap);

  if (notes.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-white/95">Notes</h1>
          <p className="mt-1 text-sm text-white/55">{snap.source_label}</p>
        </header>
        <Card
          variant="default"
          padding="lg"
          className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center"
        >
          <p className="text-base font-medium text-white/85">No notes in the recorded sessions.</p>
          <p className="max-w-md text-sm text-white/55">
            reflect writes a note when two of your last six turns push back on the agent, or when you run{" "}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12.5px] text-white/80">
              /reflect:brain-reflect
            </code>
            . Sessions are deleted 7 days after their last event.
          </p>
        </Card>
      </div>
    );
  }

  const sessions = new Set(notes.map((n) => n.sessionId)).size;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white/95">Notes</h1>
          <p className="mt-1 text-sm text-white/55">
            {notes.length} {notes.length === 1 ? "note" : "notes"} from {sessions}{" "}
            {sessions === 1 ? "session" : "sessions"} · newest first
          </p>
        </div>
        <Badge variant={snap.source === "live" ? "confidence-high" : "neutral"}>
          {snap.source === "live" ? "live" : "fixture"} · {snap.source_label}
        </Badge>
      </header>

      <div className="flex flex-col gap-5 md:flex-row">
        <aside className="w-full md:sticky md:top-[72px] md:w-2/5 md:self-start">
          <Card variant="default" padding="none" className="overflow-hidden">
            <ScrollArea maxHeight="calc(100vh - 140px)">
              <ReflectionListClient notes={notes} />
            </ScrollArea>
          </Card>
        </aside>

        <section className="min-w-0 flex-1">
          <ReflectionDetailPanel notes={notes} />
        </section>
      </div>
    </div>
  );
}
