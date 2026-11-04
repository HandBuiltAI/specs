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

type Sample = { photo?: string; slots: Record<string, string> };
// Lines taken from each brand's voice-examples, so the samples show the kit's own voice.
const SAMPLES: Record<string, { name: string; samples: Record<string, Sample> }> = {
  "half-acre-club": {
    name: "Half Acre Club",
    samples: {
      "photo-led": { photo: "photo-02-day-six-sill.jpg", slots: { headline: "Box 01: pea shoots.", subhead: "Ten days from soil to first cut. Ships the first week of the month.", badge: "Day 6" } },
      "type-led": { slots: { headline: "Wet like a wrung-out sponge.", subhead: "Not dripping, not dry. Press the soil; if water pools, wait a day.", badge: "not soggy" } },
      "quote-card": { slots: { quote: "I've killed two basil plants. These ended up on my eggs.", attribution: "Maya, Box 01 member", badge: "Box 01" } },
      split: { photo: "photo-03-first-cut.jpg", slots: { headline: "Cut a handful.", subhead: "Kitchen scissors, a small plate, around day ten. Put them on toast.", cta: "Get Box 01" } },
      "offer-badge": { photo: "photo-02-day-six-sill.jpg", slots: { headline: "One windowsill. One project a month.", subhead: "Everything in the box, cancel anytime.", badge: "$24/mo", cta: "Join the club" } },
      "event-card": { slots: { headline: "First Cut, Live.", date: "Thursday, Nov 20", details: "7pm ET on Instagram Live", subhead: "Dana cuts this month's tray and answers your questions.", cta: "Set a reminder" } },
    },
  },
  "third-shift-slice": {
    name: "Third Shift Slice",
    samples: {
      "photo-led": { photo: "photo-02-cheese-pull.jpg", slots: { headline: "HOT SLICE. 2:47AM.", subhead: "Cheese $4. Pepperoni $5. Window's open till 3.", badge: "$4" } },
      "type-led": { slots: { headline: "FOLD IT.", subhead: "One hand for the slice, one for your keys.", badge: "till 3am" } },
      "quote-card": { slots: { quote: "I get off at 2:30. This is the only light on the street.", attribution: "Renee, ER nurse", badge: "2:47am" } },
      split: { photo: "photo-01-window-at-night.jpg", slots: { headline: "OFF AT 2:30? WE'RE OPEN TILL 3.", subhead: "Cheese $4. Pepperoni $5. Walk up.", cta: "Window's open." } },
      "offer-badge": { photo: "photo-03-till-3am-sign.jpg", slots: { headline: "OPEN TILL 3AM. WED–SUN.", subhead: "Three slices. Cash and card. No phone, no wait.", badge: "$4", cta: "Walk up." } },
      "event-card": { slots: { headline: "SHIFT CHANGE NIGHT.", date: "Saturday, Nov 22", details: "9pm to 3am, at the window", subhead: "Show a hospital badge, first cheese slice is on us.", cta: "Window's open." } },
    },
  },
  "hollis-ware": {
    name: "Hollis Ware",
    samples: {
      "photo-led": { photo: "photo-01-plates-by-window.jpg", slots: { headline: "Batch 07. Forty pieces.", subhead: "Oat speckle. Online Sunday, 9am Eastern. No restocks.", badge: "07 · 40" } },
      "type-led": { slots: { headline: "Let it cool first.", subhead: "Fridge to hot oven is the one thing stoneware minds.", badge: "care" } },
      "quote-card": { slots: { quote: "I bought it for the shelf. It hasn't been on the shelf since.", attribution: "Ines, Batch 05 cup", badge: "05" } },
      split: { photo: "photo-03-batch-tag.jpg", slots: { headline: "One cup. One of forty.", subhead: "Stoneware · dishwasher safe · $38", cta: "Online Sunday." } },
      "offer-badge": { photo: "photo-03-batch-tag.jpg", slots: { headline: "One cup. One of forty.", subhead: "Stoneware, dishwasher safe. Online Sunday.", badge: "$38", cta: "Online Sunday." } },
      "event-card": { slots: { headline: "Open studio.", date: "Saturday, Dec 6", details: "10am to 2pm, Portland", subhead: "June will be trimming Batch 08 cups.", cta: "Come by." } },
    },
  },
};
const entry = SAMPLES[brand];
if (!entry) throw new Error(`No sample copy for "${brand}". Add it to SAMPLES in spike/render-samples.ts.`);
const samples = entry.samples;

const outDir = join(OUTPUT_DIR, "samples");
mkdirSync(outDir, { recursive: true });
const looks: { name: string; look: Look }[] = [
  { name: "kit", look: { kind: "brand", brand, wordmarkLines: wordmarkLines(brand) } },
  { name: "neutral", look: { kind: "neutral", businessName: entry.name } },
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
