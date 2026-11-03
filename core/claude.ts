// One structured call to Claude, with the step's pinned model, max_tokens and effort from
// core/config.ts. The caller passes the client, so the spike and the app's server each
// decide where the key comes from. Nothing here reads or logs the key.
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { STEPS, PRICES, FALLBACK_MODELS, type StepName } from "./config.ts";

export type Usage = { step: StepName; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number };

export type Image = { mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; base64: string };

/**
 * Extra inputs some steps need. `documents` are PDFs. `cachedText` goes before the user text
 * with a cache breakpoint, so calls that share it (the assemble calls all read the same
 * evidence) pay full price for it once. `fetchDomain` lets Claude fetch pages from that one
 * site with the web fetch tool, a few pages at most.
 */
export type CallExtras = { documents?: { base64: string }[]; cachedText?: string; fetchDomain?: string };

/** Web fetch limits: the homepage plus one or two pages, each cut to a few thousand tokens (spec, Decisions). */
export const FETCH_LIMITS = { maxUses: 3, maxContentTokens: 6000 } as const;

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
    readonly kind: "refusal" | "max_tokens" | "schema" | "paused",
    readonly usage: Usage,
  ) {
    super(message);
  }
}

export async function callStructured<S extends z.ZodType>(
  client: Anthropic,
  opts: { step: StepName; system: string; user: string; images?: Image[]; schema: S } & CallExtras,
): Promise<{ data: z.infer<S>; usage: Usage }> {
  const cfg = STEPS[opts.step];
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(opts.documents ?? []).map(
      (doc): Anthropic.Beta.BetaRequestDocumentBlock => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.base64 } }),
    ),
    ...(opts.images ?? []).map(
      (img): Anthropic.Beta.BetaImageBlockParam => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }),
    ),
    ...(opts.cachedText ? [{ type: "text" as const, text: opts.cachedText, cache_control: { type: "ephemeral" as const } }] : []),
    { type: "text", text: opts.user },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] | undefined = opts.fetchDomain
    ? [
        {
          type: "web_fetch_20260209",
          name: "web_fetch",
          allowed_domains: [opts.fetchDomain],
          max_uses: FETCH_LIMITS.maxUses,
          max_content_tokens: FETCH_LIMITS.maxContentTokens,
        },
      ]
    : undefined;
  const useFallback = FALLBACK_MODELS.has(cfg.model);

  const response = await client.beta.messages.parse({
    model: cfg.model,
    max_tokens: cfg.max_tokens,
    output_config: { effort: cfg.effort, format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content }],
    ...(tools ? { tools } : {}),
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
  if (response.stop_reason === "pause_turn") {
    throw new StepError(`${opts.step}: the web fetch didn't finish in one turn.`, "paused", usage);
  }
  if (!response.parsed_output) throw new StepError(`${opts.step}: response did not match the schema.`, "schema", usage);

  return { data: response.parsed_output as z.infer<S>, usage };
}
