import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-4 py-24 sm:px-6">
      <Card variant="elevated" padding="lg" className="w-full max-w-md text-center">
        <CardHeader className="items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            404 · route
          </span>
          <CardTitle className="text-lg">No reflection at this path.</CardTitle>
          <CardDescription>
            The session is session-local — there is nothing persisted here to find.
          </CardDescription>
        </CardHeader>
        <CardContent className="items-center pt-6">
          <Link href="/" className="inline-flex">
            <Button variant="primary">Back to dashboard</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
