// bench/judge-variants.ts: the judge variants bench/variants.ts can run.
//
// A variant is a system prompt plus a request shape. `v0-*` is the rubric that
// ships in src/detect/judge-prompt.ts today; later ids are candidate rubrics,
// each written as an edit of the one before it so the diff is the experiment.

import { JUDGE_SYSTEM } from "../src/detect/judge-prompt.js";
import { DEFAULT_JUDGE_MODEL } from "../src/models.js";

export type Shape = "api" | "mod" | "text";

export interface Variant {
  id: string;
  system: string;
  shape: Shape;
  model: string;
  /** One line on what this variant changes and why. */
  note: string;
}

/** Replace one passage of a rubric, failing loudly if it is not there exactly once. */
export function edit(base: string, from: string, to: string): string {
  const n = base.split(from).length - 1;
  if (n !== 1) throw new Error(`rubric edit: expected 1 match, found ${n}: ${from.slice(0, 60)}`);
  return base.replace(from, to);
}

const V0 = JUDGE_SYSTEM;

// v1: on the dev half, most of v0's misses were developers saying the round
// the agent just delivered falls short ("not enough", "do it properly", "you
// should have"), followed by a larger ask. v0 reads the larger ask and says
// instruction. The examples below are written fresh, not copied from dev.
const DISSATISFACTION = `**Dissatisfaction with what was just delivered is a reaction.** The agent reports a finished round and the developer answers "이 정도로는 안 돼" (this won't do), "대충 하지 말고 다시 제대로" (stop cutting corners, do it again properly), "this still isn't good enough, take it to production quality", or "그건 먼저 확인했어야지" (you should have checked that first). However large the work that follows, the developer wrote the message because the delivered result fell short of what they wanted, so the label is **correction**. Compare "좋아, 이제 여기에 기능을 더 붙여줘" (good, now add more features on top), which accepts the result before extending it: **instruction**. What separates the two is whether the message judges the delivered work as falling short.

`;

const V1 = edit(
  edit(V0, "**Approval plus new work.**", `${DISSATISFACTION}**Approval plus new work.**`),
  "4. Does it require existing output to change \u2014 a different approach, a corrected fact, a removed piece, a fixed wrong assumption? → **correction**.",
  "4. Does it require existing output to change (a different approach, a corrected fact, a removed piece, a fixed wrong assumption), or does it say the work just delivered falls short of what the developer wanted (not good enough, not done properly, should have been done differently)? → **correction**.",
);

// v2: v1 plus the second dev pattern, a fact the last answer did not account
// for and has to change because of ("I already did that", "the real numbers
// are these"), which v0 reads as instruction or question.
const NEW_FACTS = `**New facts that overturn the last answer.** The developer supplies a fact the agent's last answer did not account for, and that answer has to change because of it: "그건 지난주에 이미 끝냈어" (I already finished that last week) after the agent scheduled it as the next step, or "실제 수치는 이거야" (the real figures are these) followed by numbers that differ from the ones the agent used. → **correction**. Answering a question the agent explicitly asked, where nothing already produced has to change, is **instruction**.

`;

const V2 = edit(V1, "**Reporting someone else's error is not a failure_report.**", `${NEW_FACTS}**Reporting someone else's error is not a failure_report.**`);

// v3: v2 without the sentence telling the judge a missed correction is cheap.
// That sentence was written for labelling the reference set; for reflect a
// missed correction is the error that matters, so test whether it costs recall.
const V3 = edit(
  V2,
  " The cost of a missed correction is small; the cost of a confidently wrong label is that it silently corrupts everything measured downstream from it.",
  "",
);

export const VARIANTS: Record<string, Variant> = {
  "v0-api": { id: "v0-api", system: V0, shape: "api", model: DEFAULT_JUDGE_MODEL, note: "the shipped rubric, the npm command's request" },
  "v0-mod": { id: "v0-mod", system: V0, shape: "mod", model: DEFAULT_JUDGE_MODEL, note: "the shipped rubric, the plugin's request" },
  "v0-text": { id: "v0-text", system: V0, shape: "text", model: DEFAULT_JUDGE_MODEL, note: "the shipped rubric, the schema in the message and no identity line: separates the two ways the plugin's request differs" },
  "v1-text": { id: "v1-text", system: V1, shape: "text", model: DEFAULT_JUDGE_MODEL, note: "adds: dissatisfaction with the delivered round is correction" },
  "v2-text": { id: "v2-text", system: V2, shape: "text", model: DEFAULT_JUDGE_MODEL, note: "v1 plus: a new fact that overturns the last answer is correction" },
  "v3-text": { id: "v3-text", system: V3, shape: "text", model: DEFAULT_JUDGE_MODEL, note: "v2 without the line that a missed correction is cheap" },
};
