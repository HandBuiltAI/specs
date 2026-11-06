// One place for the model, length cap and effort of every pipeline step.
// Change a step's model here and nowhere else.
export const STEPS = {
  plan: { model: "claude-sonnet-5-5", max_tokens: 12000, effort: "high" },
  write: { model: "claude-sonnet-5-5", max_tokens: 12000, effort: "high" },
  // Compose (phase 6): designs each post's layout from the kit's layout-system chunk. Code checks
  // the result (core/compose.ts); the six templates are the fallback.
  compose: { model: "claude-sonnet-5-5", max_tokens: 10000, effort: "medium" },
  // Bolder posts spike (Nov 6): an art director proposes three directions, a designer builds each
  // with a larger CSS toolkit, and a creative director picks the strongest from the renders.
  directions: { model: "claude-sonnet-5-5", max_tokens: 6000, effort: "medium" },
  compose_bold: { model: "claude-sonnet-5-5", max_tokens: 16000, effort: "medium" },
  art_critique: { model: "claude-sonnet-5-5", max_tokens: 6000, effort: "medium" },
  critique: { model: "claude-haiku-5-5", max_tokens: 8000, effort: "medium" }, // upgrade if it misses issues
  // Extraction (phase 4). Each call has to finish inside the deployed function's ~26 s Claude
  // timeout, so reading runs at low effort and assembling drafts one chunk per call.
  read: { model: "claude-sonnet-5-5", max_tokens: 6000, effort: "low" },
  assemble: { model: "claude-sonnet-5-5", max_tokens: 6000, effort: "medium" },
  // Intake (phase 5): one short turn per question, choosing a gap and one catalog component.
  intake: { model: "claude-haiku-5-5", max_tokens: 3000, effort: "low" },
} as const;

export type StepName = keyof typeof STEPS;

// USD per million tokens, for the cost line on the review page. Check current pricing before relying on it.
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

// Server-side refusal fallback: if a Sonnet or Opus step is declined, the API retries on a
// fallback model inside the same call. Haiku has no server-side fallback.
export const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);
