// One structured call to Claude, with the step's pinned model, max_tokens and effort from
// core/config.ts. The caller passes the client, so the spike and the app's server each
// decide where the key comes from. Nothing here reads or logs the key.
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { STEPS, PRICES, FALLBACK_MODELS, type StepName } from "./config.ts";

export type Usage = { step: StepName; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number };

export type Image = { mediaType: "image/jpeg" | "image/png"; base64: string };

// For a model with no listed price, charge the dearest listed price so spend is never undercounted.
const DEAREST = Object.values(PRICES).reduce((a, b) => (b.output > a.output ? b : a));

/** Dollar cost of one response's usage. Cache writes are billed at 1.25x input. */
export function usdFor(model: string, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
  const price = PRICES[model] ?? DEAREST;
  return (
    (u.input_tokens * price.input +
      u.output_tokens * price.output +
      (u.cache_read_input_tokens ?? 0) * price.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * price.input * 1.25) /
    1e6
  );
}

/** Worst-case dollar cost of one call to a step: its input estimate plus every allowed output token. */
export function worstCaseUsd(step: StepName, inputTokens: number) {
  const cfg = STEPS[step];
  const price = PRICES[cfg.model] ?? DEAREST;
  return (inputTokens * price.input + cfg.max_tokens * price.output) / 1e6;
}

export class StepError extends Error {
  constructor(
    message: string,
    readonly kind: "refusal" | "max_tokens" | "schema",
    readonly usage: Usage,
  ) {
    super(message);
  }
}

export async function callStructured<S extends z.ZodType>(
  client: Anthropic,
  opts: { step: StepName; system: string; user: string; images?: Image[]; schema: S },
): Promise<{ data: z.infer<S>; usage: Usage }> {
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

  const u = response.usage;
  const usage: Usage = {
    step: opts.step,
    model: response.model,
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    usd: usdFor(response.model, u),
  };

  // Every failure carries its usage, so the caller can still count the spend.
  if (response.stop_reason === "refusal") {
    throw new StepError(`${opts.step}: the model declined (${response.stop_details?.category ?? "no category"}).`, "refusal", usage);
  }
  if (response.stop_reason === "max_tokens") {
    throw new StepError(`${opts.step}: hit max_tokens (${cfg.max_tokens}). Raise it in core/config.ts.`, "max_tokens", usage);
  }
  if (!response.parsed_output) throw new StepError(`${opts.step}: response did not match the schema.`, "schema", usage);

  return { data: response.parsed_output as z.infer<S>, usage };
}
