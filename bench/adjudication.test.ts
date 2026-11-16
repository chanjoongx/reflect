// bench/adjudication.test.ts: reading the person's answers, and the page that
// collects them staying inert and self-contained whatever the items say.

import { test } from "node:test";
import assert from "node:assert/strict";

import { adjudicationHtml, mergeMarks, parseAnswersJson, parseSheetMarks, readMark, scriptJson } from "./adjudication.js";

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

test("readMark normalises written answers", () => {
  assert.equal(readMark(" y "), "y");
  assert.equal(readMark("**Yes**"), "y");
  assert.equal(readMark("`n`"), "n");
  assert.equal(readMark("아니요"), "n");
  assert.equal(readMark("?"), "?");
  assert.equal(readMark(""), null);
  assert.equal(readMark("maybe"), null);
});

test("parseSheetMarks reads y, n and ? under each heading, and skips blanks", () => {
  const md = [
    "### 1. `a:1`",
    "",
    "**Pushback?** y",
    "",
    "### 2. `b:2`",
    "**Pushback?** ",
    "### 3. `c:3`",
    "**Pushback?** ?",
    "### 4. `d:4`",
    "**Pushback?** N",
  ].join("\r\n");
  assert.deepEqual([...parseSheetMarks(md)], [
    ["a:1", "y"],
    ["c:3", "?"],
    ["d:4", "n"],
  ]);
});

test("parseAnswersJson takes the page's file and rejects other shapes", () => {
  const { marks, skipped } = parseAnswersJson(JSON.stringify({ version: 1, answers: { "a:1": "y", "b:2": "?", "c:3": "N", "d:4": "later", "e:5": "" } }));
  assert.deepEqual([...marks], [
    ["a:1", "y"],
    ["b:2", "?"],
    ["c:3", "n"],
  ]);
  assert.deepEqual(skipped, ["d:4"]);
  assert.throws(() => parseAnswersJson("{"), /not JSON/);
  assert.throws(() => parseAnswersJson(JSON.stringify({ version: 2, answers: {} })), /version/);
  assert.throws(() => parseAnswersJson(JSON.stringify({ version: 1, answers: [] })), /answers/);
  assert.equal(parseAnswersJson(String.fromCharCode(0xfeff) + JSON.stringify({ version: 1, answers: { x: "y" } })).marks.get("x"), "y");
});

test("mergeMarks puts the file on top of the sheet and lists where they differ", () => {
  const sheet = new Map([
    ["a", "y"],
    ["b", "n"],
    ["c", "?"],
  ] as const);
  const file = new Map([
    ["b", "y"],
    ["c", "?"],
    ["d", "n"],
  ] as const);
  const m = mergeMarks(new Map(sheet), new Map(file));
  assert.deepEqual(Object.fromEntries(m.marks), { a: "y", b: "y", c: "?", d: "n" });
  assert.deepEqual(Object.fromEntries(m.origin), { a: "sheet", b: "file", c: "file", d: "file" });
  assert.deepEqual(m.disagree, ["b"]);
});

test("scriptJson cannot close its tag and survives a round trip", () => {
  const nasty = { t: `</script><script>alert(1)</script><!-- ${LS}${PS} & "q"` };
  const s = scriptJson(nasty);
  assert.ok(!s.includes("<"));
  assert.ok(!s.includes(LS) && !s.includes(PS));
  assert.deepEqual(JSON.parse(s), nasty);
});

test("the page embeds the items inertly and makes no outside requests", () => {
  const items = [
    { id: "s:1", prior: "Agent actions this turn: none.\nsee https://example.com/x", message: "</script><img src=x onerror=alert(1)>", mark: "y" as const },
    { id: "s:2", prior: "", message: `line${LS}two`, mark: undefined },
  ];
  const html = adjudicationHtml(items, { judges: ["h55", "v0-text"], scoreCommand: "npx tsx bench/variants.ts --adjudicated --score h55", answersPath: "bench/data/adjudication-answers.json" });

  const block = /<script type="application\/json" id="items">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(block);
  const parsed = JSON.parse(block[1] as string) as { id: string; message: string; mark: string }[];
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.message, items[0]?.message);
  assert.equal(parsed[1]?.mark, "");

  const outside = html.replace(block[0], "");
  assert.ok(!/https?:\/\//i.test(outside), "a URL outside the items");
  assert.ok(!/<script[^>]*\bsrc\s*=/i.test(html) && !/<link\b/i.test(html) && !/<img\b/i.test(outside));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bfetch\(|XMLHttpRequest|\beval\(/.test(outside));
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2);
  assert.ok(!new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]|&[mn]dash;`).test(outside), "a dash outside the items");

  const script = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script[1] as string));
});
