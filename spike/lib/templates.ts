// Loads the template manifest and fills a template's slots into a finished HTML page.
import { readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { ROOT, TEMPLATES_DIR, kitDir } from "./paths.ts";

export type SlotSpec = { max_chars: number; required: boolean; note?: string };
export type TemplateSpec = {
  id: string;
  name: string;
  aspect: "1:1" | "4:5";
  photo: "required" | "none";
  best_for: string[];
  description: string;
  slots: Record<string, SlotSpec>;
};

export const TEMPLATE_IDS = ["photo-led", "type-led", "quote-card", "split", "offer-badge", "event-card"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function loadTemplates(): TemplateSpec[] {
  const manifest = JSON.parse(readFileSync(join(TEMPLATES_DIR, "templates.json"), "utf8")) as { templates: TemplateSpec[] };
  return manifest.templates;
}

export function getTemplate(id: string): TemplateSpec {
  const t = loadTemplates().find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template "${id}"`);
  return t;
}

export const canvasSize = (t: TemplateSpec) => ({ width: 1080, height: t.aspect === "4:5" ? 1350 : 1080 });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Minimal mustache: {{x}} escaped, {{{x}}} raw, {{#x}}...{{/x}} shown only when x is non-empty. */
export function fill(html: string, values: Record<string, string | undefined>): string {
  let out = html.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key: string, inner: string) =>
    values[key] && values[key]!.trim() ? inner : "",
  );
  out = out.replace(/\{\{\{(\w+)\}\}\}/g, (_, key: string) => values[key] ?? "");
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeHtml(values[key] ?? ""));
  return out;
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
