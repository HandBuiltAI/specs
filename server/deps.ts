// The real dependencies for the API routes.
import "server-only";
import { readSettings } from "./settings.ts";
import { liveKV } from "./store.ts";
import { turnstileVerifier } from "./turnstile.ts";
import { liveCallStep } from "./claude.ts";
import type { Deps } from "./handlers.ts";

export function liveDeps(): Deps {
  const settings = readSettings();
  return {
    kv: liveKV(),
    settings,
    now: () => new Date(),
    // Without a secret every check fails, and generationState already reports "not_configured".
    verifyTurnstile: settings.turnstileSecret ? turnstileVerifier(settings.turnstileSecret) : async () => false,
    callStep: liveCallStep,
  };
}
