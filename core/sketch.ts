// The image model's one job (Nov 6): paint a rough concept of a whole post, for Claude to
// rebuild in HTML. Google's Gemini API, generateContent with an image out. The caller passes the
// key; nothing here reads, stores or logs it. Shared by spike/sketch.ts and server/bold-run.ts.
import { SKETCH } from "./config.ts";
import type { Image } from "./claude.ts";

export type SketchResult = { ok: true; model: string; mediaType: string; base64: string; usd: number; seconds: number } | { ok: false; model: string | null; error: string; billed: boolean };

/** The worst a sketch can cost: the dearest listed model. Reserve this before calling. */
export const SKETCH_WORST_USD = Math.max(...Object.values(SKETCH.usdPerImage));

/**
 * One rough, from the filled prompts/sketch.md text and the reference images (the owner's
 * photo, then the logo). Tries the configured model names in order until one exists.
 */
export async function paintSketch(opts: {
  apiKey: string;
  text: string;
  images: Image[];
  aspect: "1:1" | "4:5";
  timeoutMs?: number;
  /** Start from a model already known to work. */
  model?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<SketchResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const body = (withSize: boolean) => ({
    contents: [{ role: "user", parts: [{ text: opts.text }, ...opts.images.map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.base64 } }))] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: opts.aspect, ...(withSize ? { imageSize: SKETCH.imageSize } : {}) } },
  });
  let last = "";
  for (const model of opts.model ? [opts.model] : [...SKETCH.models]) {
    for (const withSize of [true, false]) {
      const started = Date.now();
      let res: Response;
      try {
        res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
          body: JSON.stringify(body(withSize)),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
        });
      } catch (err) {
        // A timeout may still have been billed; count it.
        return { ok: false, model, error: `${model}: ${err instanceof Error ? err.name : "request failed"}`, billed: true };
      }
      const seconds = Math.round((Date.now() - started) / 1000);
      if (res.status === 404) {
        last = `${model}: not found`;
        break; // try the next model name
      }
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } }[] } }[] };
      if (!res.ok) {
        last = `${model}: ${res.status} ${json.error?.message ?? ""}`.trim();
        if (res.status === 400 && withSize && /size/i.test(last)) continue; // older models don't take imageSize
        if (res.status === 400 || res.status === 403) break;
        return { ok: false, model, error: last, billed: false };
      }
      const usd = SKETCH.usdPerImage[model] ?? SKETCH_WORST_USD;
      const parts = (json.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought);
      const img = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/") && p.inlineData.data)?.inlineData;
      if (!img) {
        const note = parts.map((p) => p.text ?? "").join(" ").trim().slice(0, 200);
        return { ok: false, model, error: `${model} returned no image (finish: ${json.candidates?.[0]?.finishReason ?? "?"})${note ? `: ${note}` : ""}`, billed: true };
      }
      return { ok: true, model, mediaType: img.mimeType!, base64: img.data!, usd, seconds };
    }
  }
  return { ok: false, model: null, error: `No image model worked. Last answer: ${last}`, billed: false };
}
