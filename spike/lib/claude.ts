// One structured call to Claude, with the step's pinned model, max_tokens and effort.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { STEPS, PRICES, FALLBACK_MODELS, type StepName } from "../config.ts";

// Reads ANTHROPIC_API_KEY from the environment (loaded from .env by `npm run spike`). Never logged.
const client = new Anthropic();

export type Usage = { step: StepName; model: string; input: number; output: number; cacheRead: number; usd: number };

export type Image = { mediaType: "image/jpeg" | "image/png"; base64: string };

export async function callStructured<S extends z.ZodType>(opts: {
  step: StepName;
  system: string;
  user: string;
  images?: Image[];
  schema: S;
}): Promise<{ data: z.infer<S>; usage: Usage }> {
  const cfg = STEPS[opts.step];
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(opts.images ?? []).map(
      (img): Anthropic.Beta.BetaImageBlockParam => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }),
    ),
    { type: "text", text: opts.user },
  ];
  const useFallback = FALLBACK_MODELS.has(cfg.model);

  const response = await client.beta.messages.parse({
    model: cfg.model,
    max_tokens: cfg.max_tokens,
    output_config: { effort: cfg.effort, format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content }],
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`${opts.step}: the model declined (${response.stop_details?.category ?? "no category"}).`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(`${opts.step}: hit max_tokens (${cfg.max_tokens}). Raise it in spike/config.ts.`);
  }
  if (!response.parsed_output) throw new Error(`${opts.step}: response did not match the schema.`);

  const price = PRICES[response.model] ?? PRICES[cfg.model] ?? { input: 0, output: 0, cacheRead: 0 };
  const u = response.usage;
  const usage: Usage = {
    step: opts.step,
    model: response.model,
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    usd: (u.input_tokens * price.input + u.output_tokens * price.output + (u.cache_read_input_tokens ?? 0) * price.cacheRead) / 1e6,
  };
  return { data: response.parsed_output as z.infer<S>, usage };
}
