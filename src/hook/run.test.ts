// src/hook/run.test.ts: the hook pipeline end to end, with the two model calls faked.
//
// What these fixtures pin down is behaviour a developer would notice: reflect
// stays silent on a session opener, fires on the second pushback inside the
// window and not the first, delivers its guidance exactly once, survives a
// compaction, stops at its spend cap, and never writes outside .reflect/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { reflectForFire, runHook, withProjectEnv, type HookDeps, type HookInput } from "./run.js";
import { appendEvent, pruneSessions, readEvents, sessionDir } from "./state.js";
import { capCostUSD, costUSD } from "../pricing.js";
import type { JudgeOptions, JudgeResult } from "../detect/judge.js";
import type { Label, Pair } from "../detect/types.js";
import type { Reflection2 } from "../reflect/schema.js";
import { pairForPrompt } from "../transcript/parse.js";

// ─── fixtures ─────────────────────────────────────────────────────────

let seq = 0;
const at = () => new Date(Date.UTC(2026, 10, 16, 0, 0, seq++)).toISOString();

function assistantLine(text: string, edits: string[] = []) {
  const content: unknown[] = [{ type: "text", text }];
  for (const f of edits) content.push({ type: "tool_use", id: `t${seq++}`, name: "Edit", input: { file_path: f } });
  return JSON.stringify({ type: "assistant", sessionId: "S", timestamp: at(), message: { role: "assistant", content } });
}
function userLine(text: string) {
  return JSON.stringify({ type: "user", sessionId: "S", timestamp: at(), message: { role: "user", content: text } });
}

interface World {
  dir: string;
  transcript: string;
  judged: Pair[];
  reflections: number;
  deps: HookDeps;
  /** Label the fake judge returns, keyed by prompt text. */
  labels: Map<string, Label>;
}

const REFLECTION: Reflection2 = {
  pattern: "The agent widened every edit beyond the file the developer named.",
  signal: "Twice the developer said only src/a.ts should change.",
  adjustment: "Edit only the file the developer names; ask before touching any other.",
  confidence: "high",
  scope: "this_session",
  false_trigger_likelihood: "low",
  counter_hypothesis: "The developer may have changed their mind about scope between turns.",
  verify: "Re-read the developer's last message for the file list before the next edit.",
  expires_after_turns: 3,
};

function world(env: NodeJS.ProcessEnv = {}): World {
  const dir = mkdtempSync(join(tmpdir(), "reflect-hook-"));
  const transcript = join(dir, "S.jsonl");
  writeFileSync(transcript, "");
  const w: World = {
    dir,
    transcript,
    judged: [],
    reflections: 0,
    labels: new Map(),
    deps: {} as HookDeps,
  };
  w.deps = {
    env,
    readTranscript: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    judge: async (pair: Pair, _o: JudgeOptions): Promise<JudgeResult> => {
      w.judged.push(pair);
      const label = w.labels.get(pair.prompt) ?? "instruction";
      return {
        verdict: { label, confidence: "high", evidence: "only src/a.ts", rationale: "redirects scope" },
        usage: {
          inputTokens: 4000,
          outputTokens: 60,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          latencyMs: 400,
          model: "claude-haiku-5-5",
        },
      };
    },
    reflect: async () => {
      w.reflections++;
      return { reflection: REFLECTION, model: "claude-opus-5-5", costUSD: 0.03, latencyMs: 5000, cacheReadTokens: 0 };
    },
  };
  return w;
}

const input = (w: World, promptId: string, prompt: string): HookInput => ({
  session_id: "S",
  prompt_id: promptId,
  prompt,
  transcript_path: w.transcript,
  cwd: w.dir,
});

/** One developer turn: both UserPromptSubmit hooks, then the turn lands in the transcript. */
async function turn(w: World, id: string, prompt: string, label: Label, agentReply: string, edits: string[]) {
  w.labels.set(prompt, label);
  const sync = await runHook("prompt", input(w, id, prompt), w.dir, w.deps);
  await runHook("judge", input(w, id, prompt), w.dir, w.deps);
  appendFileSync(w.transcript, userLine(prompt) + "\n" + assistantLine(agentReply, edits) + "\n");
  return sync;
}

function ctx(out: string | null): string {
  assert.ok(out, "expected hook output");
  const j = JSON.parse(out) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  return j.hookSpecificOutput.additionalContext;
}

// ─── tests ────────────────────────────────────────────────────────────

test("a session opener is never judged: there is nothing to push back on", async () => {
  const w = world();
  try {
    await turn(w, "p1", "Add a --verbose flag to the CLI", "instruction", "Added the flag.", ["src/cli.ts"]);
    assert.equal(w.judged.length, 0);
    const skip = readEvents(w.dir, "S").find((e) => e.t === "skip");
    assert.ok(skip && skip.t === "skip" && skip.reason === "session_opener");
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("the judge sees what the agent just did, not just the words", async () => {
  const w = world();
  try {
    await turn(w, "p1", "Add a --verbose flag to the CLI", "instruction", "Added the flag and refactored logging.", [
      "src/cli.ts",
      "src/log.ts",
    ]);
    await turn(w, "p2", "Only touch src/cli.ts, revert the logging change", "correction", "Reverted.", ["src/log.ts"]);
    const p = w.judged[0] as Pair;
    assert.equal(p.prompt, "Only touch src/cli.ts, revert the logging change");
    assert.ok(p.prior, "prior turn present");
    assert.deepEqual(p.prior.toolCalls.map((c) => c.target), ["src/cli.ts", "src/log.ts"]);
    assert.ok(p.prior.toolCalls.every((c) => c.mutating));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("one pushback does not fire; the second inside the window does, once", async () => {
  const w = world();
  try {
    await turn(w, "p1", "Fix the date parsing bug in src/a.ts", "instruction", "Fixed it, and tidied src/b.ts.", ["src/a.ts", "src/b.ts"]);
    await turn(w, "p2", "Please leave src/b.ts alone, only src/a.ts", "correction", "Reverted b, also renamed c.", ["src/b.ts", "src/c.ts"]);
    assert.equal(w.reflections, 0, "a single correction must not trigger a reflection");
    await turn(w, "p3", "Again: only src/a.ts. Undo the rename.", "rejection", "Undone.", ["src/c.ts"]);
    assert.equal(w.reflections, 1);
    const events = readEvents(w.dir, "S");
    const fire = events.find((e) => e.t === "fire");
    assert.ok(fire && fire.t === "fire");
    assert.deepEqual(fire.evidence, ["p2", "p3"]);
    assert.ok(existsSync(join(w.dir, ".reflect", "session-guidance.md")));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("guidance is delivered exactly once, mid-turn, as additionalContext", async () => {
  const w = world();
  try {
    await turn(w, "p1", "Fix the date parsing bug in src/a.ts", "instruction", "Fixed, and tidied src/b.ts.", ["src/a.ts", "src/b.ts"]);
    await turn(w, "p2", "Leave src/b.ts alone", "correction", "Reverted, renamed c.", ["src/c.ts"]);
    await turn(w, "p3", "Only src/a.ts, undo the rename", "correction", "Undone.", ["src/c.ts"]);

    const first = await runHook("tool", { session_id: "S", tool_name: "Edit", cwd: w.dir }, w.dir, w.deps);
    const text = ctx(first);
    assert.match(text, /pushed back on 2 of their last 6 turns \(turns 2, 3\)/);
    assert.match(text, /Edit only the file the developer names/);
    assert.match(text, /It may be wrong if:/);
    assert.equal(JSON.parse(first as string).hookSpecificOutput.hookEventName, "PostToolUse");

    assert.equal(await runHook("tool", { session_id: "S", cwd: w.dir }, w.dir, w.deps), null);
    assert.equal(await runHook("prompt", input(w, "p4", "ok continue"), w.dir, w.deps), null);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("guidance in force survives a compaction, and lapses after its expiry", async () => {
  const w = world();
  try {
    await turn(w, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed, and tidied b.", ["src/a.ts", "src/b.ts"]);
    await turn(w, "p2", "Leave src/b.ts alone", "correction", "Reverted.", ["src/b.ts"]);
    await turn(w, "p3", "Only src/a.ts!", "correction", "Ok.", ["src/a.ts"]);
    ctx(await runHook("tool", { session_id: "S", cwd: w.dir }, w.dir, w.deps));

    const compact = { session_id: "S", source: "compact", cwd: w.dir };
    const again = ctx(await runHook("session-start", compact, w.dir, w.deps));
    assert.match(again, /Adjustment for the next 3 turns/);

    for (const id of ["p4", "p5", "p6"]) await turn(w, id, `next step ${id} please`, "instruction", "Done.", ["src/a.ts"]);
    assert.equal(await runHook("session-start", compact, w.dir, w.deps), null, "expired after 3 turns");
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("verdicts that land out of order still complete the pattern", async () => {
  const w = world();
  try {
    await turn(w, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed, and tidied b.", ["src/a.ts", "src/b.ts"]);
    // p2's judge is slow: p3 is recorded and judged first.
    await runHook("prompt", input(w, "p2", "Leave src/b.ts alone"), w.dir, w.deps);
    appendFileSync(w.transcript, userLine("Leave src/b.ts alone") + "\n" + assistantLine("Ok.", ["src/b.ts"]) + "\n");
    await runHook("prompt", input(w, "p3", "Only src/a.ts!"), w.dir, w.deps);
    w.labels.set("Only src/a.ts!", "correction");
    w.labels.set("Leave src/b.ts alone", "correction");
    await runHook("judge", input(w, "p3", "Only src/a.ts!"), w.dir, w.deps);
    assert.equal(w.reflections, 0);
    await runHook("judge", input(w, "p2", "Leave src/b.ts alone"), w.dir, w.deps);
    assert.equal(w.reflections, 1);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("the spend cap stops judging, and says so once", async () => {
  const w = world({ REFLECT_MAX_USD_PER_SESSION: "0.0001" });
  try {
    await turn(w, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed.", ["src/a.ts"]);
    await turn(w, "p2", "now add tests for it", "instruction", "Added.", ["test/a.ts"]);
    await turn(w, "p3", "and run them", "instruction", "Ran.", []);
    await turn(w, "p4", "and lint", "instruction", "Linted.", []);
    assert.equal(w.judged.length, 1, "the first judged turn spends past the cap");
    const budget = readEvents(w.dir, "S").filter((e) => e.t === "skip" && e.reason === "budget");
    assert.equal(budget.length, 1);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("an authentication failure is recorded once and stops further calls", async () => {
  const w = world();
  try {
    let calls = 0;
    w.deps.judge = async () => {
      calls++;
      throw new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
    };
    await turn(w, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed.", ["src/a.ts"]);
    await turn(w, "p2", "no, the other bug", "correction", "Ok.", ["src/a.ts"]);
    await turn(w, "p3", "still wrong", "correction", "Ok.", ["src/a.ts"]);
    assert.equal(calls, 1);
    const errs = readEvents(w.dir, "S").filter((e) => e.t === "error");
    assert.equal(errs.length, 1);
    assert.ok(errs[0] && errs[0].t === "error" && errs[0].where === "auth");
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("REFLECT_DISABLED makes every hook a no-op that writes nothing", async () => {
  const w = world({ REFLECT_DISABLED: "1" });
  try {
    await turn(w, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed.", ["src/a.ts"]);
    assert.equal(existsSync(join(w.dir, ".reflect")), false);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("state stays inside .reflect/, which ignores itself in git", async () => {
  const w = world();
  try {
    await turn(w, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed.", ["src/a.ts"]);
    assert.ok(existsSync(sessionDir(w.dir, "S")));
    assert.match(readFileSync(join(w.dir, ".reflect", ".gitignore"), "utf8"), /^\*$/m);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("a hostile session id cannot escape the state directory", async () => {
  const w = world();
  try {
    await runHook("prompt", { ...input(w, "p1", "hello there"), session_id: "../../etc" }, w.dir, w.deps);
    const dir = sessionDir(w.dir, "../../etc");
    assert.ok(dir.startsWith(join(w.dir, ".reflect", "sessions")));
    assert.ok(existsSync(join(dir, "events.jsonl")));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("the project .env contributes only reflect's own keys and never overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "reflect-env-"));
  try {
    writeFileSync(
      join(dir, ".env"),
      'ANTHROPIC_API_KEY="sk-from-file"\nREFLECT_POLICY=k3w8\nDATABASE_URL=postgres://secret\nREFLECT_MODEL=from-file\n',
    );
    const env = withProjectEnv(dir, { REFLECT_MODEL: "from-env" });
    assert.equal(env["ANTHROPIC_API_KEY"], "sk-from-file");
    assert.equal(env["REFLECT_POLICY"], "k3w8");
    assert.equal(env["REFLECT_MODEL"], "from-env");
    assert.equal(env["DATABASE_URL"], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the key from the project .env or the plugin setting is the one the model calls use", async () => {
  for (const env of [{ ANTHROPIC_API_KEY: "sk-from-dotenv" }, { CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY: "sk-from-dotenv" }]) {
    const w = world(env);
    const seen: Array<string | undefined> = [];
    const judge = w.deps.judge;
    w.deps.judge = async (pair, o) => {
      seen.push(o.apiKey);
      return judge(pair, o);
    };
    try {
      await turn(w, "p1", "Fix the parser", "instruction", "Fixed.", ["src/p.ts"]);
      await turn(w, "p2", "no, only p.ts", "correction", "Reverted q.", ["src/q.ts"]);
      assert.deepEqual(seen, ["sk-from-dotenv"]);
    } finally {
      rmSync(w.dir, { recursive: true, force: true });
    }
  }
});

test("pairForPrompt handles a transcript that already holds the prompt", () => {
  const raw = [
    userLine("Fix the parser in src/p.ts"),
    assistantLine("Done, also reformatted src/q.ts.", ["src/p.ts", "src/q.ts"]),
    userLine("don't reformat q"),
  ].join("\n");
  const viaRecorded = pairForPrompt(raw, "don't reformat q", { sessionId: "S" });
  const viaPending = pairForPrompt(raw.split("\n").slice(0, 2).join("\n"), "don't reformat q", { sessionId: "S" });
  assert.deepEqual(viaRecorded.prior?.toolCalls.map((c) => c.target), ["src/p.ts", "src/q.ts"]);
  assert.deepEqual(viaPending.prior?.toolCalls.map((c) => c.target), ["src/p.ts", "src/q.ts"]);
  assert.equal(viaRecorded.promptIndex, viaPending.promptIndex);
});

// ─── regressions from the 2026-11-16 review ───────────────────────────

async function firedWorld(env: NodeJS.ProcessEnv = {}): Promise<World> {
  const w = world(env);
  await turn(w, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed, and tidied b.", ["src/a.ts", "src/b.ts"]);
  await turn(w, "p2", "Leave src/b.ts alone", "correction", "Reverted.", ["src/b.ts"]);
  await turn(w, "p3", "Only src/a.ts!", "correction", "Ok.", ["src/a.ts"]);
  return w;
}

test("a late verdict cannot fire a second time on turns that already fired", async () => {
  const w = world();
  try {
    await turn(w, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed, and tidied b.", ["src/a.ts", "src/b.ts"]);
    await turn(w, "p2", "Leave src/b.ts alone", "correction", "Reverted.", ["src/b.ts"]);
    // p3's judge is slow; p4 is recorded and judged first, and fires on [p2, p4].
    await runHook("prompt", input(w, "p3", "Not like that"), w.dir, w.deps);
    appendFileSync(w.transcript, userLine("Not like that") + "\n" + assistantLine("Ok.", ["src/a.ts"]) + "\n");
    await runHook("prompt", input(w, "p4", "No, only src/a.ts"), w.dir, w.deps);
    appendFileSync(w.transcript, userLine("No, only src/a.ts") + "\n" + assistantLine("Ok.", ["src/a.ts"]) + "\n");
    w.labels.set("Not like that", "correction");
    w.labels.set("No, only src/a.ts", "correction");
    await runHook("judge", input(w, "p4", "No, only src/a.ts"), w.dir, w.deps);
    assert.equal(w.reflections, 1);
    // p3 lands: the replay would now fire at p3 on [p2, p3]. p2 already fired.
    await runHook("judge", input(w, "p3", "Not like that"), w.dir, w.deps);
    assert.equal(w.reflections, 1);
    assert.equal(readEvents(w.dir, "S").filter((e) => e.t === "fire").length, 1);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("a delivery another hook already claimed is not repeated", async () => {
  const w = await firedWorld();
  try {
    const g = readEvents(w.dir, "S").find((e) => e.t === "guidance");
    assert.ok(g && g.t === "guidance");
    // A parallel PostToolUse hook got there first and has not logged it yet.
    writeFileSync(join(sessionDir(w.dir, "S"), `delivered-${g.id}`), "");
    assert.equal(await runHook("tool", { session_id: "S", cwd: w.dir }, w.dir, w.deps), null);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("a subagent's tool call never receives the main agent's note", async () => {
  const w = await firedWorld();
  try {
    assert.equal(await runHook("tool", { session_id: "S", cwd: w.dir, agent_id: "a1" }, w.dir, w.deps), null);
    ctx(await runHook("tool", { session_id: "S", cwd: w.dir }, w.dir, w.deps));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("the reflection is skipped when the judge calls have used up the cap", async () => {
  // Each fake judge call costs $0.00043 at Haiku 5.5 prices.
  const w = await firedWorld({ REFLECT_MAX_USD_PER_SESSION: "0.0005" });
  try {
    assert.equal(w.judged.length, 2);
    assert.equal(w.reflections, 0);
    assert.ok(readEvents(w.dir, "S").some((e) => e.t === "skip" && e.reason === "budget"));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("pruning looks at when the log was written, not when its folder was made", () => {
  const dir = mkdtempSync(join(tmpdir(), "reflect-prune-"));
  try {
    appendEvent(dir, "old-but-active", { t: "prompt", at: "x", promptId: "p", chars: 1 });
    const sd = sessionDir(dir, "old-but-active");
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    utimesSync(sd, tenDaysAgo, tenDaysAgo);
    assert.equal(pruneSessions(dir), 0);
    utimesSync(join(sd, "events.jsonl"), tenDaysAgo, tenDaysAgo);
    assert.equal(pruneSessions(dir), 1);
    assert.equal(existsSync(sd), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unknown model counts against the cap at the highest listed price", () => {
  const u = { inputTokens: 1_000_000, outputTokens: 0 };
  assert.ok(capCostUSD("claude-unlisted-9", u) >= capCostUSD("claude-opus-5-5", u));
  assert.equal(capCostUSD("claude-haiku-5-5", u), costUSD("claude-haiku-5-5", u));
});

test(".env values: quotes, trailing spaces and comments", () => {
  const dir = mkdtempSync(join(tmpdir(), "reflect-env2-"));
  try {
    writeFileSync(join(dir, ".env"), 'ANTHROPIC_API_KEY="sk-quoted" \nREFLECT_POLICY=k3w8   # stricter\nREFLECT_MODEL=\'m#1\'\n');
    const env = withProjectEnv(dir, {});
    assert.equal(env["ANTHROPIC_API_KEY"], "sk-quoted");
    assert.equal(env["REFLECT_POLICY"], "k3w8");
    assert.equal(env["REFLECT_MODEL"], "m#1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("IDE context blocks are not read as the developer's words", () => {
  const raw = [
    userLine("Fix the parser in src/p.ts"),
    assistantLine("Done.", ["src/p.ts"]),
    userLine("<ide_opened_file>The user opened src/q.ts in the IDE.</ide_opened_file> leave q alone"),
  ].join("\n");
  const pair = pairForPrompt(raw, "<ide_opened_file>The user opened src/q.ts in the IDE.</ide_opened_file> leave q alone", { sessionId: "S" });
  assert.equal(pair.prompt.trim(), "leave q alone");
});

test("a fire hands the reflection to a worker, which writes the note once", async () => {
  const w = world();
  const started: string[] = [];
  w.deps.detach = (_dir, _sid, id) => {
    started.push(id);
    return true;
  };
  try {
    await turn(w, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed, and tidied b.", ["src/a.ts", "src/b.ts"]);
    await turn(w, "p2", "Leave src/b.ts alone", "correction", "Reverted.", ["src/b.ts"]);
    await turn(w, "p3", "Only src/a.ts!", "correction", "Ok.", ["src/a.ts"]);
    assert.deepEqual(started, ["p3"]);
    assert.equal(w.reflections, 0);
    await reflectForFire(w.dir, "S", "p3", w.deps);
    await reflectForFire(w.dir, "S", "p3", w.deps);
    assert.equal(w.reflections, 1);
    const g = readEvents(w.dir, "S").filter((e) => e.t === "guidance");
    assert.equal(g.length, 1);
    ctx(await runHook("tool", { session_id: "S", cwd: w.dir }, w.dir, w.deps));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("when the worker cannot start, the judge hook reflects itself", async () => {
  const w = await (async () => {
    const x = world();
    x.deps.detach = () => false;
    await turn(x, "p1", "Fix the bug in src/a.ts please", "instruction", "Fixed, and tidied b.", ["src/a.ts", "src/b.ts"]);
    await turn(x, "p2", "Leave src/b.ts alone", "correction", "Reverted.", ["src/b.ts"]);
    await turn(x, "p3", "Only src/a.ts!", "correction", "Ok.", ["src/a.ts"]);
    return x;
  })();
  try {
    assert.equal(w.reflections, 1);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("a worker for a prompt that never fired does nothing", async () => {
  const w = await firedWorld();
  try {
    await reflectForFire(w.dir, "S", "p2", w.deps);
    assert.equal(w.reflections, 1);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});
