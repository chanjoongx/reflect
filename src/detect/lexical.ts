// src/detect/lexical.ts — B0 / B1 baselines.
//
// B0 is the SHIPPED v0.1.4 detector, transcribed verbatim from
// hooks/reflect-utterance.sh (lines 95/103/106) and hooks/reflect-trigger.sh.
// It is kept byte-faithful on purpose: the bench must reproduce the thing that
// actually shipped, not a tidied-up version of it.
//
// B1 is the Korean-aware counterfactual from evals/replay_history.py. It was
// never shipped; it exists to quantify the blind spot and, per FINDINGS §5,
// to demonstrate that translating the regex is NOT the fix.

// ─── B0 — shipped, English only ───────────────────────────────────────

/** reflect-utterance.sh:95 — checked FIRST; suppresses the signal. */
export const RE_POSITIVE_EN =
  /(i see why|you were right|good point|fair point|makes sense|that makes sense|i understand|i agree|nice catch)/i;

/** reflect-utterance.sh:103 — anchored at start of prompt. */
export const RE_NEGATION_EN_ANCHORED =
  /^[ \t]*(no[ \t]+wait|no[ \t]+stop|no,|nope,|nah,|undo[ \t]+that|undo[ \t]+this|revert[ \t]+that|revert[ \t]+this|that.s[ \t]+wrong|that.s[ \t]+not|stop[-—,.]|don.t[ \t]|hold[ \t]+on|wait,|actually[ \t]+let.s[ \t]+not|please[ \t]+undo|please[ \t]+revert)/i;

/** reflect-utterance.sh:106 — unanchored. */
export const RE_NEGATION_EN_ANYWHERE =
  /(rollback[ \t]+that|undo[ \t]+my[ \t]+last|revert[ \t]+the[ \t]+last|back[ \t]+out[ \t]+of[ \t]+that)/i;

/** The shipped Tier 3 detector. Operates on the first 400 chars, as the hook does. */
export function lexicalEn(prompt: string): boolean {
  const head = prompt.slice(0, 400);
  if (RE_POSITIVE_EN.test(head)) return false;
  return RE_NEGATION_EN_ANCHORED.test(head) || RE_NEGATION_EN_ANYWHERE.test(head);
}

// ─── B1 — Korean counterfactual (never shipped) ───────────────────────

export const RE_POSITIVE_KO = /(맞아|맞네|좋은\s*지적|이해했|그렇네|납득|알겠)/;

export const RE_NEGATION_KO =
  /(아니(야|요|다|,|\s|$)|아냐|아닌데|그게\s*아니|틀렸|틀린데|되돌려|돌려놔|취소|원복|롤백|하지\s*마|하지마|그만|멈춰|스톱|잠깐|잠시만|기다려|다시\s*해|다시해|엎어|갈아|왜\s*그렇게|누가\s*그렇게|그거\s*말고|그건\s*아니)/;

export function lexicalKo(prompt: string): boolean {
  const head = prompt.slice(0, 400);
  if (RE_POSITIVE_KO.test(head)) return false;
  return RE_NEGATION_KO.test(head);
}

/** B1 = B0 ∪ Korean. */
export function lexicalMultilingual(prompt: string): boolean {
  return lexicalEn(prompt) || lexicalKo(prompt);
}

// ─── Tier 1 / Tier 2 — tool-side signals (hooks/reflect-trigger.sh) ───

export const RE_TIER1 = /^(git revert|git restore|git checkout HEAD --)/;
export const RE_TIER2 = /^(rm |unlink )/;
export const RE_TIER2_EXCLUDE = /(node_modules|dist|build|\.next|coverage)/;

export type ToolTier = 0 | 1 | 2;

/** Shipped tool-side tiering, verbatim from the production hook. */
export function toolTier(toolName: string, command: string): ToolTier {
  if (toolName !== "Bash" || !command) return 0;
  if (RE_TIER1.test(command)) return 1;
  if (RE_TIER2.test(command) && !RE_TIER2_EXCLUDE.test(command)) return 2;
  return 0;
}

// ─── Script detection (for per-language slicing, not for detection) ───

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
const CJK = /[一-鿿぀-ヿ]/;

export type Script = "ko" | "cjk" | "latin" | "mixed";

export function detectScript(s: string): Script {
  const ko = HANGUL.test(s);
  const cjk = CJK.test(s);
  const latin = /[A-Za-z]{3}/.test(s);
  if (ko && latin) return "mixed";
  if (ko) return "ko";
  if (cjk) return "cjk";
  return "latin";
}
