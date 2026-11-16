// src/transcript/text.ts: reading a prompt's text and a tool call's target.
//
// No I/O: the transcript parser, the CLI's hooks and the plugin's mod use it
// (`npm run build` writes it into plugin/hooks/reflect.ts with the mod).

// ─── Mutation classification ──────────────────────────────────────────

const MUTATING_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "str_replace_based_edit_tool",
]);

/**
 * Bash commands that change user-visible state. Deliberately broader than the
 * shipped Tier 1/2 regexes: this feeds Stage A's structural prior, not the
 * shipped weighted accumulator.
 */
const MUTATING_BASH =
  /(^|[;&|]\s*)(rm|unlink|mv|cp|mkdir|touch|git\s+(revert|restore|checkout|reset|apply|commit|add|rm|mv)|sed\s+-i|npm\s+(i|install|uninstall|publish)|pnpm\s+(add|remove)|yarn\s+(add|remove)|pip\s+install|dd|truncate|chmod|chown)\b|>\s*[^|&\s]/;

export function isMutating(name: string, input: Record<string, unknown>): boolean {
  if (MUTATING_TOOLS.has(name)) return true;
  if (name === "Bash" || name === "PowerShell") {
    const cmd = String(input["command"] ?? "");
    return MUTATING_BASH.test(cmd);
  }
  return false;
}

export function toolTarget(name: string, input: Record<string, unknown>): string {
  const fp = input["file_path"] ?? input["path"] ?? input["notebook_path"];
  if (typeof fp === "string" && fp) return fp;
  if (name === "Bash" || name === "PowerShell") {
    return String(input["command"] ?? "").slice(0, 200);
  }
  const pat = input["pattern"] ?? input["query"] ?? input["description"] ?? input["url"];
  if (typeof pat === "string" && pat) return pat.slice(0, 200);
  return "";
}

// ─── Prompt text ──────────────────────────────────────────────────────

/**
 * Strip harness-injected wrappers that are not user prose.
 *
 * Measured on 1,166 raw prompts from 226 local sessions: 233 of them (20%) are
 * ENTIRELY harness injection: `<task-notification>` background-task events
 * (219), `<bash-input>`/`<bash-stdout>` from `!` commands (10), and others.
 * A further 106 are a hook-injected context preamble (`<november-context>`)
 * followed by real user prose, so the block must be stripped without dropping
 * the prompt.
 *
 * The discriminator is structural, not a hand-maintained denylist: every
 * harness channel Claude Code emits uses a HYPHENATED tag name
 * (`task-notification`, `system-reminder`, `local-command-caveat`,
 * `bash-input`), while ordinary HTML a user might quote does not (`div`, `p`,
 * `code`). The HTML spec reserves hyphenated names for custom elements, so
 * this stays true for quoted markup as well. Fenced code is masked first so a
 * user pasting `<my-widget>` inside a fence survives.
 */
const EXTRA_WRAPPER_TAGS = [
  "command-name",
  "command-message",
  "command-args",
  "ide_opened_file",
  "ide_selection",
];

const HYPHENATED_BLOCK = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
/** Truncated / unclosed injection: a hyphenated open tag with no partner. */
const HYPHENATED_OPEN_TAIL = /<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?:\s[^>]*)?>[\s\S]*$/;
const FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;

/**
 * Channels Claude Code is known to inject. Used ONLY for the destructive
 * unclosed-tag path; the balanced-block strip above stays structural.
 */
const KNOWN_HARNESS_TAGS = new Set([
  "task-notification", "system-reminder", "local-command-caveat",
  "local-command-stdout", "local-command-stderr", "bash-input",
  "bash-stdout", "bash-stderr", "user-prompt-submit-hook",
  "command-name", "command-message", "command-args",
]);

export function stripWrappers(s: string): string {
  // 1. Mask fenced code so quoted markup is never touched. The sentinel is a
  //    Private Use Area codepoint: it cannot collide with anything a developer
  //    types, and unlike the NUL that was here before it does not turn this
  //    source file into something `grep` reports as binary.
  const fences: string[] = [];
  let out = s.replace(FENCE, (m) => {
    fences.push(m);
    return `\uE000FENCE${fences.length - 1}\uE000`;
  });

  // 2. balanced hyphenated blocks, repeatedly (they nest in practice)
  for (let i = 0; i < 4; i++) {
    const next = out.replace(HYPHENATED_BLOCK, " ");
    if (next === out) break;
    out = next;
  }

  // 3. explicit non-hyphenated harness tags
  for (const tag of EXTRA_WRAPPER_TAGS) {
    // In a template literal "\s" is just "s": the backslashes must be doubled
    // (until 2026-11-16 they were not, and IDE blocks reached the judge).
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), " ");
    out = out.replace(new RegExp(`<${tag}\\s*/>`, "g"), " ");
  }

  // 4. A leading UNCLOSED injection block (transcript truncation). This deletes
  //    everything after the tag, so it fires only on channels known to be
  //    harness output. Matching any hyphenated name would silently erase the
  //    whole prompt of anyone opening with `<my-widget>` or `<x-foo>`, which is
  //    ordinary vocabulary for a front-end developer.
  const lead = /^\s*<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/.exec(out);
  if (lead && KNOWN_HARNESS_TAGS.has(lead[1] as string)) {
    out = out.replace(HYPHENATED_OPEN_TAIL, " ");
  }

  // 5. Normalise whitespace BEFORE unmasking. Doing it afterwards undid the
  //    entire point of masking: it collapsed the indentation of every fenced
  //    code block the user pasted, changing both `promptChars` (a scored
  //    feature) and the text the judge reads.
  out = out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // 6. unmask
  out = out.replace(/\uE000FENCE(\d+)\uE000/g, (_m, i) => fences[Number(i)] ?? "");

  return out;
}


/**
 * Minimum residual prose for a stripped prompt to count as user-authored.
 * Below this the event was pure harness traffic and the pair is dropped.
 */
export const MIN_PROMPT_CHARS = 3;

/**
 * Auto-compaction writes its summary into the transcript as a `user` message.
 * Measured at 87 of 933 prompts (9.3%) in the local corpus, and they are the
 * longest messages present, so leaving them in would poison every
 * length-derived feature as well as the label distribution.
 */
const COMPACTION_CONTINUATION =
  /^\s*This session is being continued from a previous conversation/i;

/**
 * Bookkeeping slash commands. These are UI operations, not task interaction.
 * Task-bearing slash commands (`/undo`, `/rewind`, `/brain-reflect`, project
 * commands) are deliberately NOT listed: `/undo` in particular is a rejection
 * signal reflect should learn to read.
 */
const BOOKKEEPING_COMMANDS = new Set([
  "compact", "clear", "cost", "status", "resume", "exit", "quit", "help",
  "model", "config", "doctor", "login", "logout", "usage", "context",
  "export", "init", "terminal-setup", "vim", "statusline", "privacy-settings",
  "release-notes", "upgrade", "migrate-installer", "install-github-app",
]);

/** True when the event is harness bookkeeping rather than a user turn. */
export function isBookkeeping(prompt: string): boolean {
  const t = prompt.trim();
  if (COMPACTION_CONTINUATION.test(t)) return true;
  const m = /^\/([a-zA-Z0-9:_-]+)\s*(.*)$/s.exec(t);
  if (m && BOOKKEEPING_COMMANDS.has((m[1] as string).toLowerCase())) {
    // `/compact some instructions` still carries user intent; bare does not.
    return (m[2] ?? "").trim().length < MIN_PROMPT_CHARS;
  }
  return false;
}
