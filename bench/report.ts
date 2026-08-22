// bench/report.ts — results.json → a self-contained static workbench page.
//
// The plan this implements called the existing viewer "a demo": it shows live
// session state, when the thing that actually needed looking at was detector
// quality. This is that surface — PR space, the relational ablation, the
// cost frontier, and the confusion matrix, all from measured data.
//
// Palette is the dataviz categorical theme, validated with the skill's
// validate_palette.js in BOTH modes (all six checks pass):
//   light  #0D9488 #B45309 #4338CA #BE185D   on #FBFCFB
//   dark   #19A090 #C97C1F #5E63D8 #CC4B84   on #16181A
// Dark is stepped separately, not flipped: the light steps sit outside dark's
// L 0.48–0.67 band and fail the validator.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const RESULTS = process.argv.includes("--results")
  ? (process.argv[process.argv.indexOf("--results") + 1] as string)
  : "bench/results/results.json";
const OUT = process.argv.includes("--out")
  ? (process.argv[process.argv.indexOf("--out") + 1] as string)
  : "bench/results/workbench.html";

const d = JSON.parse(readFileSync(RESULTS, "utf8")) as any;

// ─── formatting ───────────────────────────────────────────────────────

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ─── chart primitives ─────────────────────────────────────────────────

interface Box {
  w: number;
  h: number;
  ml: number;
  mr: number;
  mt: number;
  mb: number;
}

function axes(b: Box, xTicks: Array<[number, string]>, yTicks: Array<[number, string]>, xLabel: string, yLabel: string) {
  const iw = b.w - b.ml - b.mr;
  const ih = b.h - b.mt - b.mb;
  const parts: string[] = [];
  for (const [v, lab] of yTicks) {
    const y = b.mt + ih * (1 - v);
    parts.push(`<line class="grid" x1="${b.ml}" y1="${y}" x2="${b.ml + iw}" y2="${y}"/>`);
    parts.push(`<text class="tick" x="${b.ml - 8}" y="${y + 4}" text-anchor="end">${esc(lab)}</text>`);
  }
  for (const [v, lab] of xTicks) {
    const x = b.ml + iw * v;
    parts.push(`<line class="grid" x1="${x}" y1="${b.mt}" x2="${x}" y2="${b.mt + ih}"/>`);
    parts.push(`<text class="tick" x="${x}" y="${b.mt + ih + 18}" text-anchor="middle">${esc(lab)}</text>`);
  }
  parts.push(
    `<text class="axis-label" x="${b.ml + iw / 2}" y="${b.h - 4}" text-anchor="middle">${esc(xLabel)}</text>`,
  );
  parts.push(
    `<text class="axis-label" transform="translate(13,${b.mt + ih / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`,
  );
  return parts.join("");
}

const TICKS = [0, 0.25, 0.5, 0.75, 1].map((v) => [v, `${v * 100}%`] as [number, string]);

// ─── 1. PR space ──────────────────────────────────────────────────────

function prSpaceChart(): string {
  const b: Box = { w: 720, h: 470, ml: 62, mr: 130, mt: 18, mb: 46 };
  const iw = b.w - b.ml - b.mr;
  const ih = b.h - b.mt - b.mb;
  const X = (r: number) => b.ml + iw * r;
  const Y = (p: number) => b.mt + ih * (1 - p);

  const curve = (d.gateCurve as Array<any>)
    .slice()
    .sort((a, b2) => a.recall - b2.recall)
    .filter((p) => p.predictedPositive > 0);
  const path = curve.map((p, i) => `${i ? "L" : "M"}${X(p.recall).toFixed(1)},${Y(p.precision).toFixed(1)}`).join("");

  const prev = d.corpus.pushbackRate as number;

  const pts: Array<{ id: string; name: string; r: number; p: number; c: number; dx?: number; dy?: number }> = [];
  const find = (id: string, name?: string) =>
    (d.baselines as Array<any>).find((x) => x.id === id && (!name || x.name === name));

  const b0 = find("B0");
  const b1 = find("B1");
  const b2 = find("B2");
  const b4 = find("B4");
  const b5a = (d.baselines as Array<any>).find((x) => x.theta === 0.3);
  const b5b = (d.baselines as Array<any>).find((x) => x.theta === 0.5);
  const b6 = find("B6");

  pts.push({ id: "B0", name: "B0 shipped regex", r: b0.recall, p: b0.precision, c: 3, dx: 12, dy: 4 });
  pts.push({ id: "B1", name: "B1 + Korean regex", r: b1.recall, p: b1.precision, c: 3, dx: 10, dy: -8 });
  pts.push({ id: "B2", name: "B2 gate alone", r: b2.recall, p: b2.precision, c: 1, dx: 8, dy: 16 });
  pts.push({ id: "B6", name: "B6 blind judge", r: b6.recall, p: b6.precision, c: 2, dx: -6, dy: 20 });
  pts.push({ id: "B4", name: "B4 judge, every prompt", r: b4.recall, p: b4.precision, c: 0, dx: 8, dy: 18 });
  pts.push({ id: "B5", name: "B5 cascade θ=0.30", r: b5a.recall, p: b5a.precision, c: 0, dx: 8, dy: -10 });
  pts.push({ id: "B5", name: "B5 cascade θ=0.50", r: b5b.recall, p: b5b.precision, c: 0, dx: -4, dy: -12 });

  const marks = pts
    .map(
      (m) =>
        `<g class="pt" tabindex="0"><circle class="dot s${m.c}" cx="${X(m.r).toFixed(1)}" cy="${Y(m.p).toFixed(1)}" r="6.5"/>` +
        `<text class="ptlab" x="${(X(m.r) + (m.dx ?? 8)).toFixed(1)}" y="${(Y(m.p) + (m.dy ?? 4)).toFixed(1)}">${esc(m.name)}</text>` +
        `<title>${esc(m.name)} — precision ${pct(m.p)}, recall ${pct(m.r)}</title></g>`,
    )
    .join("");

  return `<svg viewBox="0 0 ${b.w} ${b.h}" role="img" aria-label="Precision–recall space with each baseline as a labelled point">
  ${axes(b, TICKS, TICKS, "recall", "precision")}
  <line class="prevalence" x1="${b.ml}" y1="${Y(prev)}" x2="${b.ml + iw}" y2="${Y(prev)}"/>
  <text class="tick prev-lab" x="${b.ml + iw + 6}" y="${Y(prev) + 4}">chance ${pct(prev)}</text>
  <path class="curve" d="${path}"/>
  <text class="curve-lab" x="${X(curve[Math.floor(curve.length * 0.62)].recall).toFixed(1)}" y="${(Y(curve[Math.floor(curve.length * 0.62)].precision) - 12).toFixed(1)}">Stage A swept</text>
  ${marks}
</svg>`;
}

// ─── 2. Ablation ──────────────────────────────────────────────────────

function ablationChart(): string {
  const a = d.ablation;
  const sh = d.shuffledAblation;
  // Three arms, not two. 7-way agreement is deliberately NOT plotted: the
  // stratified analysis shows its gap is present even where the sighted arm
  // receives no information, so it measures shared input format with the
  // reference annotator rather than the effect under test.
  const rows: Array<[string, number, number, number | null]> = [
    ["precision", a.sighted.precision, a.blind.precision, sh ? sh.precision : null],
    ["recall", a.sighted.recall, a.blind.recall, sh ? sh.recall : null],
    ["F1", a.sighted.f1, a.blind.f1, sh ? sh.f1 : null],
  ];
  const w = 640;
  const rowH = 74;
  const barH = 17;
  const ml = 132;
  const mr = 66;
  const iw = w - ml - mr;
  const h = rows.length * rowH + 16;

  const parts: string[] = [];
  rows.forEach(([label, own, none, wrong], i) => {
    const y = 10 + i * rowH;
    parts.push(
      `<text class="rowlab" x="${ml - 12}" y="${y + barH + 6}" text-anchor="end">${esc(label)}</text>`,
    );
    const arms: Array<[string, number | null, string]> = [
      ["its own prior turn", own, "s0"],
      ["a different pair's prior turn", wrong, "s2"],
      ["no prior turn", none, "s1"],
    ];
    arms.forEach(([name, v, cls], k) => {
      if (v === null) return;
      const by = y + k * (barH + 2);
      parts.push(
        `<g class="pt" tabindex="0"><rect class="bar ${cls}" x="${ml}" y="${by}" width="${(iw * v).toFixed(1)}" height="${barH}" rx="4"/>` +
          `<title>${esc(name)} — ${esc(label)} ${pct(v)}</title></g>`,
        `<text class="barval" x="${(ml + iw * v + 8).toFixed(1)}" y="${by + barH - 3}">${pct(v)}</text>`,
      );
    });
  });

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Judge performance with and without the prior agent turn">${parts.join("")}</svg>`;
}

// ─── 3. Cost frontier ─────────────────────────────────────────────────

function frontierChart(metric: "recall" | "precision", title: string): string {
  const pts = (d.baselines as Array<any>)
    .filter((x) => typeof x.theta === "number")
    .map((x) => ({ theta: x.theta, cost: x.judgeCallRate, v: x[metric] as number }))
    .sort((a, b2) => a.cost - b2.cost);

  const b: Box = { w: 380, h: 250, ml: 54, mr: 22, mt: 16, mb: 44 };
  const iw = b.w - b.ml - b.mr;
  const ih = b.h - b.mt - b.mb;
  const X = (c: number) => b.ml + iw * (c / 0.8);
  const lo = metric === "recall" ? 0 : 0.85;
  const hi = 1;
  const Y = (v: number) => b.mt + ih * (1 - (v - lo) / (hi - lo));

  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p.cost).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const yTicks: Array<[number, string]> =
    metric === "recall"
      ? [0, 0.25, 0.5, 0.75, 1].map((v) => [v, `${v * 100}%`] as [number, string])
      : [0.85, 0.9, 0.95, 1].map((v) => [(v - lo) / (hi - lo), `${(v * 100).toFixed(0)}%`] as [number, string]);
  const xTicks: Array<[number, string]> = [0, 0.25, 0.5, 0.75, 1].map(
    (f) => [f, `${Math.round(f * 80)}`] as [number, string],
  );

  const marks = pts
    .map(
      (p) =>
        `<g class="pt" tabindex="0"><circle class="dot s${metric === "recall" ? 0 : 2}" cx="${X(p.cost).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="5"/>` +
        `<title>gate θ=${p.theta.toFixed(2)} — ${Math.round(p.cost * 100)} judge calls / 100 prompts, ${metric} ${pct(p.v)}</title></g>`,
    )
    .join("");

  const label = (p: (typeof pts)[number], dx: number, dy: number) =>
    `<text class="ptlab" x="${(X(p.cost) + dx).toFixed(1)}" y="${(Y(p.v) + dy).toFixed(1)}">θ=${p.theta.toFixed(2)}</text>`;

  return `<figure class="chart small"><figcaption>${esc(title)}</figcaption>
<svg viewBox="0 0 ${b.w} ${b.h}" role="img" aria-label="${esc(title)}">
  ${axes(b, xTicks, yTicks, "judge calls per 100 prompts", metric)}
  <path class="curve solid" d="${path}"/>
  ${marks}
  ${label(pts[0] as any, 6, 16)}
  ${label(pts[pts.length - 1] as any, -34, -10)}
</svg></figure>`;
}

// ─── 4. Confusion heatmap ─────────────────────────────────────────────

function confusionChart(): string {
  const classes = d.confusion7.classes as string[];
  const m = d.confusion7.matrix as number[][];
  const cell = 52;
  const ml = 116;
  const mt = 78;
  const w = ml + classes.length * cell + 14;
  const h = mt + classes.length * cell + 16;
  const max = Math.max(...m.flat());

  const parts: string[] = [];
  classes.forEach((c, j) => {
    const x = ml + j * cell + cell / 2;
    parts.push(
      `<text class="tick hdr" transform="translate(${x},${mt - 10}) rotate(-42)" text-anchor="start">${esc(c)}</text>`,
    );
  });
  classes.forEach((rc, i) => {
    parts.push(
      `<text class="tick" x="${ml - 10}" y="${mt + i * cell + cell / 2 + 4}" text-anchor="end">${esc(rc)}</text>`,
    );
    (m[i] as number[]).forEach((v, j) => {
      const t = max ? v / max : 0;
      const diag = i === j;
      parts.push(
        `<g class="pt" tabindex="0"><rect class="cell${diag ? " diag" : ""}" x="${ml + j * cell + 1}" y="${mt + i * cell + 1}" width="${cell - 2}" height="${cell - 2}" rx="3" style="--t:${t.toFixed(3)}"/>` +
          `<title>reference ${esc(rc)} → production ${esc(classes[j] as string)}: ${v}</title></g>`,
      );
      if (v > 0) {
        parts.push(
          `<text class="cellval${t > 0.55 ? " on-dark" : ""}" x="${ml + j * cell + cell / 2}" y="${mt + i * cell + cell / 2 + 4}" text-anchor="middle">${v}</text>`,
        );
      }
    });
  });

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Confusion matrix, reference judge rows against production judge columns">${parts.join("")}</svg>`;
}

// ─── 5. Label distribution ────────────────────────────────────────────

function distributionChart(): string {
  const dist = d.refLabelDistribution as Record<string, number>;
  const entries = Object.entries(dist).filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const push = new Set(["correction", "rejection", "failure_report"]);
  const w = 620;
  const rowH = 30;
  const ml = 128;
  const mr = 76;
  const iw = w - ml - mr;
  const max = Math.max(...entries.map(([, n]) => n));
  const h = entries.length * rowH + 12;

  const parts = entries.map(([label, n], i) => {
    const y = 8 + i * rowH;
    const bw = (iw * n) / max;
    return (
      `<text class="rowlab" x="${ml - 12}" y="${y + 15}" text-anchor="end">${esc(label)}</text>` +
      `<g class="pt" tabindex="0"><rect class="bar ${push.has(label) ? "s1" : "neutral"}" x="${ml}" y="${y}" width="${bw.toFixed(1)}" height="19" rx="4"/>` +
      `<title>${esc(label)}: ${n} (${pct(n / total)})</title></g>` +
      `<text class="barval" x="${(ml + bw + 8).toFixed(1)}" y="${y + 14}">${n} · ${pct(n / total, 0)}</text>`
    );
  });

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Reference label distribution">${parts.join("")}</svg>`;
}

// ─── tables ───────────────────────────────────────────────────────────

function baselineTable(): string {
  const rows = (d.baselines as Array<any>)
    .filter((x) => x.id !== "B6")
    .filter((x) => typeof x.theta !== "number" || [0.3, 0.5, 0.6].includes(x.theta))
    .map(
      (x) =>
        `<tr${x.id === "B0" ? ' class="zero"' : ""}${typeof x.theta === "number" && x.theta === 0.3 ? ' class="pick"' : ""}>
        <td class="mono">${esc(x.id)}</td><td>${esc(x.name)}</td>
        <td class="num">${x.tp}</td><td class="num">${x.fp}</td><td class="num">${x.fn}</td>
        <td class="num">${pct(x.precision)}</td><td class="num">${pct(x.recall)}</td>
        <td class="num">${pct(x.f1)}</td><td class="num strong">${pct(x.f05)}</td>
        <td class="num">${x.judgeCallRate ? Math.round(x.judgeCallRate * 100) + "%" : "—"}</td>
        <td class="note">${esc(x.note)}</td></tr>`,
    )
    .join("");
  return `<div class="tw"><table>
  <thead><tr><th></th><th>detector</th><th class="num">TP</th><th class="num">FP</th><th class="num">FN</th>
  <th class="num">precision</th><th class="num">recall</th><th class="num">F1</th><th class="num">F0.5</th><th class="num">judge calls</th><th></th></tr></thead>
  <tbody>${rows}</tbody></table></div>`;
}

function perClassTable(): string {
  const rows = (d.perClass.classes as Array<any>)
    .filter((c) => c.support > 0)
    .map(
      (c) =>
        `<tr><td>${esc(c.label)}</td><td class="num">${pct(c.p)}</td><td class="num">${pct(c.r)}</td><td class="num">${pct(c.f1)}</td><td class="num">${c.support}</td></tr>`,
    )
    .join("");
  return `<div class="tw"><table><thead><tr><th>label</th><th class="num">precision</th><th class="num">recall</th><th class="num">F1</th><th class="num">support</th></tr></thead>
  <tbody>${rows}<tr class="pick"><td><strong>macro</strong></td><td class="num">—</td><td class="num">—</td><td class="num strong">${pct(d.perClass.macro)}</td><td class="num">${d.corpus.evaluated}</td></tr></tbody></table></div>`;
}

function scriptTable(): string {
  const rows = (d.perScript as Array<any>)
    .map(
      (s) =>
        `<tr><td class="mono">${esc(s.script)}</td><td class="num">${s.n}</td><td class="num">${pct(s.pushbackRate)}</td>
      <td class="num zero-cell">${s.recallB0 === null ? "—" : pct(s.recallB0)}</td>
      <td class="num">${s.recallB1 === null ? "—" : pct(s.recallB1)}</td>
      <td class="num">${s.recallB2 === null ? "—" : pct(s.recallB2)}</td>
      <td class="num strong">${s.recallB5 === null ? "—" : pct(s.recallB5)}</td></tr>`,
    )
    .join("");
  return `<div class="tw"><table><thead><tr><th>script</th><th class="num">n</th><th class="num">pushback rate</th>
  <th class="num">B0 recall</th><th class="num">B1 recall</th><th class="num">B2 recall</th><th class="num">B5 recall</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function costTable(): string {
  const rows = (d.costs as Array<any>)
    .map(
      (c) =>
        `<tr><td class="mono">${esc(c.run)}</td><td class="mono">${esc(c.model)}</td><td class="num">${c.n}</td>
      <td class="num">$${c.totalUSD.toFixed(2)}</td><td class="num">$${c.perCallUSD.toFixed(5)}</td>
      <td class="num">${c.avgLatencyMs} ms</td><td class="num${c.cacheHitRate === 0 ? " zero-cell" : ""}">${pct(c.cacheHitRate, 0)}</td></tr>`,
    )
    .join("");
  return `<div class="tw"><table><thead><tr><th>run</th><th>model</th><th class="num">calls</th><th class="num">total</th><th class="num">per call</th><th class="num">latency</th><th class="num">cache hit</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function weightsTable(): string {
  const rows = (d.headroom.weights as Array<any>)
    .slice()
    .sort((a, b2) => Math.abs(b2.weight) - Math.abs(a.weight))
    .map(
      (wgt) =>
        `<tr><td class="mono">${esc(wgt.feature)}</td><td class="num ${wgt.weight >= 0 ? "pos" : "neg"}">${wgt.weight >= 0 ? "+" : ""}${wgt.weight.toFixed(3)}</td></tr>`,
    )
    .join("");
  return `<div class="tw"><table><thead><tr><th>feature</th><th class="num">fitted weight</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ─── page ─────────────────────────────────────────────────────────────

const c = d.corpus;
const ab = d.ablation;
const gate = d.gate;
const b5 = (d.baselines as Array<any>).find((x) => x.theta === 0.3);
const b0 = (d.baselines as Array<any>).find((x) => x.id === "B0");
const b1 = (d.baselines as Array<any>).find((x) => x.id === "B1");
const prodCost = (d.costs as Array<any>).find((x) => x.run === "prod");

const html = `<title>Correction Detection Bench</title>
<style>
:root{
  --ground:#F4F5F4; --surface:#FBFCFB; --sunken:#EAEDEC;
  --ink:#15191B; --ink-2:#4B5559; --ink-3:#7E888C;
  --rule:#DDE2E1; --rule-2:#C5CCCB;
  --s0:#0D9488; --s1:#B45309; --s2:#4338CA; --s3:#BE185D;
  --neutral-bar:#B9C2C1;
  --heat:13,148,136; --t:0;
  --shadow:0 1px 2px rgba(21,25,27,.05),0 10px 28px -20px rgba(21,25,27,.28);
  --font-ui:"IBM Plex Sans KR","IBM Plex Sans",system-ui,sans-serif;
  --font-prose:"Newsreader","Noto Serif KR",Georgia,serif;
  --font-data:"IBM Plex Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#101314; --surface:#16181A; --sunken:#0D0F10;
  --ink:#E7EBEA; --ink-2:#A4AEAD; --ink-3:#6F7A79;
  --rule:#242A2B; --rule-2:#333B3C;
  --s0:#19A090; --s1:#C97C1F; --s2:#5E63D8; --s3:#CC4B84;
  --neutral-bar:#3C4547;
  --heat:25,160,144;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 12px 30px -22px rgba(0,0,0,.9);
}}
:root[data-theme="dark"]{
  --ground:#101314; --surface:#16181A; --sunken:#0D0F10;
  --ink:#E7EBEA; --ink-2:#A4AEAD; --ink-3:#6F7A79;
  --rule:#242A2B; --rule-2:#333B3C;
  --s0:#19A090; --s1:#C97C1F; --s2:#5E63D8; --s3:#CC4B84;
  --neutral-bar:#3C4547;
  --heat:25,160,144;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 12px 30px -22px rgba(0,0,0,.9);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--font-prose);font-size:16.5px;line-height:1.65;-webkit-font-smoothing:antialiased;word-break:keep-all}
.page{max-width:66rem;margin:0 auto;padding:0 1.6rem 6rem}
h1,h2,h3,h4{font-family:var(--font-ui);font-weight:700;letter-spacing:-.018em;margin:0;line-height:1.25;text-wrap:balance}
h1{font-size:clamp(2.1rem,5.4vw,3rem);letter-spacing:-.032em}
h2{font-size:clamp(1.35rem,3vw,1.7rem)}
h3{font-size:1.02rem;font-weight:600}
p{margin:0}
code,.mono{font-family:var(--font-data);font-size:.85em}
code{background:var(--sunken);border:1px solid var(--rule);border-radius:3px;padding:.06em .32em}
strong{font-weight:600}
a{color:var(--s0)}
.eyebrow{font-family:var(--font-data);font-size:.69rem;letter-spacing:.15em;text-transform:uppercase;color:var(--ink-3)}
header.top{padding:4rem 0 1.4rem;border-bottom:2px solid var(--ink)}
header.top h1{margin:1.2rem 0 .8rem}
header.top .sub{font-size:1.15rem;color:var(--ink-2);max-width:38rem}
.meta{display:flex;flex-wrap:wrap;gap:0 2rem;padding-top:1rem;font-family:var(--font-data);font-size:.73rem;color:var(--ink-3)}
.meta b{color:var(--ink-2);font-weight:500}
section{padding-top:3.6rem}
section>*+*{margin-top:1.05rem}
.sec-head{display:flex;align-items:baseline;gap:.8rem;padding-bottom:.8rem;border-bottom:1px solid var(--rule);margin-bottom:1.6rem!important}
.sec-head .n{font-family:var(--font-data);font-size:.76rem;color:var(--s1);font-variant-numeric:tabular-nums}
.lede{font-size:1.08rem;color:var(--ink-2);max-width:44rem}
.note{font-family:var(--font-ui);font-size:.87rem;line-height:1.6;color:var(--ink-2);max-width:46rem}
.headline{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr));margin-top:2.4rem}
.kpi{background:var(--surface);border:1px solid var(--rule);border-radius:5px;padding:1.05rem 1.15rem 1.15rem;display:flex;flex-direction:column;gap:.35rem}
.kpi .v{font-family:var(--font-ui);font-weight:700;font-size:2rem;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1}
.kpi .v.bad{color:var(--s3)}
.kpi .v.good{color:var(--s0)}
.kpi .k{font-family:var(--font-data);font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.kpi .d{font-family:var(--font-ui);font-size:.8rem;color:var(--ink-2);line-height:1.45}
figure.chart{margin:1.6rem 0 0;background:var(--surface);border:1px solid var(--rule);border-radius:5px;padding:1.1rem 1.2rem 1rem;overflow-x:auto}
figure.chart figcaption{font-family:var(--font-data);font-size:.7rem;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);margin-bottom:.7rem}
figure.chart svg{display:block;width:100%;height:auto;min-width:340px}
figure.chart.small{margin-top:0}
.pair{display:grid;gap:1rem;grid-template-columns:1fr}
@media(min-width:52rem){.pair{grid-template-columns:1fr 1fr}}
.legend{display:flex;flex-wrap:wrap;gap:.35rem 1.2rem;margin-top:.85rem;font-family:var(--font-ui);font-size:.8rem;color:var(--ink-2)}
.legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:.4rem;vertical-align:-1px}
.grid{stroke:var(--rule);stroke-width:1}
.tick{font-family:var(--font-data);font-size:10.5px;fill:var(--ink-3)}
.tick.hdr{font-size:10px}
.axis-label{font-family:var(--font-data);font-size:10px;fill:var(--ink-3);letter-spacing:.06em;text-transform:uppercase}
.curve{fill:none;stroke:var(--ink-3);stroke-width:2;stroke-dasharray:5 4;stroke-linejoin:round}
.curve.solid{stroke:var(--s0);stroke-dasharray:none}
.curve-lab{font-family:var(--font-data);font-size:10px;fill:var(--ink-3);letter-spacing:.05em}
.prevalence{stroke:var(--rule-2);stroke-width:1.5;stroke-dasharray:2 4}
.prev-lab{font-size:10px}
.dot{stroke:var(--surface);stroke-width:2}
.dot.s0{fill:var(--s0)}.dot.s1{fill:var(--s1)}.dot.s2{fill:var(--s2)}.dot.s3{fill:var(--s3)}
.ptlab{font-family:var(--font-ui);font-size:11.5px;font-weight:500;fill:var(--ink-2)}
.bar{stroke:var(--surface);stroke-width:2}
.bar.s0{fill:var(--s0)}.bar.s1{fill:var(--s1)}.bar.neutral{fill:var(--neutral-bar)}
.rowlab{font-family:var(--font-ui);font-size:12.5px;fill:var(--ink-2)}
.barval{font-family:var(--font-data);font-size:11px;fill:var(--ink-2);font-variant-numeric:tabular-nums}
.cell{fill:rgba(var(--heat),calc(.08 + var(--t) * .92));stroke:var(--surface);stroke-width:2}
.cell.diag{stroke:var(--ink-3);stroke-width:1.5;stroke-dasharray:2 2}
.cellval{font-family:var(--font-data);font-size:11px;fill:var(--ink-2);font-variant-numeric:tabular-nums}
.cellval.on-dark{fill:#fff}
.pt{cursor:default}
.pt:hover .dot,.pt:focus-visible .dot{r:8.5}
.pt:hover .bar,.pt:focus-visible .bar{filter:brightness(1.08)}
.pt:focus-visible{outline:2px solid var(--s1);outline-offset:2px}
.tw{overflow-x:auto;border:1px solid var(--rule);border-radius:5px;background:var(--surface);margin-top:1.2rem}
table{border-collapse:collapse;width:100%;font-size:.85rem}
thead th{font-family:var(--font-data);font-size:.66rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);text-align:left;padding:.65rem .85rem;border-bottom:1px solid var(--rule-2);white-space:nowrap}
tbody td{font-family:var(--font-ui);font-size:.86rem;padding:.55rem .85rem;border-top:1px solid var(--rule);color:var(--ink-2);vertical-align:top}
tbody td:first-child{color:var(--ink)}
tbody tr:first-child td{border-top:none}
.num{text-align:right;font-family:var(--font-data);font-variant-numeric:tabular-nums;white-space:nowrap}
td.strong{color:var(--ink);font-weight:600}
td.note{font-size:.8rem;color:var(--ink-3)}
tr.zero td{background:rgba(190,24,93,.07);box-shadow:inset 2px 0 0 var(--s3)}
tr.pick td{background:rgba(13,148,136,.08);box-shadow:inset 2px 0 0 var(--s0);color:var(--ink)}
td.zero-cell{color:var(--s3);font-weight:600}
td.pos{color:var(--s0)}td.neg{color:var(--s3)}
.callout{margin-top:1.4rem;padding:1rem 1.25rem;border-left:3px solid var(--s1);background:rgba(180,83,9,.07);font-family:var(--font-ui);font-size:.98rem;line-height:1.6;color:var(--ink)}
.callout.warn{border-left-color:var(--s3);background:rgba(190,24,93,.07)}
ul.plain{margin:0;padding-left:1.1rem;font-family:var(--font-ui);font-size:.9rem;color:var(--ink-2)}
ul.plain li{margin-top:.45rem}
ul.plain li::marker{color:var(--ink-3)}
footer{margin-top:5rem;padding-top:1.4rem;border-top:2px solid var(--ink);font-family:var(--font-data);font-size:.72rem;line-height:1.85;color:var(--ink-3)}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+KR:wght@500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,600&family=Noto+Serif+KR:wght@400;600&display=swap">

<div class="page">
<header class="top">
  <span class="eyebrow">reflect-bench · P0</span>
  <h1>Correction Detection Bench</h1>
  <p class="sub">${c.evaluated} real coding-agent turns from ${c.sessions} sessions, labelled and swept. The shipped detector finds none of them.</p>
  <div class="meta">
    <span>generated <b>${esc(String(d.generatedAt).slice(0, 10))}</b></span>
    <span>corpus <b>local Claude Code transcripts</b></span>
    <span>reference annotator <b>Opus 5, full context</b></span>
    <span>judge <b>Haiku 4.5</b></span>
  </div>
</header>

<div class="headline">
  <div class="kpi"><span class="k">shipped detector</span><span class="v bad">0</span><span class="d">true positives out of ${c.pushback} pushback turns. Precision and recall are both zero.</span></div>
  <div class="kpi"><span class="k">cascade θ=0.30</span><span class="v good">${pct(b5.precision, 0)}</span><span class="d">precision at ${pct(b5.recall, 0)} recall, calling the judge on ${Math.round(b5.judgeCallRate * 100)}% of prompts.</span></div>
  <div class="kpi"><span class="k">relational effect</span><span class="v">+${((ab.sighted.f1 - ab.blind.f1) * 100).toFixed(1)}</span><span class="d">F1 points the same judge gains from seeing what the agent just did.</span></div>
  <div class="kpi"><span class="k">gate recall ceiling</span><span class="v">${pct(gate.recallCeiling, 1)}</span><span class="d">Structural rejection discards ${pct(gate.rejectedShare, 0)} of prompts and only ${gate.pushbacksLost} true pushbacks.</span></div>
</div>

<section>
  <div class="sec-head"><span class="n">01</span><h2>What is in the corpus</h2></div>
  <p class="lede">Every user turn from ${c.sessions} local Claude Code sessions, paired with everything the agent did since the human last spoke. Labels come from Opus 5 reading that pair; the seven classes are SWE-chat's taxonomy so the numbers are comparable to a published benchmark.</p>
  <figure class="chart"><figcaption>reference label distribution · n=${c.evaluated}</figcaption>${distributionChart()}
  <div class="legend"><span><i style="background:var(--s1)"></i>counts as pushback</span><span><i style="background:var(--neutral-bar)"></i>does not</span></div></figure>
  <p class="note">Pushback here is <strong>${pct(c.pushbackRate)}</strong> of turns. SWE-chat measures <strong>39%</strong> across 6,000 sessions and five agents. The gap is worth stating rather than smoothing: this is one developer who writes long up-front specifications — ${pct((d.refLabelDistribution.instruction as number) / c.evaluated, 0)} of turns are instructions — and runs long autonomous stretches between interventions.</p>
</section>

<section>
  <div class="sec-head"><span class="n">02</span><h2>Every detector, in precision–recall space</h2></div>
  <p class="lede">The dashed line is the structural gate swept across every operating point. The labelled dots are the detectors. B0, the version on npm, sits at the origin — it is not on the curve because it never predicts anything.</p>
  <figure class="chart"><figcaption>precision vs recall · positive class = pushback · n=${c.evaluated}</figcaption>${prSpaceChart()}
  <div class="legend">
    <span><i style="background:var(--s0)"></i>uses the judge</span>
    <span><i style="background:var(--s1)"></i>structural only</span>
    <span><i style="background:var(--s2)"></i>judge without context</span>
    <span><i style="background:var(--s3)"></i>regex</span>
  </div></figure>
  ${baselineTable()}
  <p class="note">F0.5 weights precision over recall, which is the loss reflect actually faces: a missed correction costs nothing observable, while a false reflection costs a real interruption and real tokens. On that metric the shipped detector scores <strong>0</strong>, its Korean-aware counterfactual scores <strong>${pct(b1.f05)}</strong>, and the cascade scores <strong>${pct(b5.f05)}</strong>.</p>
</section>

<section>
  <div class="sec-head"><span class="n">03</span><h2>The signal is relational — measured</h2></div>
  <p class="lede">The claim in <code>evals/FINDINGS.md</code> was that an utterance alone cannot be classified: the same string is an instruction at the head of a task and a correction right after an edit. Same model, same pairs. What changes is the prior turn the judge is shown.</p>
  <figure class="chart"><figcaption>Haiku 4.5 · one arm per kind of context</figcaption>${ablationChart()}
  <div class="legend">
    <span><i style="background:var(--s0)"></i>its own prior turn</span>
    <span><i style="background:var(--s2)"></i>a different pair's prior turn</span>
    <span><i style="background:var(--s1)"></i>no prior turn</span>
  </div></figure>
  <div class="callout">Hiding the prior turn costs <strong>${((ab.sighted.recall - ab.blind.recall) * 100).toFixed(1)} points of recall</strong> and <strong>${((ab.sighted.f1 - ab.blind.f1) * 100).toFixed(1)} points of F1</strong>. Of the ${ab.disagreeCount} pairs where the two arms disagree, the blind judge misses ${ab.blindMissedTP} real pushbacks and invents ${ab.blindInventedFP} false ones.</div>
  ${
    d.shuffledAblation
      ? `<div class="callout">The middle arm is the control that decides it. Keep the context block exactly where it is, keep the rendering identical, and fill it with <em>another pair's</em> prior turn: F1 falls to <strong>${pct(d.shuffledAblation.f1)}</strong> — ${(d.shuffledAblation.f1DropVsSighted * 100).toFixed(1)} points, <strong>worse than removing the block entirely</strong>. A judge given wrong context does not merely lose the signal, it is actively misled. Whatever the sighted arm gains, it is not the shape of its prompt.</div>`
      : ""
  }
  <p class="note">Seven-way agreement and κ are deliberately <em>not</em> plotted here. Section 11c shows their gap is fully present on the ${d.gate.rejected} pairs where the prior turn is absent and the sighted arm therefore learns nothing — which makes them a measure of shared input format with the reference annotator, not of the effect under test.</p>
  <p class="note">This is the load-bearing result. Had the blind arm matched, the premise of the rebuild would be false and a better regex would have been the right answer.</p>
</section>

<section>
  <div class="sec-head"><span class="n">04</span><h2>What the gate costs and buys</h2></div>
  <p class="lede">Stage A reads no words. It asks only where the prompt sits relative to what the agent just did, which is why it generalises across languages for free — and why it is a good gate and a poor detector.</p>
  <div class="pair">
    ${frontierChart("recall", "recall vs judge spend")}
    ${frontierChart("precision", "precision vs judge spend")}
  </div>
  <p class="note">The hard gate refuses ${gate.rejected} of ${c.evaluated} pairs on two structural grounds only — no prior agent turn, or session opener — and discards just ${gate.pushbacksLost} true pushbacks doing it, leaving a recall ceiling of ${pct(gate.recallCeiling)}. Alone it reaches ${pct((d.baselines as Array<any>).find((x: any) => x.id === "B2").recall)} recall at ${pct((d.baselines as Array<any>).find((x: any) => x.id === "B2").precision)} precision: it finds nearly everything and is wrong three times in four. That is exactly the shape a cheap first stage should have.</p>
  ${scriptTable()}
  <p class="note">Per script, the shipped regex is at zero everywhere — including the Latin slice, where it was supposed to work.</p>
</section>

<section>
  <div class="sec-head"><span class="n">05</span><h2>Where the cheap judge and the reference disagree</h2></div>
  <p class="lede">Rows are the reference annotator, columns the Haiku judge that would ship. The diagonal is agreement.</p>
  <figure class="chart"><figcaption>confusion · reference (rows) × production judge (columns)</figcaption>${confusionChart()}</figure>
  ${perClassTable()}
  <p class="note">The cheap judge's failure is one-directional: it calls corrections instructions, not the other way round. For a harness whose false positives interrupt a working developer, under-detecting is the safe direction to be wrong in — but it is the ceiling on recall, and it is where a padded prompt or a stronger judge would pay.</p>
</section>

<section>
  <div class="sec-head"><span class="n">06</span><h2>Headroom left on the table</h2></div>
  <p class="lede">The shipped gate uses hand-set priors, deliberately not fitted — fitting on one developer's corpus is the same mistake the English-only regex made. This measures what that choice costs.</p>
  <p class="note">Hand priors reach <strong>AP ${d.headroom.handAP.toFixed(3)}</strong>. A five-fold cross-validated logistic fit on the identical features reaches <strong>AP ${d.headroom.fittedAP.toFixed(3)}</strong> — ${(((d.headroom.fittedAP - d.headroom.handAP) / d.headroom.handAP) * 100).toFixed(0)}% better, out of fold. Chance is ${c.pushbackRate.toFixed(3)}.</p>
  ${weightsTable()}
  <div class="callout warn">Two priors are not merely weak, they are <strong>backwards</strong>. <code>looksPasted</code> was set negative on the theory that pasted blobs are noise; the fit says strongly positive, and the mechanism is obvious in hindsight — a pasted stack trace is a failure report. <code>mediumPrompt</code> flips the same way. Neither correction is applied here: changing them on the evidence of the corpus they were measured on is fitting by hand. They are the first thing to re-test on a second corpus.</div>
</section>

<section>
  <div class="sec-head"><span class="n">07</span><h2>Measured cost</h2></div>
  ${costTable()}
  <div class="callout warn">The <code>prod</code> and <code>blind</code> rows read <strong>0% cache hit</strong>, and that is not a reporting error. Probed directly: at 2,207 tokens Haiku 4.5 writes no cache at all and returns no error, while the same request at 4,378 tokens caches normally. Haiku's minimum cacheable prefix is <strong>4,096</strong>, not the 1,024 that applies to most models — and Opus 5 tokenises the same string 1.30× longer, so a floor cleared under one model's <code>count_tokens</code> is not cleared under the other's. Roughly half the judge spend above was avoidable, and nothing surfaced it except an explicit probe.</div>
  <p class="note">At ${Math.round(b5.judgeCallRate * 100)} judge calls per 100 prompts and $${prodCost.perCallUSD.toFixed(5)} per call, the cascade costs <strong>$${(b5.judgeCallRate * 100 * prodCost.perCallUSD).toFixed(3)} per 100 prompts</strong> as measured — before the caching fix, which should roughly halve it.</p>
</section>

<section>
  <div class="sec-head"><span class="n">08</span><h2>Honest limits</h2></div>
  <ul class="plain">
    <li><strong>The reference is a gold proxy, not gold.</strong> Labels come from Opus 5, validated against nothing but itself so far. <code>bench/review-*.md</code> exports ${d.agreement.prodVsRef.n ? "a stratified sample" : "samples"} for human marking; until that is done, no agreement figure here should be read as human agreement.</li>
    <li><strong>One developer, one language pair.</strong> The zero-detection result generalises to anyone prompting in a language the regex does not speak. The precision and recall figures describe this corpus.</li>
    <li><strong>Main-thread only.</strong> Subagent transcripts are excluded, as they were in the July replay. Whether subagent turns should count remains an open design question.</li>
    <li><strong>This measures the detector, not the intervention.</strong> Whether a reflection helps once it fires is still untested and still unfalsifiable at N=1. Nothing here changes that.</li>
  </ul>
</section>

<footer>
  <div>reflect-bench · reproduce with <span class="mono">npx tsx bench/extract.ts</span> → <span class="mono">bench/label.ts</span> → <span class="mono">bench/score.ts</span> → <span class="mono">bench/report.ts</span></div>
  <div>Taxonomy: SWE-chat, arXiv 2604.20779. Prior art on asynchronous self-intervention: Wink, arXiv 2602.17037.</div>
  <div>Corpus and labels stay local; this page contains only aggregates and redacted excerpts.</div>
</footer>
</div>`;

mkdirSync(join(OUT, ".."), { recursive: true });
writeFileSync(OUT, html, "utf8");
process.stderr.write(`[report] wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB)\n`);
