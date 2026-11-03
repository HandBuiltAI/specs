// The spike's Claude client. Reads ANTHROPIC_API_KEY from the environment (loaded from .env by
// `npm run spike`). Never logged. The call itself lives in core/claude.ts, shared with the app.
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { callStructured as call, type Image, type Usage } from "../../core/claude.ts";
import type { StepName } from "../../core/config.ts";

export type { Image, Usage };

let client: Anthropic | undefined;

export function callStructured<S extends z.ZodType>(opts: { step: StepName; system: string; user: string; images?: Image[]; schema: S }) {
  client ??= new Anthropic();
  return call(client, opts);
}
