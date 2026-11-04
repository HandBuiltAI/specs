// Builds every prompt the app sends, from the bundled prompts/ files, the demo kit and the
// visitor's structured brief. The browser never supplies prompt text: free-typed fields enter
// only as escaped data inside the prompt's <brief> block.
import "server-only";
import { basename } from "node:path";
import { CONTENT } from "./generated/content.ts";
import type { KitSource } from "./kit-source.ts";
import { fillPrompt, asData } from "../core/prompts.ts";
import { selectChunks, formatChunks, approxTokens } from "../core/kit.ts";
import { findTemplate, parseTemplates, type TemplateSpec } from "../core/templates.ts";
import type { Image } from "../core/claude.ts";
import type { Plan, Written } from "../core/schemas.ts";
import type { PostIntent } from "../core/limits.ts";

export type Brief = { goal: string; details: string };

const templates = parseTemplates(CONTENT.templatesManifest);
const templatesForPrompt = JSON.stringify(templates, null, 2);

export { asData };

function common(b: KitSource, intent: PostIntent, brief: Brief) {
  return {
    // A visitor's business name and line came from their uploads, so they enter as data too.
    business_name: b.id === "session" ? asData(b.businessName) : b.businessName,
    business_line: b.id === "session" ? asData(b.businessLine) : b.businessLine,
    intent,
    goal: asData(brief.goal),
    details: asData(brief.details),
  };
}

const IMAGE_TOKENS = 1600; // About what one ~1,000px photo costs as input.

export const estimateInputTokens = (p: { system: string; user: string; images?: Image[] }) =>
  approxTokens(p.system + p.user) + IMAGE_TOKENS * (p.images?.length ?? 0);

export function planPrompt(b: KitSource, intent: PostIntent, brief: Brief) {
  const kit = formatChunks(selectChunks(b.files, "post_generate", intent).chunks);
  const photos = b.photos.map((p, i) => `${i + 1}. ${asData(p.file)}: ${asData(p.alt)}`).join("\n") || "(no photos uploaded)";
  const images: Image[] = b.photos.map((p) => ({ mediaType: p.mediaType, base64: p.base64 }));
  return { ...fillPrompt("plan", CONTENT.prompts.plan, { ...common(b, intent, brief), kit, templates: templatesForPrompt, photos }), images };
}

/** The template and photo a plan settled on. A photo outside the brand's list falls back to the first. */
export function resolvePlan(b: KitSource, plan: Plan): { template: TemplateSpec; photo: string | null; warnings: string[] } {
  let template = findTemplate(templates, plan.template);
  const photos = b.photos;
  if (template.photo === "required" && !photos.length) {
    // No photos to show: use the type-led layout instead of an empty frame.
    template = findTemplate(templates, "type-led");
    return { template, photo: null, warnings: [`Plan picked ${plan.template}, which needs a photo, but none were uploaded; used type-led.`] };
  }
  if (template.photo !== "required") return { template, photo: null, warnings: [] };
  const listed = photos.find((p) => p.file === plan.photo || basename(p.file) === basename(plan.photo));
  if (listed) return { template, photo: listed.file, warnings: [] };
  return { template, photo: photos[0]!.file, warnings: [`Plan picked photo "${plan.photo}", which isn't in the list; used ${photos[0]!.file}.`] };
}

export function writePrompt(b: KitSource, intent: PostIntent, brief: Brief, plan: Plan, photo: string | null) {
  const template = findTemplate(templates, resolvePlan(b, plan).template.id);
  const kit = formatChunks(selectChunks(b.files, "post_generate", intent).chunks);
  return fillPrompt("write", CONTENT.prompts.write, {
    ...common(b, intent, brief),
    kit,
    plan: JSON.stringify({ template: template.id, photo, angle: plan.angle }, null, 2),
    template: JSON.stringify(template, null, 2),
    critique: "",
  });
}

/** Same clean-up the spike does: strip wrapping quotes from a quote, drop slots the template lacks. */
export function cleanWritten(template: TemplateSpec, written: Written): { written: Written; warnings: string[] } {
  const warnings: string[] = [];
  const slots = { ...written.slots };
  if (slots.quote) slots.quote = slots.quote.trim().replace(/^["“”]+|["“”]+$/g, "");
  for (const [k, v] of Object.entries(slots)) {
    if (v && k !== "caption" && !(k in template.slots)) {
      warnings.push(`Filled "${k}", which ${template.id} doesn't have; dropped it.`);
      (slots as Record<string, string | null>)[k] = null;
    }
  }
  return { written: { ...written, slots }, warnings };
}

// ---------- the without-kit version, for live posts ----------

const NO_KIT = "No brand kit is available for this business. Use your own judgment.";
/** The layout a generic post uses for each intent, so the baseline needs no plan call. */
export const BASELINE_TEMPLATE: Record<PostIntent, TemplateSpec["id"]> = {
  promo: "offer-badge",
  announcement: "photo-led",
  event: "event-card",
  testimonial: "quote-card",
  tip: "type-led",
};

/** The same brief written with no kit: a fixed layout per intent, the kit post's photo, no angle. */
export function baselinePrompt(b: KitSource, intent: PostIntent, brief: Brief, photo: string | null) {
  let template = findTemplate(templates, BASELINE_TEMPLATE[intent]);
  if (template.photo === "required" && !photo) template = findTemplate(templates, "type-led");
  const usePhoto = template.photo === "required" ? photo : null;
  const prompt = fillPrompt("write", CONTENT.prompts.write, {
    ...common(b, intent, brief),
    kit: NO_KIT,
    plan: JSON.stringify({ template: template.id, photo: usePhoto, angle: "Write what the brief asks for." }, null, 2),
    template: JSON.stringify(template, null, 2),
    critique: "",
  });
  return { prompt, template, photo: usePhoto };
}
