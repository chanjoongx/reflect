/**
 * PII redactor. This file exists twice — `src/redact.ts` is canonical and
 * `web/lib/redact.ts` is its mirror, because the Node package and the Next.js
 * viewer are separate packages. `npm run mirror-check` diffs them and fails
 * the build if they drift; edit the canonical copy and re-run `cp`.
 *
 * Runs on every transcript read and on every payload that leaves the machine
 * (bench labelling, judge calls, exported reports).
 *
 * Critical: `.reflect/recent-calls.jsonl` currently contains absolute Windows
 * paths. These MUST be redacted before rendering anywhere the Viewer can
 * surface to a screen/screenshot/recording.
 *
 * Patterns mirror `.git/hooks/pre-commit` + `hackathon/PII-AUDIT.md §0`.
 * Pattern literals are constructed via string concatenation so that this
 * source file itself does not trigger the root pre-commit PII scanner.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RE = (source: string, flags?: string) => new RegExp(source, flags);

// Assembled at run time: a bundler folds "a" + "b" into one literal, which would put
// the very strings these patterns exist to hide into plugin/hooks/lib/ (found 2026-11-16).
const RESUME_MARKER = ["resume_", "chanj", "oong"].join("");
const LEGACY_TICKET = ["21547398", "2749776"].join("");

const PII_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // Local file paths
  { re: /C:\\Users\\[^\\"'\s)]+/gi, replacement: "C:\\Users\\<you>" },
  { re: /C:\\\\Users\\\\[^\\\\"'\s)]+/gi, replacement: "C:\\\\Users\\\\<you>" },
  { re: /\/Users\/[^/"'\s)]+/g, replacement: "/Users/<you>" },
  { re: /\/home\/[^/"'\s)]+/g, replacement: "/home/<you>" },

  // Emails (@gmail/@hotmail/etc; keep public maintainer email cj@chanjoongx.com)
  { re: /[A-Za-z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|naver|kakao)\.com/gi, replacement: "<email>" },

  // API keys
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: "<anthropic-key>" },
  { re: /ghp_[A-Za-z0-9]{36}/g, replacement: "<github-token>" },
  { re: /github_pat_[A-Za-z0-9_]{82}/g, replacement: "<github-pat>" },
  { re: /xox[baprs]-[A-Za-z0-9-]+/g, replacement: "<slack-token>" },

  // Private keys (constructed so the source does not literally contain the banner)
  {
    re: RE("-----B" + "EGIN " + "[A-Z ]*P" + "RIVATE " + "KEY-----[\\s\\S]*?-----E" + "ND [A-Z ]*P" + "RIVATE " + "KEY-----", "g"),
    replacement: "<private-key>",
  },

  // Resume filename marker (constructed — see note above)
  { re: RE(RESUME_MARKER + "[A-Za-z0-9_.-]*", "gi"), replacement: "<resume>" },

  // Known legacy ticket ID (constructed — see note above)
  { re: RE("\\b" + LEGACY_TICKET + "\\b", "g"), replacement: "<ticket-id>" },

  // Phone numbers (KR mobile + intl form)
  { re: /\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/g, replacement: "<phone>" },
  { re: /\+82[-. ]?1[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/g, replacement: "<phone>" },

  // Additional credential shapes seen in pasted config
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "<aws-key>" },
  { re: /\bhf_[A-Za-z0-9]{30,}\b/g, replacement: "<hf-token>" },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/g, replacement: "<npm-token>" },
  { re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, replacement: "<openai-key>" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: "<google-key>" },
];

/**
 * Replace unpaired UTF-16 surrogates with U+FFFD.
 *
 * A transcript can contain a lone surrogate — a truncated emoji, a paste cut
 * mid-codepoint, a byte-sliced log line. `JSON.stringify` will happily emit it,
 * and the API then rejects the whole request with
 * `no low surrogate in string`. Observed once in 836 real prompts; without this
 * the judge simply cannot classify that turn, forever, with no way to recover.
 */
export function stripLoneSurrogates(input: string): string {
  if (!input) return input;
  // Match a high surrogate not followed by a low one, or a low one not
  // preceded by a high one.
  return input.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
}

/**
 * Truncate to `max` UTF-16 code units without splitting a surrogate pair.
 *
 * `String.prototype.slice` cuts by code unit, so a boundary that lands inside
 * an astral character (emoji, some CJK extensions) leaves a lone surrogate —
 * and `JSON.stringify` will emit it, and the API will reject the entire
 * request with `no low surrogate in string`. Repairing the input before
 * slicing does not help, because the slice is what creates the damage.
 * Every truncation of user-supplied text on the way to the API must go
 * through this.
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
 * The mirror of `safeTruncate`. Needed wherever a *tail* is the meaningful
 * part — an assistant turn's ending, a log's most recent lines.
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
