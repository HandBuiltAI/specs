// Template manifest types and the slot filler. Pure: no file access, so the spike scripts
// and the app's server share it.

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

export function parseTemplates(manifestJson: string): TemplateSpec[] {
  return (JSON.parse(manifestJson) as { templates: TemplateSpec[] }).templates;
}

export function findTemplate(templates: TemplateSpec[], id: string): TemplateSpec {
  const t = templates.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template "${id}"`);
  return t;
}

export const canvasSize = (t: TemplateSpec) => ({ width: 1080, height: t.aspect === "4:5" ? 1350 : 1080 });

export const escapeHtml = (s: string) =>
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
