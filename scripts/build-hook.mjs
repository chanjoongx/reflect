// scripts/build-hook.mjs: build the plugin's mod and the npm package's command.
//
//   plugin/hooks/reflect.ts    from src/mod/reflect.ts and the src/ modules it imports, committed
//   dist/reflect.mjs + lib/    from src/entry.ts, gitignored, built before npm pack
//
// The plugin is a Claude Code mod. Claude Code loads plugin/hooks/reflect.ts
// itself, so the plugin ships TypeScript source and no bundled dependency. The
// build writes that module as one file: the src/ modules src/mod/reflect.ts
// imports, each placed before the modules that use it with its imports and
// export keywords taken out, then src/mod/reflect.ts itself. The plugin's only
// code file is then the module hooks/hooks.json names.
//
// The build fails if any plugin file is of a type the plugin directory does not
// take, starts with #!, or reaches 256 KiB, or if the module reaches for
// anything the mod does not need: Node, the network, files, processes, the
// environment, stored data or the transcript. The module may call only the
// engine methods in ENGINE_CALLS.
//
//   node scripts/build-hook.mjs           build both
//   node scripts/build-hook.mjs --cli     build dist/ only (npm pack, smoke test)
//   node scripts/build-hook.mjs --check   exit 1 if plugin/ is stale or breaks a rule (CI)

import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const cliOnly = process.argv.includes("--cli");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const rel = (f) => relative(root, f).split(sep).join("/");

// ─── The plugin's mod ───────────────────────────────────────────────────

const PLUGIN = join(root, "plugin");
const MOD_ENTRY = join(root, "src", "mod", "reflect.ts");
const MOD_OUT = join(PLUGIN, "hooks", "reflect.ts");
const HOOKS_JSON = { modules: ["./reflect.ts"] };

/** The engine methods the module may call, as `$.<noun>.<method>`. */
const ENGINE_CALLS = new Set(["model.complete", "clock.after", "ui.log", "session.usage"]);

/** File types the plugin directory takes from any organization, by extension. */
const ALLOWED_EXT = /\.(md|txt|json|ya?ml|png|jpe?g|gif|webp|ico)$/i;
/** Files the directory lets stay whatever their extension, when they are UTF-8 text. */
const ALLOWED_NAMES = new Set(["LICENSE", ".gitignore"]);
const SIZE_LIMIT = 256 * 1024;

/** What the module must not contain. Each entry: a pattern and why. */
const FORBIDDEN = [
  [/\bprocess\s*\./, "Node's process object (the environment, exit, argv)"],
  [/\bBuffer\b/, "Node's Buffer"],
  [/\brequire\s*\(/, "require()"],
  [/\bimport\s*\(/, "a dynamic import()"],
  [/\bfrom\s+["']node:/, "a Node built-in module"],
  [/\bfetch\s*\(|\b(XMLHttpRequest|WebSocket|EventSource)\b/, "a network API of its own"],
  [/\beval\s*\(|\bnew\s+Function\b/, "code built from a string"],
  [/https?:\/\//i, "a URL"],
  [/\.\s*(fs|process|http|store|net)\s*\./, "files, processes, the network or stored data through the engine"],
  [/\bmessages\b\s*\(|\.\s*messages\b/, "the transcript"],
  [/\.\s*fork\s*\(/, "a fork over the transcript"],
];

// Matches one import or re-export statement and captures the module it names.
const IMPORT_RE =
  /^(?:import(?:\s+type)?\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)|export(?:\s+type)?\s+(?:\*|\{[^}]*\}))\s+from\s+"(?<spec>[^"]+)";?[ \t]*\r?\n/gm;
const EXPORT_LIST_RE = /^export(?:\s+type)?\s+\{[^}]*\};?[ \t]*\r?\n/gm;
const EXPORT_KEYWORD_RE = /^export\s+(?=(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum|abstract)\b)/gm;
const OMIT_RE = /^\/\/ @plugin-omit-start[\s\S]*?^\/\/ @plugin-omit-end[ \t]*\r?\n/gm;
const DECL_RE = /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum|abstract class)\s+([A-Za-z_$][\w$]*)/gm;

/** src/mod/reflect.ts and every src/ module it reaches, each after the modules it imports. */
function modSources() {
  const order = [];
  const done = new Set();
  const visit = (file, chain) => {
    if (done.has(file)) return;
    if (chain.includes(file)) throw new Error(`import cycle: ${[...chain, file].map(rel).join(" -> ")}`);
    if (!existsSync(file)) throw new Error(`${rel(chain.at(-1))} imports ${rel(file)}, which does not exist`);
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m.groups.spec;
      if (spec === "claude-code" && file === MOD_ENTRY) continue;
      if (!spec.startsWith(".")) throw new Error(`${rel(file)} imports "${spec}"; the mod may import only src/ modules`);
      visit(resolve(dirname(file), spec.replace(/\.js$/, ".ts")), [...chain, file]);
    }
    done.add(file);
    order.push([file, text]);
  };
  visit(MOD_ENTRY, []);
  return order;
}

function generateMod() {
  const sources = modSources();
  const owners = new Map();
  const parts = [];
  for (const [file, text] of sources) {
    const isEntry = file === MOD_ENTRY;
    let body = text.replace(IMPORT_RE, "").replace(EXPORT_LIST_RE, "");
    if (isEntry) body = body.replace(OMIT_RE, "");
    else body = body.replace(EXPORT_KEYWORD_RE, "");
    for (const m of body.matchAll(DECL_RE)) {
      const prev = owners.get(m[1]);
      if (prev) throw new Error(`${m[1]} is declared in both ${prev} and ${rel(file)}; rename one, the plugin's module is one scope`);
      owners.set(m[1], rel(file));
    }
    parts.push(`// ${"─".repeat(3)} ${rel(file)} ${"─".repeat(Math.max(3, 66 - rel(file).length))}\n\n${body.trim()}\n`);
  }
  const head = [
    `// chanjoongx-reflect ${pkg.version}: reflect as a Claude Code mod.`,
    `// Generated by scripts/build-hook.mjs from ${rel(MOD_ENTRY)} and the src/ modules it`,
    "// imports, in that order of dependence; do not edit. Edit src/ and run `npm run build`.",
    "",
    'import type { Register } from "claude-code";',
    "",
  ].join("\n");
  return `${head}\n${parts.join("\n")}`;
}

/** Everything under plugin/ that breaks a directory rule or a rule of this build. */
function auditPlugin(modText) {
  const problems = [];
  // What a commit would hold: tracked and untracked files, less what .gitignore
  // keeps out (Claude Code lays a loaded mod's types in .claude-plugin/types/).
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", "plugin"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((f) => join(root, f))
    .filter((f) => existsSync(f) && statSync(f).isFile());
  const modules = new Set(HOOKS_JSON.modules.map((m) => join(PLUGIN, "hooks", m)));
  for (const f of files) {
    const name = f.split(sep).at(-1);
    const bytes = readFileSync(f);
    const isImage = /\.(png|jpe?g|gif|webp|ico)$/i.test(name);
    if (!modules.has(f) && !ALLOWED_EXT.test(name) && !ALLOWED_NAMES.has(name)) {
      problems.push(`${rel(f)}: the directory takes only Markdown, text, JSON, YAML and images, plus the mod's module`);
    }
    if (bytes.subarray(0, 2).toString() === "#!") problems.push(`${rel(f)}: starts with #!`);
    if (!isImage && bytes.includes(0)) problems.push(`${rel(f)}: holds a NUL byte`);
    if (!isImage && bytes.includes(13)) problems.push(`${rel(f)}: has CR line endings`);
    if (bytes.length >= SIZE_LIMIT) problems.push(`${rel(f)}: ${bytes.length} bytes; the directory holds files of 256 KiB or more`);
  }
  const hooks = JSON.parse(readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8"));
  if (JSON.stringify(hooks) !== JSON.stringify(HOOKS_JSON)) {
    problems.push(`plugin/hooks/hooks.json must be ${JSON.stringify(HOOKS_JSON)}: no hook of any type, only the module`);
  }
  // Comments may name things the code does not do; check the code alone.
  const code = modText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  for (const [re, why] of FORBIDDEN) {
    const m = code.match(re);
    if (m) problems.push(`${rel(MOD_OUT)}: ${why} (${JSON.stringify(m[0])})`);
  }
  for (const m of code.matchAll(/\$\s*\.\s*(\w+)\s*\.\s*(\w+)/g)) {
    if (!ENGINE_CALLS.has(`${m[1]}.${m[2]}`)) problems.push(`${rel(MOD_OUT)}: calls $.${m[1]}.${m[2]}, which is not in ENGINE_CALLS`);
  }
  const exports = [...code.matchAll(/^export\s+(?:const|function|let|class)\s+(\w+)/gm)].map((m) => m[1]);
  if (exports.join() !== "register") problems.push(`${rel(MOD_OUT)}: exports ${exports.join(", ") || "nothing"}; it must export register alone`);
  return problems;
}

function buildMod() {
  const text = generateMod();
  if (check) {
    const committed = existsSync(MOD_OUT) ? readFileSync(MOD_OUT, "utf8") : "";
    if (committed !== text) {
      console.error(`${rel(MOD_OUT)} is stale: run \`npm run build\` and commit the result.`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(MOD_OUT, text);
  }
  const problems = auditPlugin(text);
  for (const p of problems) console.error(`plugin: ${p}`);
  if (problems.length) process.exitCode = 1;
  if (process.exitCode) return;
  console.log(`${rel(MOD_OUT).padEnd(44)} ${(Buffer.byteLength(text) / 1024).toFixed(0).padStart(5)} KB, ${modSources().length} src/ modules`);
}

// ─── The npm package's command ──────────────────────────────────────────

const SDK_FILE = /[\\/]node_modules[\\/]@anthropic-ai[\\/]sdk[\\/]/;

/** Modules replaced by a fixed body. A fixed path, not the real one: esbuild names chunks from it. */
function stubs(name, table) {
  return {
    name,
    setup(b) {
      b.onResolve({ filter: /\.m?js$|agent-toolset[\\/]node$/ }, (args) => {
        const full = resolve(args.resolveDir, args.path);
        if (!SDK_FILE.test(full)) return undefined;
        const hit = table.find(([re]) => re.test(full));
        return hit ? { path: hit[1], namespace: "reflect-stub" } : undefined;
      });
      b.onLoad({ filter: /.*/, namespace: "reflect-stub" }, (args) => ({
        contents: table.find(([, p]) => p === args.path)[2],
        loader: "js",
      }));
    },
  };
}

// The SDK's agent toolset (a bash session, file tools, skill and memory
// downloads) is reached only through a dynamic import in code that reflect
// never calls. esbuild drops that code but still writes the imported module
// out as a chunk that no file loads, so the bundle gets an empty module instead.
const AGENT_TOOLSET = [/[\\/]sdk[\\/]tools[\\/]agent-toolset[\\/]node(\.mjs)?$/, "sdk-agent-toolset-node", "export {};"];

const header = [
  `// ${pkg.name} ${pkg.version}. Generated by scripts/build-hook.mjs from src/; do not edit.`,
  "// Third-party code bundled here is listed with its licence in THIRD_PARTY_LICENSES.txt beside it.",
  // Some bundled CommonJS reaches for require(); give it one.
  'import { createRequire as __reflectCreateRequire } from "node:module";',
  "const require = __reflectCreateRequire(import.meta.url);",
];

function licenceText(dir) {
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n));
  return f ? readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim() : null;
}

function notices(metafile, intro) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const parts = input.split(/[\\/]/);
    const i = parts.lastIndexOf("node_modules");
    if (i < 0) continue;
    const name = parts[i + 1]?.startsWith("@") ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1];
    const dir = join(root, ...parts.slice(0, i + 1), ...name.split("/"));
    if (!packages.has(name)) packages.set(name, dir);
  }
  const blocks = [...packages.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, dir]) => {
      const p = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const text = licenceText(dir) ?? `(no licence file in the package; package.json says ${p.license})`;
      const notice = existsSync(join(dir, "NOTICE")) ? "\n\nNOTICE\n\n" + readFileSync(join(dir, "NOTICE"), "utf8").trim() : "";
      return `${name}@${p.version} (${p.license})\n${"-".repeat(60)}\n${text}${notice}`;
    });
  return { names: [...packages.keys()], text: intro + "\n\n" + blocks.join("\n\n\n") + "\n" };
}

async function buildCli() {
  const DIST = join(root, "dist");
  const result = await build({
    plugins: [stubs("cli-sdk-stubs", [AGENT_TOOLSET])],
    absWorkingDir: root,
    entryPoints: { reflect: "src/entry.ts" },
    outdir: DIST,
    entryNames: "[name]",
    chunkNames: "lib/[name]-[hash]",
    outExtension: { ".js": ".mjs" },
    splitting: true,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    write: false,
    metafile: true,
    legalComments: "none",
    charset: "utf8",
    banner: { js: ["#!/usr/bin/env node", ...header].join("\n") },
    logLevel: "warning",
  });
  const outputs = result.outputFiles.map((f) => [f.path, f.text]);
  const lic = notices(result.metafile, "dist/reflect.mjs and dist/lib/ bundle the following packages. reflect itself is MIT (see LICENSE).");
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "lib"), { recursive: true });
  for (const [f, text] of outputs) writeFileSync(f, text);
  writeFileSync(join(DIST, "THIRD_PARTY_LICENSES.txt"), lic.text);
  console.log(`${rel(join(DIST, "reflect.mjs")).padEnd(44)} and ${outputs.length - 1} chunks in dist/lib/`);
}

if (check) buildMod();
else {
  if (!cliOnly) buildMod();
  await buildCli();
}
