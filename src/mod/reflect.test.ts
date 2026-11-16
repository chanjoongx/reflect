// src/mod/reflect.test.ts: the mod against a fake engine. No model is called:
// $.model.complete answers from a script, $.clock.after runs on the next tick.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { idle, register, resetForTest } from "./reflect.js";
import { JUDGE_SYSTEM } from "../detect/judge-prompt.js";
import { REFLECTION_SYSTEM } from "../reflect/reflection-prompt.js";

type AnyFn = (...args: any[]) => any;
interface Request {
  model: string;
  system: { text: string; cache?: true }[];
  prompt: string;
  maxTokens: number;
  effort?: string;
  timeoutMs: number;
}

const REFLECTION = {
  pattern: "The agent keeps editing files the developer did not name.",
  signal: "Two corrections about touching other files.",
  adjustment: "Edit only the file the developer names, and ask before touching another.",
  confidence: "high",
  scope: "this_session",
  false_trigger_likelihood: "low",
  counter_hypothesis: "The developer may want the wider change after all.",
  verify: "Ask which files are in scope before the next edit.",
  expires_after_turns: 4,
};

const usage = { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** Developer messages carrying this marker are judged pushback by the scripted judge. */
const PUSH = "ZZPUSH";

function harness(options: Record<string, unknown> = {}) {
  const hooks = new Map<string, AnyFn>();
  const calls: Request[] = [];
  const logs: string[] = [];
  const debug: string[] = [];
  const state = {
    tokens: 150_000 as number | undefined,
    reply: (req: Request): unknown => {
      if (req.system[0]?.text === JUDGE_SYSTEM) {
        const push = req.prompt.includes(PUSH);
        const verdict = { label: push ? "correction" : "instruction", confidence: "high", evidence: push ? PUSH : "", rationale: "scripted" };
        return { isAnswered: true, text: JSON.stringify(verdict), usage };
      }
      if (req.system[0]?.text === REFLECTION_SYSTEM) return { isAnswered: true, text: JSON.stringify(REFLECTION), usage };
      throw new Error("unexpected request");
    },
  };
  const $ = {
    model: {
      complete: async (req: Request) => {
        calls.push(req);
        return state.reply(req);
      },
    },
    clock: {
      after: (_ms: number, fn: () => void) => {
        setImmediate(fn);
        return { cancel() {} };
      },
    },
    ui: { log: (text: string, o?: { to?: string }) => (o?.to === "debug" ? debug : logs).push(text) },
    session: { usage: async () => ({ context: { tokens: state.tokens, window: 1_000_000 } }) },
  };
  const on = (event: string, hook: AnyFn) => {
    hooks.set(event, hook);
    return { catch: () => undefined };
  };
  register(on as never, options as never);

  const sent: unknown[] = [];
  const h = {
    calls,
    logs,
    debug,
    state,
    sent,
    start: () => hooks.get("session.start")!($, { cwd: "/w", surface: null, isInteractive: false }, async (e: unknown) => e),
    end: () => hooks.get("session.end")!($, {}, async (e: unknown) => e),
    /** The developer sends a message; resolves to what the engine passed on. */
    say: async (text: string, extra: Record<string, unknown> = {}) => {
      let passed: any;
      await hooks.get("prompt.submit")!($, { text, wait: false, origin: { kind: "composer" }, ...extra }, async (e: unknown) => {
        passed = e;
        sent.push(e);
        return { text };
      });
      return passed as { text: string; context?: string[] };
    },
    /** The agent runs a tool; resolves to the result the agent reads. */
    tool: (tool: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
      hooks.get("tool.call")!($, { tool, ...args, ...extra }, async () => ({ ref: 1, result: "ok", text: "ok", ...(extra["result"] as object) })) as Promise<{
        context?: string[];
      }>,
    answer: (answer: string, extra: Record<string, unknown> = {}) =>
      hooks.get("turn.complete")!($, { answer, durationMs: 1, isAborted: false, turnId: "t", reason: "answer", ...extra }, async (e: unknown) => e),
    /** One agent turn: an edit and a closing line. */
    turn: async (file = "src/a.ts") => {
      const r = await h.tool("Edit", { file_path: file, old_string: "a", new_string: "b" });
      await h.answer(`Edited ${file}.`);
      return r;
    },
  };
  return h;
}

const judgeCalls = (h: ReturnType<typeof harness>) => h.calls.filter((c) => c.system[0]?.text === JUDGE_SYSTEM);
const reflectionCalls = (h: ReturnType<typeof harness>) => h.calls.filter((c) => c.system[0]?.text === REFLECTION_SYSTEM);

beforeEach(() => resetForTest());

test("the session's first message is not judged; the next one is, with the agent turn before it", async () => {
  const h = harness();
  await h.start();
  await h.say("add a parser for the config file");
  await idle();
  assert.equal(h.calls.length, 0);
  await h.turn("src/config.ts");
  await h.say("now add tests for it");
  await idle();
  const [j] = judgeCalls(h);
  assert.ok(j);
  assert.equal(j.model, "claude-haiku-5-5");
  assert.equal(j.system[0]?.cache, true);
  assert.equal(j.effort, undefined);
  assert.match(j.prompt, /now add tests for it/);
  assert.match(j.prompt, /src\/config\.ts/);
  assert.match(j.prompt, /JSON Schema/);
});

test("two pushbacks within six messages bring one reflection, delivered once with the next tool result", async () => {
  const h = harness();
  await h.start();
  await h.say("refactor the parser");
  await h.turn();
  await h.say(`${PUSH} no, only touch the parser file`);
  await h.turn("src/b.ts");
  await h.say(`${PUSH} you edited another file again`);
  await idle();
  const [r] = reflectionCalls(h);
  assert.ok(r, "a reflection was written");
  assert.equal(r.model, "claude-opus-5-5");
  assert.equal(r.effort, "high");
  assert.equal(r.maxTokens, 8000);
  assert.equal(h.logs.length, 0, "nothing shown before delivery");

  const first = await h.tool("Read", { file_path: "src/a.ts" });
  assert.equal(first.context?.length, 1);
  assert.match(first.context?.[0] ?? "", /Edit only the file the developer names/);
  assert.equal(h.logs.length, 1);
  assert.ok(h.logs[0]?.startsWith("reflect sent the agent this note:\n\n"));
  assert.ok(h.logs[0]?.endsWith(first.context?.[0] ?? "?"), "the developer sees the note word for word");

  const second = await h.tool("Read", { file_path: "src/a.ts" });
  assert.equal(second.context, undefined, "delivered once");
  assert.equal(reflectionCalls(h).length, 1);
});

test("a note with no tool call to ride on goes with the developer's next message", async () => {
  const h = harness();
  await h.start();
  await h.say("refactor the parser");
  await h.turn();
  await h.say(`${PUSH} no, only the parser`);
  await h.turn();
  await h.say(`${PUSH} wrong file again`);
  await idle();
  await h.answer("Sorry, reverting.");
  const passed = await h.say("ok continue");
  assert.equal(passed.context?.length, 1);
  assert.match(passed.context?.[0] ?? "", /^reflect: /);
  assert.equal(h.logs.length, 1);
});

test("the note goes again after a compaction while in force, and not after it expires", async () => {
  const h = harness();
  await h.start();
  await h.say("refactor the parser");
  await h.turn();
  await h.say(`${PUSH} no, only the parser`);
  await h.turn();
  await h.say(`${PUSH} wrong file again`);
  await idle();
  h.state.tokens = 180_000;
  assert.equal((await h.tool("Read")).context?.length, 1);
  h.state.tokens = 185_000;
  assert.equal((await h.tool("Read")).context, undefined, "growing context: nothing sent");
  h.state.tokens = 40_000;
  const again = await h.tool("Read");
  assert.equal(again.context?.length, 1, "compacted: sent again");
  assert.ok(h.logs[1]?.startsWith("reflect sent the agent its current note again, because the conversation was compacted:"));

  // expires_after_turns is 4: four more developer messages and it is no longer in force.
  for (let i = 0; i < 4; i++) {
    await h.answer("done");
    await h.say(`step ${i}`);
  }
  await idle();
  h.state.tokens = 200_000;
  await h.tool("Read");
  h.state.tokens = 10_000;
  assert.equal((await h.tool("Read")).context, undefined, "expired: not sent again");
});

test("only the developer's own messages count: meta prompts, other origins and bookkeeping are passed on unjudged", async () => {
  const h = harness();
  await h.start();
  await h.say("refactor the parser");
  await h.turn();
  await h.say(`${PUSH} background task finished`, { isMeta: true });
  await h.say(`${PUSH} scheduled prompt`, { origin: { kind: "scheduled-trigger" } });
  await h.say(`${PUSH} message from another session`, { origin: { kind: "peer" } });
  await h.say("/compact");
  await idle();
  assert.equal(h.calls.length, 0);
  await h.say("looks good, continue");
  await idle();
  assert.equal(judgeCalls(h).length, 1, "the real message is judged against the agent turn still open");
  assert.match(judgeCalls(h)[0]?.prompt ?? "", /src\/a\.ts/);
});

test("a subagent's tool calls and answers are not recorded", async () => {
  const h = harness();
  await h.start();
  await h.say("look into the failing test");
  await h.tool("Grep", { pattern: "secret-subagent-pattern" }, { agentId: "a1" });
  await h.answer("subagent summary text", { agentId: "a1" });
  await h.turn("src/main.ts");
  await h.say("thanks, next");
  await idle();
  const p = judgeCalls(h)[0]?.prompt ?? "";
  assert.doesNotMatch(p, /secret-subagent-pattern|subagent summary text/);
  assert.match(p, /src\/main\.ts/);
});

test("what reaches a model is redacted", async () => {
  const h = harness();
  await h.start();
  await h.say("start");
  await h.tool("Read", { file_path: "C:\\Users\\someone\\proj\\a.ts" });
  await h.answer("Mail me at dev@example.com when done.");
  await h.say("my key is sk-ant-" + "abcdefghijklmnopqrstuvwxyz0123 and my mail is me@example.org");
  await idle();
  const p = judgeCalls(h)[0]?.prompt ?? "";
  assert.doesNotMatch(p, /sk-ant-abc|me@example\.org|dev@example\.com|someone/);
  assert.match(p, /<anthropic-key>/);
});

test("the spend cap stops model calls for the session and says so once", async () => {
  const h = harness({ max_usd_per_session: 0.00005 });
  await h.start();
  await h.say("start");
  await h.turn();
  await h.say("next");
  await h.turn();
  await h.say("and next");
  await h.turn();
  await h.say("and again");
  await idle();
  assert.equal(judgeCalls(h).length, 1, "the first judgement spends past the cap");
  assert.equal(h.logs.filter((l) => l.startsWith("reflect stopped for this session: it reached its spend cap")).length, 1);
});

test("a refused call (401) stops reflect for the session", async () => {
  const h = harness();
  h.state.reply = () => ({ isAnswered: false, reason: "api-error", status: 401, error: "authentication_error", usage });
  await h.start();
  await h.say("start");
  await h.turn();
  await h.say("next");
  await h.turn();
  await h.say("and next");
  await idle();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.logs, ["reflect stopped for this session: the judge call was refused (HTTP 401)."]);
});

test("an unanswered call goes to the debug log and the session goes on", async () => {
  const h = harness();
  let n = 0;
  const scripted = h.state.reply;
  h.state.reply = (req) => (n++ === 0 ? { isAnswered: false, reason: "aborted", usage } : scripted(req));
  await h.start();
  await h.say("start");
  await h.turn();
  await h.say("next");
  await h.turn();
  await h.say("and next");
  await idle();
  assert.equal(h.calls.length, 2);
  assert.equal(h.logs.length, 0);
  assert.match(h.debug[0] ?? "", /judge call returned no answer \(aborted\)/);
});

test("a model id the engine refuses is tried once more under its alias", async () => {
  const h = harness();
  const scripted = h.state.reply;
  h.state.reply = (req) => {
    if (req.model === "claude-haiku-5-5") throw new Error("model not allowed");
    return scripted(req);
  };
  await h.start();
  await h.say("start");
  await h.turn();
  await h.say("next");
  await h.turn();
  await h.say("and next");
  await idle();
  assert.deepEqual(
    h.calls.map((c) => c.model),
    ["claude-haiku-5-5", "haiku", "haiku"],
    "the alias is kept for the rest of the session",
  );
});

test("a judge answer wrapped in prose or a fence still parses", async () => {
  const h = harness();
  const scripted = h.state.reply;
  h.state.reply = (req) => {
    const r = scripted(req) as { text: string };
    return { ...r, text: `Here is my verdict:\n\`\`\`json\n${r.text}\n\`\`\`` };
  };
  await h.start();
  await h.say("refactor the parser");
  await h.turn();
  await h.say(`${PUSH} no`);
  await h.turn();
  await h.say(`${PUSH} wrong again`);
  await idle();
  assert.equal(reflectionCalls(h).length, 1);
});

test("without session.start the first message binds the engine", async () => {
  const h = harness();
  await h.say("start");
  await h.turn();
  await h.say("next");
  await idle();
  assert.equal(judgeCalls(h).length, 1);
});

test("session.end forgets the session", async () => {
  const h = harness();
  await h.start();
  await h.say("refactor the parser");
  await h.turn();
  await h.say(`${PUSH} no`);
  await idle();
  await h.end();
  await h.turn();
  await h.say(`${PUSH} wrong again`);
  await idle();
  assert.equal(reflectionCalls(h).length, 0, "the earlier pushback is gone with its session");
});

test("a reflection model set in the plugin's options is used", async () => {
  const h = harness({ reflection_model: "claude-sonnet-5-5" });
  await h.start();
  await h.say("refactor the parser");
  await h.turn();
  await h.say(`${PUSH} no`);
  await h.turn();
  await h.say(`${PUSH} wrong again`);
  await idle();
  assert.equal(reflectionCalls(h)[0]?.model, "claude-sonnet-5-5");
});
