// One place for the model, length cap and effort of every pipeline step.
// Change a step's model here and nowhere else.
export const STEPS = {
  plan: { model: "claude-sonnet-5-5", max_tokens: 12000, effort: "high" },
  write: { model: "claude-sonnet-5-5", max_tokens: 12000, effort: "high" },
  critique: { model: "claude-haiku-5-5", max_tokens: 8000, effort: "medium" }, // upgrade if it misses issues
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
