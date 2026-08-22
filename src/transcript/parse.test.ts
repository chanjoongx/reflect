// src/transcript/parse.test.ts — turn-boundary fixtures.
//
// This file's header claims turn detection "is the single most error-prone part
// of this parser, so it is done explicitly and tested." Until now it was not
// tested at all, and three separate defects lived here: errors pinned to the
// wrong tool call, `gapSeconds` measured from harness traffic instead of from
// the assistant, and a placeholder that turned the source file into something
// `grep` reported as binary. Each has a fixture below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseSessionFile } from "./parse.js";

// ─── fixture helpers ──────────────────────────────────────────────────

let seq = 0;
const uuid = () => `u${++seq}`;

function assistant(opts: {
  text?: string;
  tools?: Array<{ id?: string; name: string; input: Record<string, unknown> }>;
  at: string;
}) {
  const content: unknown[] = [];
  if (opts.text) content.push({ type: "text", text: opts.text });
  for (const t of opts.tools ?? []) {
    content.push({ type: "tool_use", id: t.id ?? uuid(), name: t.name, input: t.input });
  }
  return {
    type: "assistant",
    isSidechain: false,
    sessionId: "S",
    uuid: uuid(),
    timestamp: opts.at,
    message: { role: "assistant", content },
  };
}

function toolResult(opts: { forId: string; isError?: boolean; at: string }) {
  return {
    type: "user",
    isSidechain: false,
    sessionId: "S",
    uuid: uuid(),
    timestamp: opts.at,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: opts.forId,
          is_error: opts.isError === true,
          content: opts.isError ? "boom" : "ok",
        },
      ],
    },
  };
}

function userPrompt(text: string, at: string) {
  return {
    type: "user",
    isSidechain: false,
    sessionId: "S",
    uuid: uuid(),
    timestamp: at,
    message: { role: "user", content: text },
  };
}

function parse(events: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "reflect-parse-"));
  const proj = join(dir, "proj");
  mkdirSync(proj, { recursive: true });
  const file = join(proj, "S.jsonl");
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  try {
    return parseSessionFile(file, "proj", {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// NOTE: prompts in these fixtures are >= MIN_PROMPT_CHARS. A two-character
// prompt is dropped as harness noise by design, which is correct behaviour and
// silently made the first draft of these fixtures test the wrong thing.
const T = (m: number, s = 0) =>
  `2026-08-22T10:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`;

// ─── turn boundaries ──────────────────────────────────────────────────

test("a prompt is paired with everything the agent did since the human last spoke", () => {
  const sp = parse([
    userPrompt("build the thing", T(0)),
    assistant({ text: "working", tools: [{ name: "Edit", input: { file_path: "/a/src/pay.ts" } }], at: T(1) }),
    toolResult({ forId: "auto", at: T(1, 30) }),
    assistant({ text: "done", tools: [{ name: "Bash", input: { command: "npm test" } }], at: T(2) }),
    userPrompt("아니 그건 아니고", T(3)),
  ]);
  assert.ok(sp);
  assert.equal(sp.pairs.length, 2);
  const second = sp.pairs[1]!;
  assert.equal(second.prompt, "아니 그건 아니고");
  assert.equal(second.prior?.toolCalls.length, 2, "both turns' calls belong to the same prior");
  assert.equal(second.prior?.text, "working\ndone");
});

test("the first prompt of a session has no prior turn", () => {
  const sp = parse([userPrompt("start", T(0)), assistant({ text: "ok", at: T(1) })]);
  assert.equal(sp?.pairs[0]?.prior, null);
  assert.equal(sp?.pairs[0]?.promptIndex, 0);
});

test("tool-result carriers are not counted as user prompts", () => {
  const sp = parse([
    userPrompt("start the work", T(0)),
    assistant({ tools: [{ id: "t1", name: "Read", input: { file_path: "/a/x.ts" } }], at: T(1) }),
    toolResult({ forId: "t1", at: T(1, 10) }),
    userPrompt("next", T(2)),
  ]);
  assert.equal(sp?.pairs.length, 2);
});

test("harness injection is dropped and does not open a new turn", () => {
  const sp = parse([
    userPrompt("start the work", T(0)),
    assistant({ text: "a", tools: [{ name: "Edit", input: { file_path: "/a/x.ts" } }], at: T(1) }),
    userPrompt("<task-notification>\n<status>done</status>\n</task-notification>", T(2)),
    assistant({ text: "b", at: T(3) }),
    userPrompt("이거 아니야", T(4)),
  ]);
  assert.equal(sp?.pairs.length, 2, "the notification must not become a pair");
  assert.equal(sp?.droppedHarness, 1);
  assert.equal(sp?.pairs[1]?.prior?.text, "a\nb", "both assistant turns stay in the same prior");
});

test("sidechain events are excluded from the main thread", () => {
  const side = { ...assistant({ text: "sub", at: T(1) }), isSidechain: true };
  const sp = parse([
    userPrompt("start the work", T(0)),
    side,
    assistant({ text: "main", at: T(2) }),
    userPrompt("next", T(3)),
  ]);
  assert.equal(sp?.pairs[1]?.prior?.text, "main");
});

// ─── error attribution ────────────────────────────────────────────────

test("an error is attributed to the call it answers, not the last one issued", () => {
  const sp = parse([
    userPrompt("start the work", T(0)),
    assistant({
      tools: [
        { id: "t1", name: "Bash", input: { command: "npm run build" } },
        { id: "t2", name: "Read", input: { file_path: "/a/README.md" } },
        { id: "t3", name: "Grep", input: { pattern: "foo" } },
      ],
      at: T(1),
    }),
    toolResult({ forId: "t1", isError: true, at: T(1, 5) }),
    toolResult({ forId: "t2", at: T(1, 6) }),
    toolResult({ forId: "t3", at: T(1, 7) }),
    userPrompt("빌드가 깨졌어", T(2)),
  ]);
  const calls = sp!.pairs[1]!.prior!.toolCalls;
  assert.equal(calls.find((c) => c.name === "Bash")?.errored, true, "Bash actually failed");
  assert.equal(calls.find((c) => c.name === "Grep")?.errored, false, "Grep must not be blamed");
});

test("two errors in one batch are both recorded", () => {
  const sp = parse([
    userPrompt("start the work", T(0)),
    assistant({
      tools: [
        { id: "t1", name: "Bash", input: { command: "a" } },
        { id: "t2", name: "Bash", input: { command: "b" } },
        { id: "t3", name: "Read", input: { file_path: "/a/x.ts" } },
      ],
      at: T(1),
    }),
    toolResult({ forId: "t1", isError: true, at: T(1, 5) }),
    toolResult({ forId: "t2", isError: true, at: T(1, 6) }),
    userPrompt("둘 다 실패했는데", T(2)),
  ]);
  const calls = sp!.pairs[1]!.prior!.toolCalls;
  assert.equal(calls.filter((c) => c.errored).length, 2);
});

test("an out-of-order error still lands on the right call", () => {
  const sp = parse([
    userPrompt("start the work", T(0)),
    assistant({ tools: [{ id: "t1", name: "Bash", input: { command: "slow" } }], at: T(1) }),
    assistant({ tools: [{ id: "t2", name: "Read", input: { file_path: "/a/x.ts" } }], at: T(2) }),
    toolResult({ forId: "t1", isError: true, at: T(3) }),
    userPrompt("에러 났는데", T(4)),
  ]);
  const calls = sp!.pairs[1]!.prior!.toolCalls;
  assert.equal(calls.find((c) => c.name === "Bash")?.errored, true);
  assert.equal(calls.find((c) => c.name === "Read")?.errored, false);
});

// ─── gap measurement ──────────────────────────────────────────────────

test("dropped harness traffic does not reset the measured gap", () => {
  const sp = parse([
    userPrompt("start the work", T(0)),
    assistant({ text: "Done.", tools: [{ name: "Write", input: { file_path: "/a/app.ts" } }], at: T(1) }),
    // 39 minutes later, a background task finishes. This is not the agent
    // speaking, and letting it advance the clock made a two-hour-old turn look
    // ten seconds old.
    userPrompt("<task-notification>done</task-notification>", T(40)),
    userPrompt("app.ts 다시 해", T(40, 10)),
  ]);
  const p = sp!.pairs[1]!;
  assert.equal(p.prior?.endedAt, T(1), "endedAt must still point at the assistant turn");
});

// ─── mutation classification ──────────────────────────────────────────

test("mutating tools and mutating bash are both recognised", () => {
  const sp = parse([
    userPrompt("start the work", T(0)),
    assistant({
      tools: [
        { name: "Edit", input: { file_path: "/a/x.ts" } },
        { name: "Read", input: { file_path: "/a/y.ts" } },
        { name: "Bash", input: { command: "git restore src/z.ts" } },
        { name: "Bash", input: { command: "npm test" } },
      ],
      at: T(1),
    }),
    userPrompt("next", T(2)),
  ]);
  const calls = sp!.pairs[1]!.prior!.toolCalls;
  assert.deepEqual(
    calls.map((c) => c.mutating),
    [true, false, true, false],
  );
});

// ─── id uniqueness ────────────────────────────────────────────────────

test("an idSuffix makes pair ids unique across files that share a session id", () => {
  const events = [userPrompt("start the work", T(0)), assistant({ text: "ok", at: T(1) }), userPrompt("next", T(2))];
  const dir = mkdtempSync(join(tmpdir(), "reflect-parse-"));
  const proj = join(dir, "p");
  mkdirSync(proj, { recursive: true });
  const file = join(proj, "S.jsonl");
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  try {
    const plain = parseSessionFile(file, "p", {});
    const suffixed = parseSessionFile(file, "p", { idSuffix: "abc123" });
    assert.equal(plain?.pairs[0]?.pairId, "S:0");
    assert.equal(suffixed?.pairs[0]?.pairId, "S:abc123:0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
