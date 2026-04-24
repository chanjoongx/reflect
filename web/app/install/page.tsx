import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CopyBlock } from "./CopyBlock";

export const metadata: Metadata = {
  title: "Install — reflect",
  description: "4-step setup for Claude Code. Takes ~3 minutes.",
};

type Step = {
  num: string;
  title: string;
  body: React.ReactNode;
};

const steps: Step[] = [
  {
    num: "1",
    title: "npm install",
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-white/70">
          Installs the CLI + plugin into your project. reflect is session-local —
          nothing runs outside this directory.
        </p>
        <CopyBlock code="npm install @chanjoongx/reflect" />
      </div>
    ),
  },
  {
    num: "2",
    title: "API key",
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-white/70">
          Copy the example env file and paste your Anthropic key. reflect uses
          the Messages API with prompt caching — billing is per reflection, not
          per tool call.
        </p>
        <CopyBlock code="cp node_modules/@chanjoongx/reflect/.env.example .env" />
        <CopyBlock code="ANTHROPIC_API_KEY=sk-ant-..." language="env" />
        <div className="flex items-start gap-3 rounded-lg border border-[rgba(212,162,127,0.3)] bg-[rgba(212,162,127,0.08)] p-3">
          <AlertTriangle
            aria-hidden
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-brand-orange)]"
            strokeWidth={2}
          />
          <div className="flex flex-col gap-1 text-[13px] leading-relaxed text-white/75">
            <span className="font-medium text-white/90">
              Keep <code className="font-mono text-[12px]">.env</code> out of
              git.
            </span>
            <span className="text-white/60">
              The reflect scaffold ships a pre-commit hook that scans for{" "}
              <code className="font-mono text-[12px]">sk-ant-</code> prefixes
              and aborts the commit. Do not disable it.
            </span>
          </div>
        </div>
      </div>
    ),
  },
  {
    num: "3",
    title: "Wire hooks",
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-white/70">
          reflect ships two hooks — <code className="font-mono text-[12px]">PostToolUse</code>{" "}
          (Tier 1 + 2 detection) and{" "}
          <code className="font-mono text-[12px]">UserPromptSubmit</code>{" "}
          (Tier 3 utterance regex).
        </p>
        <CopyBlock code="cp node_modules/@chanjoongx/reflect/.claude/settings.example.json .claude/settings.json" />
        <p className="text-sm leading-relaxed text-white/55">
          Or merge the{" "}
          <code className="font-mono text-[12px]">hooks.PostToolUse</code> +{" "}
          <code className="font-mono text-[12px]">hooks.UserPromptSubmit</code>{" "}
          blocks into your existing{" "}
          <code className="font-mono text-[12px]">settings.json</code>.
        </p>
      </div>
    ),
  },
  {
    num: "4",
    title: "Path-scoped rule",
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-white/70">
          The rule auto-loads next-turn guidance only inside{" "}
          <code className="font-mono text-[12px]">src/**</code> and{" "}
          <code className="font-mono text-[12px]">lib/**</code> — it does not
          pollute every prompt.
        </p>
        <CopyBlock code="cp node_modules/@chanjoongx/reflect/.claude/rules/reflect-rules.md .claude/rules/reflect-rules.md" />
      </div>
    ),
  },
  {
    num: "5",
    title: "Restart Claude Code",
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-white/70">
          Hooks register on Claude Code startup. After restarting, verify the
          install:
        </p>
        <CopyBlock code="npx reflect status" />
        <p className="text-sm leading-relaxed text-white/55">
          You should see{" "}
          <code className="font-mono text-[12px]">
            hooks: 2 wired · rule: loaded · api: ok
          </code>
          .
        </p>
      </div>
    ),
  },
];

export default function InstallPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="flex flex-col gap-3 border-b border-white/5 pb-8">
        <div className="flex items-center gap-2">
          <Badge variant="scope-session">Setup</Badge>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
            ~3 min
          </span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-white/95">
          Install
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-white/60">
          4-step setup for Claude Code. Takes ~3 minutes. Nothing leaves your
          machine except the single Anthropic API call per reflection trigger.
        </p>
      </header>

      <ol className="mt-10 flex flex-col gap-6">
        {steps.map((step) => (
          <li key={step.num}>
            <Card variant="default" padding="lg">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-brand-purple)]/30 bg-[var(--color-brand-purple)]/10 font-mono text-[12px] text-[var(--color-brand-purple)]"
                  >
                    {step.num}
                  </span>
                  <CardTitle className="text-lg">
                    Step {step.num} — {step.title}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pl-10">{step.body}</CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <section className="mt-10">
        <Card variant="default" padding="lg">
          <CardHeader>
            <CardTitle className="text-lg">Run the Viewer</CardTitle>
            <CardDescription>
              The Viewer is a bundled localhost-only dashboard that reads your{" "}
              <code className="font-mono text-[12px]">.reflect/</code> directory
              from disk. Separate concern from the npm install.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CopyBlock code="cd web && npm install && npm run dev" />
            <p className="text-sm leading-relaxed text-white/55">
              Binds to <code className="font-mono text-[12px]">127.0.0.1:3000</code>{" "}
              only. It will not deploy, and never makes outbound network calls.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <Card variant="default" padding="lg">
          <CardHeader>
            <CardTitle className="text-base">Manual trigger</CardTitle>
            <CardDescription>
              Run a reflection on demand without waiting for the revert
              threshold.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-white/10 bg-[#0a0a0e] px-3 py-2 font-mono text-[13px] text-[var(--color-brand-purple)]">
              /brain-reflect
            </div>
          </CardContent>
        </Card>

        <Card variant="default" padding="lg">
          <CardHeader>
            <CardTitle className="text-base">Disable</CardTitle>
            <CardDescription>
              Turn reflect off for this shell or for the project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CopyBlock code="export REFLECT_DISABLED=1" />
            <p className="text-sm leading-relaxed text-white/55">
              Or add{" "}
              <code className="font-mono text-[12px]">REFLECT_DISABLED=1</code>{" "}
              to <code className="font-mono text-[12px]">.env</code>.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-10 border-t border-white/5 pt-8">
        <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-white/40">
          Troubleshooting
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Hook not firing, cache miss higher than expected, or API returning
          400 on sampling fields — see the{" "}
          <Link
            href="https://github.com/chanjoongx/reflect/tree/main/docs/troubleshooting.md"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[var(--color-brand-purple)] underline-offset-4 transition-colors hover:text-[#c4b1ff] hover:underline"
          >
            troubleshooting guide
            <ExternalLink aria-hidden className="h-3 w-3" strokeWidth={2} />
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
