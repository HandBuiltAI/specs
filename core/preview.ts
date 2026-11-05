// What the build screen shows of a kit while it's being made, at no API cost: the Brand DNA
// board (the brand at a glance, not the item list) and the live post that each intake answer
// changes. Pure: built from the drafted chunks in the browser.
import { businessNameOf, kitFromChunks } from "./session-kit.ts";
import type { IntakeChunks, IntakeItem } from "./intake.ts";
import type { ExtractChunkId } from "./extract.ts";

const items = (chunks: IntakeChunks, id: ExtractChunkId): IntakeItem[] => chunks[id]?.draft.items ?? [];
const starts = (item: IntakeItem, ...prefixes: string[]) => prefixes.some((p) => item.label.toLowerCase().startsWith(p));
const firstLine = (s: string) => s.split(/\n/)[0]!.replace(/^["“'‘]|["”'’]$/g, "").trim();
/** The owner's answers win, then the newest item: intake appends answers at the end. */
const best = (list: IntakeItem[]) => [...list].sort((a, b) => Number(b.sources.some((s) => s.upload === "owner")) - Number(a.sources.some((s) => s.upload === "owner"))).at(0);

export type Board = {
  name: string | null;
  palette: { role: string; hex: string }[] | null;
  fonts: { heading: string; body: string; standIn: boolean } | null;
  voice: { tone: string | null; line: string | null } | null;
  facts: { label: string; value: string; source: string }[] | null;
  never: string[] | null;
};

/** The brand at a glance. A field is null until its chunk has been drafted. */
export function boardFrom(chunks: IntakeChunks): Board {
  const kit = chunks["visual-system"] ? kitFromChunks(chunks, { name: businessNameOf(chunks) ?? "Your brand" }) : null;
  const palette = kit
    ? [
        { role: "Background", hex: kit.colors.background },
        { role: "Text", hex: kit.colors.text },
        { role: "Headings", hex: kit.colors.heading },
        { role: "Accent", hex: kit.colors.accent },
        ...(kit.colors.accent2 ? [{ role: "Accent 2", hex: kit.colors.accent2 }] : []),
      ].filter((c, i, all) => all.findIndex((x) => x.hex === c.hex) === i)
    : null;
  const voiceCore = items(chunks, "voice-core");
  const lines = items(chunks, "voice-examples").filter((i) => starts(i, "approved_line", "line", "example"));
  const tone = best(voiceCore.filter((i) => starts(i, "tone")))?.value ?? voiceCore[0]?.value ?? null;
  const facts = items(chunks, "positioning-core")
    .filter((i) => starts(i, "fact:", "resolved:") && !starts(i, "fact: business_name", "fact: business name"))
    .slice(0, 5)
    .map((i) => ({ label: i.label.replace(/^(fact|resolved):\s*/i, "").replace(/_/g, " "), value: firstLine(i.value).slice(0, 80), source: i.sources.at(-1)?.upload ?? "" }));
  const never = items(chunks, "guardrails")
    .filter((i) => starts(i, "never_say", "avoid"))
    .flatMap((i) => firstLine(i.value).split(/[,;]| or /))
    .map((s) => s.replace(/^["“'‘\s]+|["”'’.\s]+$/g, ""))
    .filter((s) => s.length > 0 && s.length <= 32)
    .slice(0, 6);
  return {
    name: businessNameOf(chunks),
    palette,
    fonts: kit ? { heading: kit.fonts.heading, body: kit.fonts.body, standIn: kit.notes.some((n) => /stand-in|stands in|closest/i.test(n)) } : null,
    voice: chunks["voice-core"] || chunks["voice-examples"] ? { tone: tone ? firstLine(tone).slice(0, 140) : null, line: lines.length ? firstLine(best(lines)!.value).slice(0, 120) : null } : null,
    facts: chunks["positioning-core"] ? facts : null,
    never: chunks.guardrails ? never : null,
  };
}

export type PreviewSlots = { headline: string; subhead: string; badge: string | null; photo: string | null };

const fit = (s: string | undefined, max: number) => {
  if (!s) return null;
  const t = firstLine(s).replace(/^(Owner wrote|Confirmed|Sounds like us):\s*/i, "").replace(/^["“]|["”]$/g, "");
  return t.length && t.length <= max ? t : null;
};

/**
 * The live post's copy, from the kit as it stands: a line in the brand's voice for the headline,
 * what the business is for the subhead, a price for the badge, and the lead photo. Every word
 * comes from the kit; nothing is written for the preview.
 */
export function previewSlots(chunks: IntakeChunks, photoFiles: string[]): PreviewSlots {
  const examples = items(chunks, "voice-examples").filter((i) => starts(i, "approved_line", "line", "example"));
  const voiceAnswer = items(chunks, "voice-core").filter((i) => i.sources.some((s) => s.upload === "owner") && /"[^"]+"/.test(i.value));
  const quoted = voiceAnswer.at(-1)?.value.match(/"([^"]+)"/)?.[1];
  const ownerLines = examples.filter((i) => i.sources.some((s) => s.upload === "owner")).reverse();
  const pos = items(chunks, "positioning-core");
  const headline =
    fit(quoted, 40) ??
    ownerLines.map((i) => fit(i.value, 40)).find(Boolean) ??
    examples.map((i) => fit(i.value, 40)).find(Boolean) ??
    pos.filter((i) => starts(i, "promise")).map((i) => fit(i.value, 40)).find(Boolean) ??
    businessNameOf(chunks) ??
    "Your brand";
  const subhead =
    [...pos.filter((i) => starts(i, "what_it_is", "promise")), ...items(chunks, "brand-about").filter((i) => starts(i, "description"))]
      .map((i) => fit(i.value, 90))
      .find((s) => s && s !== headline) ?? "";
  // The resolved price (an owner's answer) beats a drafted one.
  const priced = [...pos.filter((i) => starts(i, "resolved:")).reverse(), ...pos.filter((i) => starts(i, "fact:"))];
  const badge = priced.map((i) => i.value.match(/[$£€]\s?\d[\d.,]*/)?.[0]).find(Boolean)?.replace(/\s/g, "") ?? null;
  // The lead photo: one the kit names, else the first upload.
  const art = items(chunks, "art-direction").filter((i) => starts(i, "hero_photos", "strongest_photo", "lead_photo"));
  const left = new Set(art.filter((i) => /^Leave out:/i.test(i.value)).flatMap((i) => photoFiles.filter((f) => i.value.includes(f))));
  const usable = photoFiles.filter((f) => !left.has(f));
  const named = [...art].reverse().filter((i) => !/^Leave out:/i.test(i.value)).map((i) => usable.find((f) => i.value.includes(f))).find(Boolean);
  return { headline, subhead, badge: badge && badge.length <= 12 ? badge : null, photo: named ?? usable[0] ?? null };
}
