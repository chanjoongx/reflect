/**
 * Redactor. This file exists twice: `src/redact.ts` is canonical and
 * `web/lib/redact.ts` is its mirror, because the Node package and the Next.js
 * viewer are separate packages. `npm run mirror-check` diffs them and fails
 * the build if they drift; edit the canonical copy and copy it over.
 *
 * Runs on everything reflect stores or sends: each judged message, each tool
 * call target and agent reply the hooks record, each payload to the API.
 * It is pattern matching, so a secret in an unusual format can get through.
 */

const PII_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // Home directories in local paths
  { re: /C:\\Users\\[^\\"'\s)]+/gi, replacement: "C:\\Users\\<you>" },
  { re: /C:\\\\Users\\\\[^\\\\"'\s)]+/gi, replacement: "C:\\\\Users\\\\<you>" },
  { re: /\/Users\/[^/"'\s)]+/g, replacement: "/Users/<you>" },
  { re: /\/home\/[^/"'\s)]+/g, replacement: "/home/<you>" },

  // Email addresses
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, replacement: "<email>" },

  // API keys and tokens
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: "<anthropic-key>" },
  { re: /ghp_[A-Za-z0-9]{36}/g, replacement: "<github-token>" },
  { re: /github_pat_[A-Za-z0-9_]{82}/g, replacement: "<github-pat>" },
  { re: /xox[baprs]-[A-Za-z0-9-]+/g, replacement: "<slack-token>" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "<aws-key>" },
  { re: /\bhf_[A-Za-z0-9]{30,}\b/g, replacement: "<hf-token>" },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/g, replacement: "<npm-token>" },
  { re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, replacement: "<openai-key>" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: "<google-key>" },

  // Private key blocks
  {
    re: /-----BEGIN [A-Z ]*PRIVATE[ ]KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE[ ]KEY-----/g,
    replacement: "<private-key>",
  },

  // Phone numbers: international form with a leading +, North American
  // (555) 123-4567 and 555-123-4567, and Korean mobile 010-1234-5678.
  { re: /\+\d{1,3}[-. ]?\(?\d{1,4}\)?(?:[-. ]?\d{2,4}){2,4}\b/g, replacement: "<phone>" },
  { re: /(?:\(\d{3}\)\s?|\b\d{3}[-. ])\d{3}[-. ]\d{4}\b/g, replacement: "<phone>" },
  { re: /\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/g, replacement: "<phone>" },
];

/**
 * Replace unpaired UTF-16 surrogates with U+FFFD.
 *
 * A message can contain a lone surrogate: a truncated emoji, a paste cut
 * mid-codepoint, a byte-sliced log line. `JSON.stringify` will happily emit it,
 * and the API then rejects the whole request with
 * `no low surrogate in string`. Observed once in 836 real prompts; without this
 * the judge simply cannot classify that turn, forever, with no way to recover.
 */
export function stripLoneSurrogates(input: string): string {
  if (!input) return input;
  // Match a high surrogate not followed by a low one, or a low one not
  // preceded by a high one.
  return input.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

/**
 * Truncate to `max` UTF-16 code units without splitting a surrogate pair.
 *
 * `String.prototype.slice` cuts by code unit, so a boundary that lands inside
 * an astral character (emoji, some CJK extensions) leaves a lone surrogate,
 * and the API rejects the entire request with `no low surrogate in string`.
 * Repairing the input before slicing does not help, because the slice is what
 * creates the damage. Every truncation of user-supplied text on the way to the
 * API must go through this.
 */
export function safeTruncate(input: string, max: number): string {
  if (input.length <= max) return input;
  let end = max;
  const c = input.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1; // do not orphan a high surrogate
  return input.slice(0, end);
}

/**
 * Keep the LAST `max` code units without orphaning a low surrogate.
 *
 * The mirror of `safeTruncate`. Needed wherever a tail is the meaningful
 * part: an assistant turn's ending, a log's most recent lines.
 */
export function safeTruncateEnd(input: string, max: number): string {
  if (input.length <= max) return input;
  let start = input.length - max;
  const c = input.charCodeAt(start);
  if (c >= 0xdc00 && c <= 0xdfff) start += 1; // do not orphan a low surrogate
  return input.slice(start);
}

export function redactString(input: string): string {
  if (!input) return input;
  let out = stripLoneSurrogates(input);
  for (const { re, replacement } of PII_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export function redactObject<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactString(input) as unknown as T;
  if (Array.isArray(input)) return input.map(redactObject) as unknown as T;
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = redactObject(v);
    }
    return out as T;
  }
  return input;
}
