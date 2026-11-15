// scripts/build-hook.mjs: build the plugin's hooks and the npm package's command.
//
//   plugin/hooks/reflect-hook.mjs + lib/   from src/plugin-entry.ts, committed
//   dist/reflect.mjs + lib/                from src/entry.ts, gitignored, built before npm pack
//
// A plugin install copies plugin/ and runs nothing: no `npm install`, no dist/.
// So the hooks ship as committed ES modules with the Anthropic SDK inside them.
// The SDK sits in chunks under lib/ that only the judge and the reflection
// import, so the hooks that run on every tool call do not parse it. The
// licences of everything bundled are written to THIRD_PARTY_LICENSES.txt beside
// each bundle.
//
// The plugin's bundle holds only what the hooks need. It swaps
// src/api/credentials.ts for src/api/credentials.plugin.ts (the plugin's key
// setting and nothing else), and takes out of its copy of the SDK every read of
// the environment and the credential chain (token files, OAuth, profiles), which
// the plugin never uses because it always passes the key in code. The build
// then fails if the bundle reads any environment variable outside PLUGIN_ENV,
// or holds a shebang or the SDK's credential code.
//
// Anthropic's plugin directory holds any non-image file of 256 KiB or more for
// a reviewer, because its scanner does not read it in full. The build fails if
// a plugin file reaches that size, so every bundled file stays readable.
//
//   node scripts/build-hook.mjs           build both
//   node scripts/build-hook.mjs --cli     build dist/ only (npm pack, smoke test)
//   node scripts/build-hook.mjs --check   exit 1 if the committed plugin bundle is stale (CI)

import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const cliOnly = process.argv.includes("--cli");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const rel = (f) => relative(root, f).split(sep).join("/");

/** The variables the plugin's bundle may read (src/plugin-entry.ts). */
const PLUGIN_ENV = new Set([
  "CLAUDE_PLUGIN_ROOT",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY",
  "CLAUDE_PLUGIN_OPTION_REFLECTION_MODEL",
  "CLAUDE_PLUGIN_OPTION_MAX_USD_PER_SESSION",
  "REFLECT_DISABLED",
  "REFLECT_INNER",
  "REFLECT_POLICY",
  "REFLECT_MODEL",
  "REFLECT_EFFORT",
  "REFLECT_JUDGE_MODEL",
  "REFLECT_JUDGE_THINKING",
  "REFLECT_MAX_USD_PER_SESSION",
]);

const SDK_FILE = /[\\/]node_modules[\\/]@anthropic-ai[\\/]sdk[\\/]/;

// ─── esbuild plugins ────────────────────────────────────────────────────

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
// out as a chunk that no file loads. Both bundles get an empty module instead.
const AGENT_TOOLSET = [/[\\/]sdk[\\/]tools[\\/]agent-toolset[\\/]node(\.mjs)?$/, "sdk-agent-toolset-node", "export {};"];

// The plugin's bundle only. The plugin passes its key and base URL in code, so
// the SDK never needs the environment or a credential file.
const PLUGIN_SDK_STUBS = [
  AGENT_TOOLSET,
  [/[\\/]sdk[\\/]internal[\\/]utils[\\/]env\.mjs$/, "sdk-env",
    "// reflect's plugin bundle: the SDK reads no environment variables.\nexport const readEnv = (_name) => undefined;\n"],
  [/[\\/]sdk[\\/]lib[\\/]credentials[\\/]types\.mjs$/, "sdk-credential-types",
    'export const OAUTH_API_BETA_HEADER = "oauth-2025-04-20";\n'],
  [/[\\/]sdk[\\/]lib[\\/]credentials[\\/]token-cache\.mjs$/, "sdk-token-cache",
    'export class TokenCache {\n  constructor() {\n    throw new Error("reflect\'s plugin bundle has no token credentials");\n  }\n}\n'],
  [/[\\/]sdk[\\/]lib[\\/]credentials[\\/]credential-chain\.mjs$/, "sdk-credential-chain",
    'export function resolveCredentialsFromConfig() {\n  throw new Error("reflect\'s plugin bundle has no credential config");\n}\nexport async function defaultCredentials() {\n  return null;\n}\n'],
];

/**
 * With readEnv stubbed, its call sites still name the variables, and the SDK's
 * doc comments and one log message spell `process.env[...]`. A reader of the
 * bundle should not have to work out that none of it runs, so take the text
 * out too: each call becomes `undefined`, which is what the stub returns.
 */
const sdkWithoutEnvText = {
  name: "sdk-without-env-text",
  setup(b) {
    b.onLoad({ filter: /[\\/]@anthropic-ai[\\/]sdk[\\/].*\.mjs$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      if (!src.includes("readEnv(") && !src.includes("process.env")) return undefined;
      const out = src
        .replace(/readEnv\((['"])[A-Z0-9_]+\1\)/g, "undefined")
        .replace(/"process\.env\['([A-Z0-9_]+)'\]"/g, '"$1"')
        // A warning about two variables the stub never reads; it cannot fire.
        .replace("ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are both set. Using ANTHROPIC_API_KEY.",
          "an API key and an auth token are both set. Using the API key.")
        .split("\n")
        .filter((line) => !(/^\s*\*/.test(line) && line.includes("process.env")))
        .join("\n");
      return { contents: out, loader: "js", resolveDir: dirname(args.path) };
    });
  },
};

const pluginCredentials = {
  name: "plugin-credentials",
  setup(b) {
    const cli = join(root, "src", "api", "credentials.ts");
    b.onResolve({ filter: /[\\/]credentials\.js$/ }, (args) => {
      const full = resolve(args.resolveDir, args.path).replace(/\.js$/, ".ts");
      return full === cli ? { path: join(root, "src", "api", "credentials.plugin.ts") } : undefined;
    });
  },
};

// ─── build ──────────────────────────────────────────────────────────────

const header = [
  `// ${pkg.name} ${pkg.version}. Generated by scripts/build-hook.mjs from src/; do not edit.`,
  "// Third-party code bundled here is listed with its licence in THIRD_PARTY_LICENSES.txt beside it.",
  // Some bundled CommonJS reaches for require(); give it one.
  'import { createRequire as __reflectCreateRequire } from "node:module";',
  "const require = __reflectCreateRequire(import.meta.url);",
];

async function bundle({ entry, outdir, plugins, shebang }) {
  const result = await build({
    plugins,
    absWorkingDir: root,
    entryPoints: entry,
    outdir,
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
    banner: { js: (shebang ? ["#!/usr/bin/env node", ...header] : header).join("\n") },
    logLevel: "warning",
  });
  return { outputs: result.outputFiles.map((f) => [f.path, f.text]), metafile: result.metafile };
}

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

/** What the plugin's bundle must not contain. Each entry: a pattern and why. */
function auditPlugin(outputs) {
  const problems = [];
  for (const [f, text] of outputs) {
    if (text.startsWith("#!")) problems.push(`${rel(f)}: starts with #!`);
    for (const m of text.matchAll(/process\.env(\??\.\[|\[|\.)?\s*(["'])?([A-Za-z0-9_]*)/g)) {
      const literal = (m[1] === "[" || m[1] === "?.[") && m[2] && PLUGIN_ENV.has(m[3]);
      const dotted = m[1] === "." && PLUGIN_ENV.has(m[3]);
      if (!literal && !dotted) problems.push(`${rel(f)}: reads the environment outside PLUGIN_ENV: ${m[0]}`);
    }
    for (const re of [/readEnv\(/, /Deno\.env/, /TOKEN_ENDPOINT/, /oauth\/token/, /(?<![A-Z_])ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL|CUSTOM_HEADERS|PROFILE)\b/]) {
      const m = new RegExp(`.{0,60}(?:${re.source}).{0,40}`).exec(text);
      if (m) problems.push(`${rel(f)}: contains /${re.source}/: ${m[0]}`);
    }
    // ${NAME} reads like a shell variable to the directory's scanner, and a
    // credential-like name beside a URL is held for review.
    for (const m of text.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) {
      if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE/.test(m[1])) problems.push(`${rel(f)}: template reference ${m[0]}`);
    }
  }
  return problems;
}

const SIZE_LIMIT = 256 * 1024;

async function buildPlugin() {
  const HOOKS = join(root, "plugin", "hooks");
  const LIB = join(HOOKS, "lib");
  const { outputs, metafile } = await bundle({
    entry: { "reflect-hook": "src/plugin-entry.ts" },
    outdir: HOOKS,
    plugins: [stubs("plugin-sdk-stubs", PLUGIN_SDK_STUBS), sdkWithoutEnvText, pluginCredentials],
    shebang: false,
  });
  const lic = notices(metafile,
    "plugin/hooks/reflect-hook.mjs and plugin/hooks/lib/ bundle the following packages. reflect itself is MIT (see LICENSE).\n" +
    "In this copy of @anthropic-ai/sdk, the build replaces the modules that read environment variables and\n" +
    "credential files with stubs, because the plugin passes its API key in code (scripts/build-hook.mjs).");
  const targets = [...outputs, [join(HOOKS, "THIRD_PARTY_LICENSES.txt"), lic.text]];

  const problems = auditPlugin(outputs);
  for (const [f, text] of targets) {
    if (Buffer.byteLength(text) >= SIZE_LIMIT) problems.push(`${rel(f)}: ${Buffer.byteLength(text)} bytes; the plugin directory holds files of 256 KiB or more`);
  }
  for (const p of problems) console.error(`plugin bundle: ${p}`);
  if (problems.length) process.exit(1);

  const existing = existsSync(LIB) ? readdirSync(LIB).map((n) => join(LIB, n)) : [];
  const leftovers = existing.filter((f) => !outputs.some(([p]) => p === f));
  if (check) {
    const stale = targets.filter(([f, want]) => !existsSync(f) || readFileSync(f, "utf8").replace(/\r\n/g, "\n") !== want);
    for (const [f] of stale) console.error(`stale: ${rel(f)} (run npm run build)`);
    for (const f of leftovers) console.error(`left over: ${rel(f)} (run npm run build)`);
    process.exit(stale.length || leftovers.length ? 1 : 0);
  }
  mkdirSync(LIB, { recursive: true });
  for (const f of leftovers) rmSync(f);
  for (const [f, text] of targets) writeFileSync(f, text);
  for (const [f, text] of outputs) console.log(`${rel(f).padEnd(44)} ${(Buffer.byteLength(text) / 1024).toFixed(0).padStart(5)} KB`);
  console.log(`plugin: ${lic.names.length} bundled packages: ${lic.names.join(", ")}`);
}

async function buildCli() {
  const DIST = join(root, "dist");
  const { outputs, metafile } = await bundle({
    entry: { reflect: "src/entry.ts" },
    outdir: DIST,
    plugins: [stubs("cli-sdk-stubs", [AGENT_TOOLSET])],
    shebang: true,
  });
  const lic = notices(metafile, "dist/reflect.mjs and dist/lib/ bundle the following packages. reflect itself is MIT (see LICENSE).");
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "lib"), { recursive: true });
  for (const [f, text] of outputs) writeFileSync(f, text);
  writeFileSync(join(DIST, "THIRD_PARTY_LICENSES.txt"), lic.text);
  console.log(`${rel(join(DIST, "reflect.mjs")).padEnd(44)} and ${outputs.length - 1} chunks in dist/lib/`);
}

if (check) await buildPlugin();
else {
  if (!cliOnly) await buildPlugin();
  await buildCli();
}
