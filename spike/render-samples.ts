// Renders every template with hand-written sample copy, in the brand look and the
// neutral no-kit look, so layouts can be checked without any API calls.
// Usage: npm run samples -- half-acre-club
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brandDir, OUTPUT_DIR } from "./lib/paths.ts";
import { buildPostHtml, canvasSize, getTemplate, TEMPLATE_IDS, type Look } from "./lib/templates.ts";
import { wordmarkLines } from "./lib/kit.ts";
import { renderAll, type RenderJob } from "./lib/render.ts";

const brand = process.argv[2] ?? "half-acre-club";

// Lines taken from voice-examples, so the samples show the kit's own voice.
const samples: Record<string, { photo?: string; slots: Record<string, string> }> = {
  "photo-led": { photo: "photo-02-day-six-sill.jpg", slots: { headline: "Box 01: pea shoots.", subhead: "Ten days from soil to first cut. Ships the first week of the month.", badge: "Day 6" } },
  "type-led": { slots: { headline: "Wet like a wrung-out sponge.", subhead: "Not dripping, not dry. Press the soil; if water pools, wait a day.", badge: "not soggy" } },
  "quote-card": { slots: { quote: "I've killed two basil plants. These ended up on my eggs.", attribution: "Maya, Box 01 member", badge: "Box 01" } },
  split: { photo: "photo-03-first-cut.jpg", slots: { headline: "Cut a handful.", subhead: "Kitchen scissors, a small plate, around day ten. Put them on toast.", cta: "Get Box 01" } },
  "offer-badge": { photo: "photo-02-day-six-sill.jpg", slots: { headline: "One windowsill. One project a month.", subhead: "Everything in the box, cancel anytime.", badge: "$24/mo", cta: "Join the club" } },
  "event-card": { slots: { headline: "First Cut, Live.", date: "Thursday, Nov 20", details: "7pm ET on Instagram Live", subhead: "Dana cuts this month's tray and answers your questions.", cta: "Set a reminder" } },
};

const outDir = join(OUTPUT_DIR, "samples");
mkdirSync(outDir, { recursive: true });
const looks: { name: string; look: Look }[] = [
  { name: "kit", look: { kind: "brand", brand, wordmarkLines: wordmarkLines(brand) } },
  { name: "neutral", look: { kind: "neutral", businessName: "Half Acre Club" } },
];

const jobs: RenderJob[] = [];
for (const id of TEMPLATE_IDS) {
  const t = getTemplate(id);
  const sample = samples[id]!;
  for (const { name, look } of looks) {
    const htmlFile = join(outDir, `${id}--${name}.html`);
    const html = buildPostHtml({
      templateId: id,
      slots: sample.slots,
      photoPath: sample.photo ? join(brandDir(brand), "uploads", sample.photo) : undefined,
      look,
      outFile: htmlFile,
    });
    writeFileSync(htmlFile, html);
    jobs.push({ htmlFile, pngFile: htmlFile.replace(/\.html$/, ".png"), ...canvasSize(t) });
  }
}

const overflow = await renderAll(jobs);
for (const [file, spills] of overflow) if (spills.length) console.warn(`Overflow in ${file}:`, spills);
console.log(`Rendered ${jobs.length} samples to ${outDir}`);
