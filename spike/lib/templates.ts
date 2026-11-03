// Loads the template manifest from disk and builds a finished post page for the spike.
// Template types and the slot filler live in core/templates.ts, shared with the app.
import { readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { ROOT, TEMPLATES_DIR, kitDir } from "./paths.ts";
import { escapeHtml, fill, findTemplate, parseTemplates, type TemplateSpec } from "../../core/templates.ts";

export { TEMPLATE_IDS, canvasSize, fill } from "../../core/templates.ts";
export type { SlotSpec, TemplateSpec, TemplateId } from "../../core/templates.ts";

export function loadTemplates(): TemplateSpec[] {
  return parseTemplates(readFileSync(join(TEMPLATES_DIR, "templates.json"), "utf8"));
}

export function getTemplate(id: string): TemplateSpec {
  return findTemplate(loadTemplates(), id);
}

export type Look =
  | { kind: "brand"; brand: string; wordmarkLines: string[] }
  | { kind: "neutral"; businessName: string };

/**
 * Builds a post page. `outFile` is where the HTML will be written; asset links are made
 * relative to it so the page opens straight from disk.
 */
export function buildPostHtml(opts: {
  templateId: string;
  slots: Record<string, string | undefined>;
  photoPath?: string; // absolute path to the photo
  look: Look;
  outFile: string;
}): string {
  const template = readFileSync(join(TEMPLATES_DIR, `${opts.templateId}.html`), "utf8");
  const rel = (abs: string) => relative(dirname(opts.outFile), abs).split("\\").join("/");

  const tokensCss =
    opts.look.kind === "brand"
      ? readFileSync(join(kitDir(opts.look.brand), "tokens.css"), "utf8")
      : readFileSync(join(TEMPLATES_DIR, "neutral-tokens.css"), "utf8");
  const fontLink =
    opts.look.kind === "brand" ? `<link rel="stylesheet" href="${rel(join(ROOT, "assets", "fonts", "fonts.css"))}">` : "";
  const head = `${fontLink}<style>${tokensCss}</style><link rel="stylesheet" href="${rel(join(TEMPLATES_DIR, "base.css"))}">`;

  const lines = opts.look.kind === "brand" ? opts.look.wordmarkLines : [opts.look.businessName];
  const wordmark = lines.map((l) => `<span>${escapeHtml(l)}</span>`).join("");

  return fill(template, {
    ...opts.slots,
    head,
    wordmark,
    photo_src: opts.photoPath ? rel(opts.photoPath) : "",
  });
}
