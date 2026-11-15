import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CopyBlock } from "./CopyBlock";

export const metadata: Metadata = {
  title: "Install · reflect",
  description: "Install reflect 0.2 as a Claude Code plugin, or wire its hooks by hand.",
};

type Step = {
  num: string;
  title: string;
  body: React.ReactNode;
};

const code = (s: string) => <code className="font-mono text-[12px]">{s}</code>;

const steps: Step[] = [
  {
    num: "1",
    title: "Install the plugin",
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-white/70">In Claude Code 2.1.275 or later:</p>
        <CopyBlock code="/plugin install reflect --marketplace chanjoongx/reflect" />
        <p className="text-sm leading-relaxed text-white/55">
          On older versions, run {code("/plugin marketplace add chanjoongx/reflect")}, then{" "}
          {code("/plugin install reflect@chanjoongx")}. You need {code("node")} 20 or later on your{" "}
          {code("PATH")}; the hook is one bundled file with nothing else to install.
        </p>
      </div>
    ),
  },
  {
    num: "2",
    title: "API key",
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-white/70">
          The hooks call the Anthropic API directly. Claude Code asks for a key when you enable the plugin and
          keeps it in your system&apos;s credential store. Leave it empty if {code("ANTHROPIC_API_KEY")} is
          already set in your environment or in the project&apos;s {code(".env")}, or if you use{" "}
          {code("ant auth login")}.
        </p>
        <div className="flex items-start gap-3 rounded-lg border border-[rgba(212,162,127,0.3)] bg-[rgba(212,162,127,0.08)] p-3">
          <AlertTriangle
            aria-hidden
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-brand-orange)]"
            strokeWidth={2}
          />
          <div className="flex flex-col gap-1 text-[13px] leading-relaxed text-white/75">
            <span className="font-medium text-white/90">A Claude subscription login is not enough for the hooks.</span>
            <span className="text-white/60">
              Without a key, {code("/reflect:brain-reflect")} still works: the agent writes the reflection
              itself from its own context.
            </span>
          </div>
        </div>
      </div>
    ),
  },
  {
    num: "3",
    title: "Without the plugin system",
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-white/70">
          Print the hook settings and paste them into {code(".claude/settings.local.json")}:
        </p>
        <CopyBlock code="npx @chanjoongx/reflect init" />
        <p className="text-sm leading-relaxed text-white/55">
          It wires {code("SessionStart")}, {code("UserPromptSubmit")} and {code("PostToolUse")} to the
          bundled hook. Restart Claude Code afterwards so it loads them.
        </p>
      </div>
    ),
  },
  {
    num: "4",
    title: "Check",
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-white/70">
          From the project folder, check node, credentials, the hook bundle and {code(".reflect/")}:
        </p>
        <CopyBlock code="npx @chanjoongx/reflect doctor" />
        <p className="text-sm leading-relaxed text-white/55">
          After a few prompts, {code("npx @chanjoongx/reflect status")} lists the turns judged, pushback, notes,
          spend and errors for the latest session. This Viewer shows the same log.
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
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">reflect 0.2</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-white/95">Install</h1>
        <p className="max-w-2xl text-base leading-relaxed text-white/60">
          reflect judges each message you send after the agent&apos;s first reply with Claude Haiku 5.5. When two
          of your last six turns push back, Claude Opus 5.5 writes a short note and the agent receives it on its
          next tool call or prompt. Everything it keeps stays in {code(".reflect/")} in your project.
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
                    Step {step.num}: {step.title}
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
              This localhost dashboard reads {code(".reflect/sessions/")} from disk. Point it at the project you
              use reflect in; without sessions it shows example data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CopyBlock code="cd web && npm install && REFLECT_PROJECT_DIR=/path/to/your/project npm run preview" />
            <p className="text-sm leading-relaxed text-white/55">
              Binds to {code("127.0.0.1:3000")} only, makes no network calls, and is not deployed anywhere.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <Card variant="default" padding="lg">
          <CardHeader>
            <CardTitle className="text-base">Ask for a note now</CardTitle>
            <CardDescription>
              Reflect on your last N judged messages (default 6), whether or not the trigger fired.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-white/10 bg-[#0a0a0e] px-3 py-2 font-mono text-[13px] text-[var(--color-brand-purple)]">
              /reflect:brain-reflect
            </div>
            <p className="text-sm leading-relaxed text-white/55">
              From a terminal: {code("npx @chanjoongx/reflect manual --turns 6")}.
            </p>
          </CardContent>
        </Card>

        <Card variant="default" padding="lg">
          <CardHeader>
            <CardTitle className="text-base">Turn it off</CardTitle>
            <CardDescription>For this project, until you turn it back on.</CardDescription>
          </CardHeader>
          <CardContent>
            <CopyBlock code="npx @chanjoongx/reflect off" />
            <p className="text-sm leading-relaxed text-white/55">
              This writes {code(".reflect/disabled")}; {code("reflect on")} removes it. Setting{" "}
              {code("REFLECT_DISABLED=1")} turns every hook into a no-op.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-10 border-t border-white/5 pt-8">
        <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-white/40">Settings</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          All optional: {code("REFLECT_POLICY")} (default {code("k2w6")}, two pushbacks in six turns),{" "}
          {code("REFLECT_MAX_USD_PER_SESSION")} (default {code("0.5")}), {code("REFLECT_MODEL")},{" "}
          {code("REFLECT_JUDGE_MODEL")}, {code("REFLECT_EFFORT")}. From a project&apos;s {code(".env")} reflect
          reads only {code("ANTHROPIC_API_KEY")} and {code("REFLECT_*")}. Hook errors, a missing key and other
          problems are covered in the{" "}
          <Link
            href="https://github.com/chanjoongx/reflect/blob/main/docs/troubleshooting.md"
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
