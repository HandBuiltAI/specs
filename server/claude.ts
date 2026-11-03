// The only place the app creates a Claude client. The key comes from the server's environment
// (Netlify environment variables, or .env locally), is never logged, and `server-only` makes
// the build fail if anything in the browser bundle imports this file.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { callStructured, type Image, type Usage } from "../core/claude.ts";
import type { StepName } from "../core/config.ts";
import { Refusal } from "./http.ts";

export type CallStep = <S extends z.ZodType>(opts: { step: StepName; system: string; user: string; images?: Image[]; schema: S }) => Promise<{ data: z.infer<S>; usage: Usage }>;

let client: Anthropic | undefined;

export const liveCallStep: CallStep = (opts) => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Refusal(503, "not_configured", "Live generation isn't set up on this server yet.");
  // Netlify ends a function at 60 seconds; give up on Claude before that so the spend is settled.
  client ??= new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });
  return callStructured(client, opts);
};
