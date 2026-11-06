// How a bold pass's background work gets started. On Netlify: a request to the background
// function (it answers 202 at once and runs up to 15 minutes). Elsewhere (next dev with the
// memory store): the same work, in this process, not awaited.
import "server-only";
import { liveDeps } from "./deps.ts";
import { backgroundCallStep } from "./claude.ts";
import { runBold } from "./bold-run.ts";
import type { BoldTrigger, StartBackground } from "./bold.ts";
import type { Deps } from "./handlers.ts";

/** The dependencies the background run uses: the live ones, with a Claude client that waits minutes. */
export const backgroundDeps = (): Deps => ({ ...liveDeps(), callStep: backgroundCallStep });

export function liveStarter(req: Request): StartBackground {
  const onNetlify = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!onNetlify) {
    return async (t: BoldTrigger) => {
      void runBold(backgroundDeps(), t, process.env.GEMINI_API_KEY?.trim() || undefined);
    };
  }
  return async (t: BoldTrigger) => {
    const base = process.env.URL && process.env.CONTEXT === "production" ? process.env.URL : new URL(req.url).origin;
    const res = await fetch(`${base}/.netlify/functions/bold-background`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(t), signal: AbortSignal.timeout(8000) });
    if (res.status !== 202 && !res.ok) throw new Error(`Background function answered ${res.status}`);
  };
}
