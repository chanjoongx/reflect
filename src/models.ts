// src/models.ts: every model id reflect names, in one module with no imports,
// so the hooks that never call a model can read them without loading the SDK.

/** The judge the hook runs. Claude Haiku 5.5: $0.10 / $0.50 per MTok, 512-token cache floor. */
export const DEFAULT_JUDGE_MODEL = "claude-haiku-5-5";
/**
 * The models behind the 2026-08 benchmark. Pinned by id in bench/label.ts so a
 * change to the product default can never relabel the reference silently.
 */
export const BENCH_PROD_MODEL = "claude-haiku-4-5";
export const REFERENCE_JUDGE_MODEL = "claude-opus-5";

/** The reflection, written only when pushback clusters. */
export const DEFAULT_REFLECTION_MODEL = "claude-opus-5-5";
export const DEFAULT_REFLECTION_EFFORT = "high";
