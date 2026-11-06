// Netlify background function for the bold pass (see server/bold.ts). Netlify answers the
// caller 202 at once and lets this run up to 15 minutes. scripts/bundle-functions.ts bundles
// this file into netlify/functions/bold-background.mjs at build time, with the react-server
// condition, so the server code's `server-only` guard resolves the same way it does in Next.
import { z } from "zod";
import { runBold } from "../server/bold-run.ts";
import { backgroundDeps } from "../server/bold-start.ts";

const Trigger = z.strictObject({
  sessionId: z.string().min(1).max(64),
  postId: z.string().min(1).max(64),
  token: z.string().min(1).max(64),
  phase: z.enum(["build", "judge"]),
});

export default async (req: Request) => {
  if (req.method !== "POST") return;
  const t = Trigger.safeParse(await req.json().catch(() => null));
  // runBold checks the token against the stored job before it spends anything.
  if (!t.success) return;
  await runBold(backgroundDeps(), t.data, process.env.GEMINI_API_KEY?.trim() || undefined);
};
