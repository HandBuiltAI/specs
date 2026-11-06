// Reads the guard settings from environment variables. Every setting fails closed: a missing
// or malformed value turns generation off rather than leaving it uncapped.
import "server-only";
import { LIMITS } from "../core/limits.ts";

export type Settings = {
  generationEnabled: boolean;
  dailyCapUsd: number;
  turnstileSecret: string | undefined;
  ipHashSalt: string | undefined;
  apiKeyPresent: boolean;
  /** Whether the image model's key is set. Without it the bold pass runs on Claude alone. */
  geminiKeyPresent: boolean;
};

export function readSettings(env: Record<string, string | undefined> = process.env): Settings {
  const rawCap = env.DAILY_SPEND_CAP_USD?.trim();
  const cap = rawCap ? Number(rawCap) : LIMITS.dailySpendCapUsd;
  return {
    // Only the exact value "true" turns generation on.
    generationEnabled: env.GENERATION_ENABLED?.trim().toLowerCase() === "true",
    // A cap that isn't a finite, non-negative number closes generation (cap 0).
    dailyCapUsd: Number.isFinite(cap) && cap >= 0 ? cap : 0,
    turnstileSecret: env.TURNSTILE_SECRET_KEY?.trim() || undefined,
    ipHashSalt: env.IP_HASH_SALT?.trim() || undefined,
    // Only whether it's there. The key itself is read once, in server/claude.ts.
    apiKeyPresent: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    geminiKeyPresent: Boolean(env.GEMINI_API_KEY?.trim()),
  };
}
