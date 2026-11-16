// src/detect/answer-format.ts: ask for JSON in the prompt and read it back
// tolerantly, for a model call with no structured-output option (the plugin's
// `$.model.complete`). bench/variants.ts sends the same request shape with
// these two functions, so the plugin's judge is measured as it ships.

/** The instruction appended to a prompt that cannot carry a JSON Schema format. */
export const answerAsJson = (schema: unknown): string =>
  `Answer with one JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(schema)}`;

/** Parse a JSON answer, allowing a sentence or a code fence around the object. */
export function parseLoose<T>(text: string, parse: (t: string) => T): T {
  try {
    return parse(text);
  } catch (first) {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return parse(text.slice(a, b + 1));
    throw first;
  }
}
