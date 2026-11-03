// Builds every prompt the app sends, from the bundled prompts/ files, the demo kit and the
// visitor's structured brief. The browser never supplies prompt text: free-typed fields enter
// only as escaped data inside the prompt's <brief> block.
import "server-only";
import { basename } from "node:path";
import { CONTENT, type DemoBrandId } from "./generated/content.ts";
import { fillPrompt } from "../core/prompts.ts";
import { selectChunks, formatChunks, approxTokens } from "../core/kit.ts";
import { findTemplate, parseTemplates, type TemplateSpec } from "../core/templates.ts";
import type { Image } from "../core/claude.ts";
import type { Plan, Written } from "../core/schemas.ts";
import type { PostIntent } from "../core/limits.ts";

export type Brief = { goal: string; details: string };

const templates = parseTemplates(CONTENT.templatesManifest);
const templatesForPrompt = JSON.stringify(templates, null, 2);

/**
 * Free text as data: drops control characters and swaps angle brackets for look-alikes, so a
 * visitor can't close the prompt's <brief> tag or open a tag of their own.
 */
export function asData(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .trim();
}

function common(brand: DemoBrandId, intent: PostIntent, brief: Brief) {
  const b = CONTENT.brands[brand];
  return {
    business_name: b.businessName,
    business_line: b.businessLine,
    intent,
    goal: asData(brief.goal),
    details: asData(brief.details),
  };
}

const IMAGE_TOKENS = 1600; // About what one ~1,000px photo costs as input.

export const estimateInputTokens = (p: { system: string; user: string; images?: Image[] }) =>
  approxTokens(p.system + p.user) + IMAGE_TOKENS * (p.images?.length ?? 0);

export function planPrompt(brand: DemoBrandId, intent: PostIntent, brief: Brief) {
  const b = CONTENT.brands[brand];
  const kit = formatChunks(selectChunks(b.kit, "post_generate", intent).chunks);
  const photos = b.photos.map((p, i) => `${i + 1}. ${p.file}: ${p.alt}`).join("\n");
  const images: Image[] = b.photos.map((p) => ({ mediaType: p.mediaType, base64: p.base64 }));
  return { ...fillPrompt("plan", CONTENT.prompts.plan, { ...common(brand, intent, brief), kit, templates: templatesForPrompt, photos }), images };
}

/** The template and photo a plan settled on. A photo outside the brand's list falls back to the first. */
export function resolvePlan(brand: DemoBrandId, plan: Plan): { template: TemplateSpec; photo: string | null; warnings: string[] } {
  const template = findTemplate(templates, plan.template);
  if (template.photo !== "required") return { template, photo: null, warnings: [] };
  const photos = CONTENT.brands[brand].photos;
  const listed = photos.find((p) => p.file === plan.photo || basename(p.file) === basename(plan.photo));
  if (listed) return { template, photo: listed.file, warnings: [] };
  return { template, photo: photos[0]!.file, warnings: [`Plan picked photo "${plan.photo}", which isn't in the list; used ${photos[0]!.file}.`] };
}

export function writePrompt(brand: DemoBrandId, intent: PostIntent, brief: Brief, plan: Plan, photo: string | null) {
  const b = CONTENT.brands[brand];
  const template = findTemplate(templates, plan.template);
  const kit = formatChunks(selectChunks(b.kit, "post_generate", intent).chunks);
  return fillPrompt("write", CONTENT.prompts.write, {
    ...common(brand, intent, brief),
    kit,
    plan: JSON.stringify({ template: plan.template, photo, angle: plan.angle }, null, 2),
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
