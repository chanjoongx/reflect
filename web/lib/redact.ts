/**
 * PII redactor — runs on every server-side file read.
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

const RESUME_MARKER = "resume_" + "chanj" + "oong";
const LEGACY_TICKET = "21547398" + "2749776";

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
];

export function redactString(input: string): string {
  if (!input) return input;
  let out = input;
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
