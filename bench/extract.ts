// bench/extract.ts — corpus → pairs.jsonl
//
// Reads Claude Code transcripts and emits the relational unit the detector
// operates on. Everything written here is redacted; raw utterances never
// leave .reflect/ or bench/data/, and bench/data/ is gitignored.

import { existsSync, mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { findTranscripts, parseSessionFile, shortHash } from "../src/transcript/parse.js";
import { redactString, safeTruncate, safeTruncateEnd } from "../src/redact.js";
import { detectScript, lexicalEn, lexicalKo, toolTier } from "../src/detect/lexical.js";
import { structuralGate } from "../src/detect/structural.js";
import type { Pair } from "../src/detect/types.js";

interface Args {
  projects: string;
  out: string;
  sidechain: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string, d: string) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
  };
  return {
    projects: get("--projects", join(homedir(), ".claude", "projects")),
    out: get("--out", "bench/data"),
    sidechain: argv.includes("--sidechain"),
    force: argv.includes("--force"),
  };
}

/** Redact a pair in place-ish, returning a serialisable record. */
function serialise(p: Pair) {
  return {
    pairId: p.pairId,
    sessionId: p.sessionId,
    project: redactString(p.project),
    promptIndex: p.promptIndex,
    prompt: redactString(p.prompt),
    promptAt: p.promptAt,
    script: detectScript(p.prompt),
    prior: p.prior
      ? {
          // The judge is shown the END of the assistant's turn and told so.
          // Storing the HEAD here meant that for the 17% of turns longer than
          // 4,000 chars it was shown the middle, labelled as the ending — and
          // the live hook path, which never truncates, disagreed with the
          // bench about what the judge reads.
          text: safeTruncateEnd(redactString(p.prior.text), 4000),
          textChars: p.prior.text.length,
          endedAt: p.prior.endedAt,
          toolCalls: p.prior.toolCalls.map((c) => ({
            name: c.name,
            target: safeTruncate(redactString(c.target), 200),
            mutating: c.mutating,
            errored: c.errored,
          })),
        }
      : null,
    recentTargets: p.recentTargets.slice(0, 24).map((t) => safeTruncate(redactString(t), 200)),
    sidechain: p.sidechain,
  };
}

const USAGE = `bench/extract.ts: ~/.claude/projects/**/*.jsonl -> <out>/pairs.jsonl

  --projects <dir>   transcript root (default ~/.claude/projects)
  --out <dir>        output directory (default bench/data)
  --sidechain        extract subagent transcripts instead of the main thread
  --force            overwrite an existing <out>/pairs.jsonl

A corpus cannot be re-extracted once Claude Code has purged its transcripts
(~30 days), so an existing pairs.jsonl is never overwritten without --force.
Write a new corpus to a new --out directory instead.
`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  const args = parseArgs(argv);
  const target = join(args.out, "pairs.jsonl");
  if (existsSync(target) && !args.force) {
    process.stderr.write(
      `[extract] refusing to overwrite ${target}: it may be the only copy of a corpus whose ` +
        `transcripts have been purged. Use --out <new dir>, or --force if you mean it.
`,
    );
    process.exit(2);
  }
  mkdirSync(args.out, { recursive: true });

  const files = findTranscripts(args.projects);
  process.stderr.write(`[extract] ${files.length} transcript files under ${args.projects}\n`);

  // Pre-pass: find session ids written into more than one transcript file. A
  // session that outlives a project-directory rename is recorded in both
  // folders under the same id, so `<session>:0` names two different prompts.
  // Only those sessions get a file-derived suffix, which keeps every other
  // pair id — and therefore an existing label cache — untouched.
  const sessionFiles = new Map<string, Set<string>>();
  for (const { file } of files) {
    const probe = parseSessionFile(file, "", { sidechain: args.sidechain });
    if (!probe) continue;
    if (!sessionFiles.has(probe.sessionId)) sessionFiles.set(probe.sessionId, new Set());
    (sessionFiles.get(probe.sessionId) as Set<string>).add(file);
  }
  const ambiguous = new Set(
    [...sessionFiles.entries()].filter(([, f]) => f.size > 1).map(([s]) => s),
  );
  if (ambiguous.size > 0) {
    process.stderr.write(
      `[extract] ${ambiguous.size} session id(s) span multiple transcript files — suffixing their pair ids\n`,
    );
  }

  const pairsPath = join(args.out, args.sidechain ? "pairs-sidechain.jsonl" : "pairs.jsonl");
  const stream = createWriteStream(pairsPath, { encoding: "utf8" });

  let sessions = 0;
  let pairCount = 0;
  let toolCalls = 0;
  let dropped = 0;
  let gatePass = 0;
  let lexEn = 0;
  let lexKo = 0;
  let tier1 = 0;
  let tier2 = 0;
  const scripts: Record<string, number> = {};
  const perSession: Array<Record<string, unknown>> = [];

  for (const { file, project } of files) {
    const first = parseSessionFile(file, project, { sidechain: args.sidechain });
    const sp =
      first && ambiguous.has(first.sessionId)
        ? parseSessionFile(file, project, { sidechain: args.sidechain, idSuffix: shortHash(file) })
        : first;
    if (!sp) continue;
    sessions++;
    toolCalls += sp.toolCallCount;
    dropped += sp.droppedHarness;

    let sEn = 0;
    let sKo = 0;
    let sGate = 0;
    let sKoChars = 0;
    let sChars = 0;

    for (const p of sp.pairs) {
      pairCount++;
      const rec = serialise(p);
      const g = structuralGate(p);
      const en = lexicalEn(p.prompt);
      const ko = lexicalKo(p.prompt);
      if (g.pass) {
        gatePass++;
        sGate++;
      }
      if (en) {
        lexEn++;
        sEn++;
      }
      if (ko) {
        lexKo++;
        sKo++;
      }
      scripts[rec.script] = (scripts[rec.script] ?? 0) + 1;
      const hangul = (p.prompt.match(/[가-힣]/g) ?? []).length;
      sKoChars += hangul;
      sChars += p.prompt.length;

      stream.write(
        JSON.stringify({
          ...rec,
          gate: { pass: g.pass, score: Number(g.score.toFixed(4)), reason: g.reason },
          features: g.features,
          lexicalEn: en,
          lexicalKo: ko,
        }) + "\n",
      );
    }

    // Tool-side tiers, reproducing the shipped hook over the same transcripts.
    for (const p of sp.pairs) {
      for (const c of p.prior?.toolCalls ?? []) {
        const t = toolTier(c.name, c.target);
        if (t === 1) tier1++;
        else if (t === 2) tier2++;
      }
    }

    perSession.push({
      sessionId: sp.sessionId,
      project: redactString(sp.project),
      prompts: sp.promptCount,
      toolCalls: sp.toolCallCount,
      gatePass: sGate,
      lexEn: sEn,
      lexKo: sKo,
      hangulShare: sChars ? Number((sKoChars / sChars).toFixed(3)) : 0,
    });
  }

  stream.end();

  const summary = {
    generatedAt: new Date().toISOString(),
    projectsRoot: redactString(args.projects),
    thread: args.sidechain ? "sidechain" : "main",
    files: files.length,
    sessions,
    pairs: pairCount,
    droppedHarnessEvents: dropped,
    toolCalls,
    gatePassed: gatePass,
    gatePassRate: pairCount ? Number((gatePass / pairCount).toFixed(4)) : 0,
    lexicalEnHits: lexEn,
    lexicalKoHits: lexKo,
    tier1Signals: tier1,
    tier2Signals: tier2,
    scripts,
  };

  writeFileSync(join(args.out, "extract-summary.json"), JSON.stringify(summary, null, 2), "utf8");
  writeFileSync(
    join(args.out, "sessions.json"),
    JSON.stringify(perSession, null, 2),
    "utf8",
  );

  process.stderr.write(JSON.stringify(summary, null, 2) + "\n");
  process.stderr.write(`[extract] wrote ${pairsPath}\n`);
}

main();
