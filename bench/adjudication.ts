// bench/adjudication.ts: the person's answers on the adjudication sheet, and
// the page they can give them on.
//
// `variants.ts --sheet` writes the same blind items twice. adjudication.md is
// answered by typing y, n or ? after each "**Pushback?**". adjudication.html is
// opened from disk in a browser and answered with the keyboard; its "Save
// answers" button downloads adjudication-answers.json:
//
//   { "version": 1, "answers": { "<pairId>": "y" | "n" | "?" } }
//
// `--adjudicated` reads both. Where they give different answers for the same
// pair, the file wins, since the page is the newer tool. The page makes no
// requests of any kind: its styles and script are inline, the items sit in a
// JSON block, and every piece of item text is set with textContent.

/** One answer: pushback, not pushback, or cannot tell. */
export type Mark = "y" | "n" | "?";

export interface SheetItem {
  id: string;
  /** What the agent did and said just before, as the judge saw it. */
  prior: string;
  /** The developer's message. */
  message: string;
  mark?: Mark | undefined;
}

/** One written answer, normalised. Blank or anything unrecognised is null. */
export function readMark(raw: string): Mark | null {
  const a = raw.trim().toLowerCase().replace(/[_`*]/g, "").trim();
  if (/^(y|yes|예|네|o)$/.test(a)) return "y";
  if (/^(n|no|아니오|아니요|x)$/.test(a)) return "n";
  if (a === "?") return "?";
  return null;
}

/** The answers written on the markdown sheet, by pair id. */
export function parseSheetMarks(md: string): Map<string, Mark> {
  const out = new Map<string, Mark>();
  let id: string | null = null;
  for (const line of md.split(/\r?\n/)) {
    const head = /^### \d+\. `([^`]+)`/.exec(line);
    if (head) id = head[1] as string;
    const ans = /^\*\*Pushback\?\*\*\s*(.*)$/.exec(line);
    if (ans && id) {
      const m = readMark(ans[1] ?? "");
      if (m) out.set(id, m);
      id = null;
    }
  }
  return out;
}

/**
 * The answers in a file the page saved. Throws on anything that is not that
 * file's shape; values that are not y, n or ? are listed in `skipped`.
 */
export function parseAnswersJson(text: string, where = "answers file"): { marks: Map<string, Mark>; skipped: string[] } {
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error(`${where} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${where}: expected an object`);
  const d = doc as { version?: unknown; answers?: unknown };
  if (d.version !== 1) throw new Error(`${where}: version ${JSON.stringify(d.version)}, expected 1`);
  if (!d.answers || typeof d.answers !== "object" || Array.isArray(d.answers)) throw new Error(`${where}: "answers" must be an object`);
  const marks = new Map<string, Mark>();
  const skipped: string[] = [];
  for (const [id, v] of Object.entries(d.answers as Record<string, unknown>)) {
    const m = typeof v === "string" ? readMark(v) : null;
    if (m) marks.set(id, m);
    else if (v !== "" && v !== null) skipped.push(id);
  }
  return { marks, skipped };
}

export interface MergedMarks {
  marks: Map<string, Mark>;
  /** Where each answer in `marks` came from. */
  origin: Map<string, "sheet" | "file">;
  /** Pairs both sources answer, differently. The file's answer is the one kept. */
  disagree: string[];
}

/** The sheet's answers with the file's on top. */
export function mergeMarks(sheet: Map<string, Mark>, file: Map<string, Mark>): MergedMarks {
  const marks = new Map<string, Mark>();
  const origin = new Map<string, "sheet" | "file">();
  const disagree: string[] = [];
  for (const [id, m] of sheet) {
    marks.set(id, m);
    origin.set(id, "sheet");
  }
  for (const [id, m] of file) {
    const prev = sheet.get(id);
    if (prev !== undefined && prev !== m) disagree.push(id);
    marks.set(id, m);
    origin.set(id, "file");
  }
  return { marks, origin, disagree };
}

/**
 * JSON for a `<script type="application/json">` block: every `<` is escaped,
 * so no text inside can close the tag, and U+2028 and U+2029 are escaped too.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PageText {
  /** The runs the sheet was drawn from. */
  judges: string[];
  /** The command that scores against the answers. */
  scoreCommand: string;
  /** Where `--adjudicated` looks for the saved file by default. */
  answersPath: string;
}

/** The answering page: one self-contained file, opened from disk. */
export function adjudicationHtml(items: SheetItem[], t: PageText): string {
  const data = items.map((it) => ({ id: it.id, prior: it.prior, message: it.message, mark: it.mark ?? "" }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>Pushback adjudication</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
  <h1>Was this message pushback?</h1>
  <p class="muted">${items.length} messages from your own Claude Code sessions. On each one, the reference labels and at least one judge (${esc(t.judges.join(", "))}) disagree about whether it pushes back on the agent. No label is shown here.</p>
  <details class="help" open>
    <summary>How to answer</summary>
    <p>Read what the agent had just done and said (shown as the judge saw it), then your message, and answer:</p>
    <ul>
      <li><kbd>y</kbd> if you were pushing back on what the agent had just done or proposed: correcting it, rejecting it, or saying it does not work or is not what you wanted</li>
      <li><kbd>n</kbd> if you were giving new work, asking something, or approving</li>
      <li><kbd>?</kbd> (or <kbd>/</kbd>) if you cannot tell</li>
    </ul>
    <p>Answering moves to the next message. <kbd>&larr;</kbd> <kbd>&rarr;</kbd> or <kbd>k</kbd> <kbd>j</kbd> move without answering, and <kbd>u</kbd> clears the answer on the message shown. Messages are in session order.</p>
    <p>This browser keeps your answers as you go. <strong>Save answers</strong> downloads <code>adjudication-answers.json</code>. Move it to <code>${esc(t.answersPath)}</code>, or pass its path with <code>--answers &lt;path&gt;</code>, then run <code>${esc(t.scoreCommand)}</code>. It makes no API calls. Where the markdown sheet and the saved file answer the same message differently, the file wins.</p>
  </details>
  <div class="bar">
    <strong id="progress" role="status"></strong>
    <span class="grow"></span>
    <button type="button" id="next-open">Next unanswered</button>
    <button type="button" id="save" class="primary">Save answers</button>
  </div>
  <p id="note" class="muted" role="status"></p>
  <nav class="strip" id="strip" aria-label="Messages"></nav>
  <article id="card">
    <h2><span id="num"></span> <code id="pid"></code></h2>
    <h3>What the agent did and said just before</h3>
    <pre id="prior"></pre>
    <h3>Your message</h3>
    <pre id="message" class="message"></pre>
  </article>
  <div class="answer">
    <button type="button" id="prev" aria-label="Previous message">&larr;</button>
    <button type="button" class="mark y" data-mark="y"><kbd>y</kbd> Pushback</button>
    <button type="button" class="mark n" data-mark="n"><kbd>n</kbd> Not pushback</button>
    <button type="button" class="mark q" data-mark="?"><kbd>?</kbd> Cannot tell</button>
    <button type="button" id="clear"><kbd>u</kbd> Clear</button>
    <button type="button" id="next" aria-label="Next message">&rarr;</button>
    <span id="current" class="muted"></span>
  </div>
  <details class="help" id="as-text">
    <summary>Answers as text</summary>
    <p class="muted">The same JSON that Save answers downloads, in case the download is blocked.</p>
    <pre id="json"></pre>
  </details>
</main>
<script type="application/json" id="items">${scriptJson(data)}</script>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
}

const PAGE_STYLE = String.raw`
:root {
  color-scheme: light dark;
  --bg: #f6f5f1; --panel: #ffffff; --fg: #1f1e1c; --muted: #65625b; --line: #dcd9d0; --code: #f0eee8;
  --accent: #2f5bd3; --on-accent: #ffffff; --y: #b4441b; --n: #2d6a4f; --q: #8a6a00;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151514; --panel: #1e1e1c; --fg: #e9e7e1; --muted: #a29f97; --line: #393833; --code: #262522;
    --accent: #8fb0ff; --on-accent: #10131a; --y: #f08a5d; --n: #74c69d; --q: #e3c15a;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, "Malgun Gothic", sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 20px 16px 0; }
h1 { font-size: 1.35rem; margin: 0 0 6px; }
.muted { color: var(--muted); }
details.help { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; margin: 12px 0; }
details.help summary { cursor: pointer; font-weight: 600; }
details.help ul { padding-left: 1.2em; }
kbd { font: 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 2px 5px; background: var(--code); color: var(--fg); }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.9em; background: var(--code); padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0 4px; }
.grow { flex: 1 1 auto; }
button { font: inherit; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--muted); }
button:disabled { opacity: 0.45; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
#note { min-height: 1.5em; margin: 4px 0; }
.strip { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 14px; }
.strip button { min-width: 34px; padding: 2px 0; font-size: 12px; font-variant-numeric: tabular-nums; }
.strip button.a-y { border-color: var(--y); color: var(--y); font-weight: 600; }
.strip button.a-n { border-color: var(--n); color: var(--n); font-weight: 600; }
.strip button.a-q { border-color: var(--q); color: var(--q); font-weight: 600; }
.strip button.cur { outline: 2px solid var(--accent); outline-offset: 1px; }
article { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; scroll-margin-top: 8px; }
article h2 { font-size: 1rem; margin: 0 0 4px; }
article h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 14px 0 6px; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font: 13px/1.5 ui-monospace, SFMono-Regular, Consolas, "Malgun Gothic", monospace; background: var(--code); border-radius: 6px; padding: 10px 12px; }
pre.message { font-size: 14px; }
.answer { position: sticky; bottom: 0; z-index: 1; background: var(--bg); border-top: 1px solid var(--line); margin-top: 12px; padding: 10px 0 14px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.answer .mark.y[aria-pressed="true"] { background: var(--y); border-color: var(--y); color: var(--panel); }
.answer .mark.n[aria-pressed="true"] { background: var(--n); border-color: var(--n); color: var(--panel); }
.answer .mark.q[aria-pressed="true"] { background: var(--q); border-color: var(--q); color: var(--panel); }
#as-text pre { max-height: 40vh; overflow: auto; }
`;

// Plain ES5-ish script: no template literals, so it can sit in this file as is.
const PAGE_SCRIPT = String.raw`
(function () {
  "use strict";
  var items = JSON.parse(document.getElementById("items").textContent);
  var ids = items.map(function (it) { return it.id; });
  var VALID = { "y": true, "n": true, "?": true };
  var LABEL = { "y": "pushback", "n": "not pushback", "?": "cannot tell" };

  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return (h >>> 0).toString(16);
  }
  var KEY = "reflect-adjudication-" + ids.length + "-" + fnv(ids.join("|"));
  function el(id) { return document.getElementById(id); }
  function note(text) { el("note").textContent = text; }

  // answers: what the page shows. local: what was changed in this browser ("" = cleared).
  var answers = {}, local = {}, embedded = {};
  items.forEach(function (it) { if (VALID[it.mark]) { answers[it.id] = it.mark; embedded[it.id] = it.mark; } });
  var pos = -1, storageOk = true, dirty = false, differ = 0;

  try {
    var raw = window.localStorage.getItem(KEY);
    var saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === "object") {
      var a = saved.answers && typeof saved.answers === "object" ? saved.answers : {};
      ids.forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(a, id)) return;
        var v = a[id];
        if (v !== "" && !VALID[v]) return;
        local[id] = v;
        if (embedded[id] && embedded[id] !== v) differ++;
        if (v === "") delete answers[id]; else answers[id] = v;
      });
      if (typeof saved.pos === "number" && saved.pos >= 0 && saved.pos < items.length) pos = Math.floor(saved.pos);
    }
  } catch (e) {
    storageOk = false;
  }

  function persist() {
    if (!storageOk) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ version: 1, answers: local, pos: pos }));
    } catch (e) {
      storageOk = false;
      note("This browser is not keeping answers (storage is blocked). Save answers before you close the page.");
    }
  }

  function firstOpen(from) {
    for (var k = 0; k < items.length; k++) {
      var i = (from + k) % items.length;
      if (!answers[ids[i]]) return i;
    }
    return -1;
  }
  if (pos < 0) { pos = firstOpen(0); if (pos < 0) pos = 0; }

  function counts() {
    var c = { "y": 0, "n": 0, "?": 0 };
    ids.forEach(function (id) { var m = answers[id]; if (m) c[m]++; });
    return c;
  }
  function answersJson() {
    var out = {};
    ids.forEach(function (id) { if (answers[id]) out[id] = answers[id]; });
    return JSON.stringify({ version: 1, answers: out }, null, 2) + "\n";
  }

  var strip = el("strip"), cells = [];
  items.forEach(function (it, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = String(i + 1);
    b.addEventListener("click", function () { go(i); });
    strip.appendChild(b);
    cells.push(b);
  });
  var markButtons = Array.prototype.slice.call(document.querySelectorAll("button[data-mark]"));

  function render() {
    var it = items[pos], m = answers[it.id] || "";
    el("num").textContent = (pos + 1) + " of " + items.length;
    el("pid").textContent = it.id;
    el("prior").textContent = it.prior;
    el("message").textContent = it.message;
    el("current").textContent = m ? "Your answer: " + m + " (" + LABEL[m] + ")" : "Not answered yet";
    markButtons.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-mark") === m ? "true" : "false"); });
    el("prev").disabled = pos === 0;
    el("next").disabled = pos === items.length - 1;
    var c = counts(), done = c["y"] + c["n"] + c["?"];
    el("progress").textContent = done + " of " + items.length + " answered (" + c["y"] + " y, " + c["n"] + " n, " + c["?"] + " ?)";
    el("next-open").disabled = done === items.length;
    cells.forEach(function (b, i) {
      var v = answers[ids[i]] || "";
      b.className = (v === "y" ? "a-y" : v === "n" ? "a-n" : v === "?" ? "a-q" : "") + (i === pos ? " cur" : "");
      b.setAttribute("aria-label", "Message " + (i + 1) + (v ? ", answered " + v : ", not answered"));
      if (i === pos) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
    el("json").textContent = answersJson();
  }

  function go(i) {
    if (i < 0 || i >= items.length || i === pos) return;
    pos = i;
    persist();
    render();
    var card = el("card");
    if (card.getBoundingClientRect().top < 0) card.scrollIntoView();
  }
  function set(m) {
    var id = ids[pos];
    if (m) answers[id] = m; else delete answers[id];
    local[id] = m;
    dirty = true;
  }
  function mark(m) {
    set(m);
    if (pos < items.length - 1) { go(pos + 1); return; }
    persist();
    render();
    var open = items.length - (function (c) { return c["y"] + c["n"] + c["?"]; })(counts());
    note(open ? "That was the last message. " + open + " are still unanswered; Next unanswered finds them." : "Every message has an answer. Save answers to download them.");
  }
  function clear() {
    set("");
    persist();
    render();
  }

  markButtons.forEach(function (b) { b.addEventListener("click", function () { mark(b.getAttribute("data-mark")); }); });
  el("clear").addEventListener("click", clear);
  el("prev").addEventListener("click", function () { go(pos - 1); });
  el("next").addEventListener("click", function () { go(pos + 1); });
  el("next-open").addEventListener("click", function () {
    var i = firstOpen(pos + 1);
    if (i < 0) note("Every message has an answer.");
    else if (i === pos) note("This is the only message without an answer.");
    else go(i);
  });
  el("save").addEventListener("click", function () {
    var text = answersJson();
    try {
      var url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      var link = document.createElement("a");
      link.href = url;
      link.download = "adjudication-answers.json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      dirty = false;
      var c = counts();
      note("Saved " + (c["y"] + c["n"] + c["?"]) + " answers as adjudication-answers.json in your downloads folder.");
    } catch (e) {
      el("as-text").open = true;
      note("The download did not start. Copy the text under Answers as text into a file named adjudication-answers.json.");
    }
  });

  // With a Korean (or other) input method on, e.key is the composed letter; fall back to the physical key.
  var BY_CODE = { KeyY: "y", KeyN: "n", KeyU: "u", KeyJ: "j", KeyK: "k", Slash: "/" };
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var k = e.key || "";
    if ((k.length === 1 && k.charCodeAt(0) > 127) || k === "Process") k = BY_CODE[e.code] || k;
    if (k.length === 1) k = k.toLowerCase();
    var isMark = k === "y" || k === "n" || k === "?" || k === "/" || k === "u";
    if (isMark && e.repeat) { e.preventDefault(); return; }
    if (k === "y" || k === "n") mark(k);
    else if (k === "?" || k === "/") mark("?");
    else if (k === "u") clear();
    else if (k === "ArrowRight" || k === "j") go(pos + 1);
    else if (k === "ArrowLeft" || k === "k") go(pos - 1);
    else return;
    e.preventDefault();
  });

  window.addEventListener("beforeunload", function (e) {
    if (storageOk || !dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  render();
  if (!storageOk) note("This browser is not keeping answers (storage is blocked). Save answers before you close the page.");
  else if (differ) note(differ + (differ === 1 ? " answer" : " answers") + " given in this browser differ from the sheet's. The page shows this browser's.");
})();
`;
