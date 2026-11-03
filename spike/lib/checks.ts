// Deterministic checks run on every post before the critique sees it. The critique model
// is told to trust these counts over its own.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { kitDir } from "./paths.ts";
import type { TemplateSpec } from "./templates.ts";
import type { Slots } from "./schemas.ts";
import type { OverflowReport } from "./render.ts";

export type Check = { ok: boolean; check: string; detail: string };

function avoidTerms(brand: string | null): string[] {
  if (!brand) return [];
  const file = join(kitDir(brand), "terminology.yaml");
  if (!existsSync(file)) return [];
  const docs = YAML.parseAllDocuments(readFileSync(file, "utf8")).map((d) => d.toJS());
  const body = docs.find((d) => d && d.avoid) as { avoid?: { term: string | string[] }[] } | undefined;
  return (body?.avoid ?? []).flatMap((a) => (Array.isArray(a.term) ? a.term : [a.term]));
}

/** The exact quote a brief asks for, if any: the text in double quotes after "use exactly". */
export function requiredQuote(details: string): string | null {
  const m = details.match(/use exactly\)?:?\s*[“"](.+?)[”"]/i);
  return m?.[1] ?? null;
}

export function runChecks(opts: {
  slots: Slots;
  template: TemplateSpec;
  brand: string | null;
  details: string;
  overflow: OverflowReport;
}): Check[] {
  const { slots, template } = opts;
  const out: Check[] = [];
  const all = Object.entries(slots).filter(([, v]) => v) as [string, string][];

  for (const [name, spec] of Object.entries(template.slots)) {
    const value = slots[name as keyof Slots];
    if (!value) {
      out.push({ ok: !spec.required, check: `${name} present`, detail: spec.required ? "required but empty" : "optional, left empty" });
      continue;
    }
    const n = [...value].length;
    out.push({ ok: n <= spec.max_chars, check: `${name} length`, detail: `${n} of ${spec.max_chars} characters` });
  }
  for (const [name] of all) {
    if (!(name in template.slots)) out.push({ ok: false, check: `${name} slot`, detail: `${template.id} has no ${name} slot; it will not render` });
  }

  const onImage = all.filter(([k]) => k !== "caption").map(([, v]) => v).join(" ");
  const bangs = (onImage.match(/!/g) ?? []).length + (slots.caption.match(/!/g) ?? []).length;
  out.push({ ok: bangs <= 1, check: "exclamation marks", detail: `${bangs} in the whole post` });

  const tags = (slots.caption.match(/#\w+/g) ?? []).length;
  out.push({ ok: tags <= 3, check: "hashtags", detail: `${tags} in the caption` });

  const quote = requiredQuote(opts.details);
  if (quote && "quote" in template.slots) {
    out.push({ ok: slots.quote === quote, check: "quote is exact", detail: slots.quote === quote ? "matches the brief" : `brief: "${quote}" / post: "${slots.quote ?? ""}"` });
  }

  const text = all.map(([, v]) => v).join(" \n ").toLowerCase();
  const hits = avoidTerms(opts.brand).filter((t) => new RegExp(`\\b${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
  if (opts.brand) out.push({ ok: hits.length === 0, check: "terms to avoid", detail: hits.length ? `found: ${hits.join(", ")}` : "none found" });

  out.push({
    ok: opts.overflow.length === 0,
    check: "fits the canvas",
    detail: opts.overflow.length ? opts.overflow.map((o) => `${o.selector}: "${o.text}"`).join("; ") : "no text spills off the edge",
  });
  return out;
}

export const formatChecks = (checks: Check[]) => checks.map((c) => `- [${c.ok ? "ok" : "FAIL"}] ${c.check}: ${c.detail}`).join("\n");
