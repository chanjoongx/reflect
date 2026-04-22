// src/guidance-injector.ts — Write reflection to .reflect/session-guidance.md
//
// Per REFLECT.md <guidance_injection>:
//   - File overwritten on each new trigger (no accumulation)
//   - Deleted on session end (handled by bin/reflect.ts cleanup)
//   - Format: markdown for stetkeep path-scoped rule consumption

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Reflection } from "./types.js";

export const GUIDANCE_DIR = ".reflect";
export const GUIDANCE_FILENAME = "session-guidance.md";

export async function writeGuidance(
  projectDir: string,
  reflection: Reflection,
  meta: { triggeredAt: string; cost: number; cacheHitRate: number },
): Promise<string> {
  const dir = path.join(projectDir, GUIDANCE_DIR);
  const filePath = path.join(dir, GUIDANCE_FILENAME);

  await fs.mkdir(dir, { recursive: true });

  const content = formatGuidance(reflection, meta);
  await fs.writeFile(filePath, content, "utf8");

  return filePath;
}

export function formatGuidance(
  reflection: Reflection,
  meta: { triggeredAt: string; cost: number; cacheHitRate: number },
): string {
  const ftWarning =
    reflection.false_trigger_likelihood === "high"
      ? "\n> ⚠ false_trigger_likelihood is HIGH. Treat the adjustment as a question, not an instruction.\n"
      : "";

  const scopeNote =
    reflection.scope === "wider_concern"
      ? "\n> 🔍 scope: wider_concern — user may want to update CLAUDE.md or stetkeep rules.\n"
      : "";

  return `# Session reflection — last triggered ${meta.triggeredAt}

## What I was doing (pattern)

${reflection.pattern}

## Why the user pushed back (signal)

${reflection.signal}

## Adjustment for the rest of this session

${reflection.adjustment}

---

> Confidence: **${reflection.confidence}** · Scope: **${reflection.scope}** · FT-likelihood: **${reflection.false_trigger_likelihood}**
> Cost: $${meta.cost.toFixed(4)} · Cache hit rate: ${(meta.cacheHitRate * 100).toFixed(1)}%
${ftWarning}${scopeNote}
*This guidance is session-local and will evaporate at session end. The next reflection (if triggered) will overwrite this file.*
`;
}

export async function clearGuidance(projectDir: string): Promise<void> {
  const filePath = path.join(projectDir, GUIDANCE_DIR, GUIDANCE_FILENAME);
  try {
    await fs.unlink(filePath);
  } catch (e) {
    // Silent — file may not exist
  }
}

export async function readGuidance(projectDir: string): Promise<string | null> {
  const filePath = path.join(projectDir, GUIDANCE_DIR, GUIDANCE_FILENAME);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
