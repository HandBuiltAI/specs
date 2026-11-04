// Packs a compose run's layouts into a demo brand's precomputed posts, so the demo pages show
// layouts designed from the kit instead of the shared templates. Free: no API calls.
//
// Each attempt in the run is checked again with today's code check and render probe, and the
// first one that passes is kept, so a probe fix applies to old runs too. A post with no passing
// attempt keeps its template.
//
// Usage: npx tsx spike/pack-compose.ts <output/compose-<run-id>/run.json or folder> [more runs...]
// Later runs win for the briefs they cover.
import { readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { DemoPostsSchema, type Note } from "../core/demo.ts";
import { checkComposition, buildComposedPage, LAYOUT_PROBE, TEXT_SLOTS, type Composition, type ProbeIssue, type TextSlot } from "../core/compose.ts";
import { brandDir, kitDir, OUTPUT_DIR, ROOT } from "./lib/paths.ts";
import { wordmarkLines } from "./lib/kit.ts";
import { getTemplate } from "./lib/templates.ts";

const args = process.argv.slice(2);
if (!args.length) throw new Error("Usage: npx tsx spike/pack-compose.ts <output/compose-<run-id>/run.json> [more...]");

type Run = { runId: string; brand: string; results: { briefId: string; attempts: { composition: Composition }[]; usage: { usd: number }[] }[]; totalUsd: number };
const runs = args.map((a) => JSON.parse(readFileSync(statSync(a).isDirectory() ? join(a, "run.json") : a, "utf8")) as Run);
const brand = runs[0]!.brand;
if (runs.some((r) => r.brand !== brand)) throw new Error("All runs must be for the same brand.");

const demoFile = join(brandDir(brand), "demo-posts.json");
const demo = DemoPostsSchema.parse(JSON.parse(readFileSync(demoFile, "utf8")));
const tokensCss = readFileSync(join(kitDir(brand), "tokens.css"), "utf8");
const lockup = wordmarkLines(brand);
const fontsHref = pathToFileURL(join(ROOT, "assets", "fonts", "fonts.css")).href;
const scratch = join(OUTPUT_DIR, "tmp");
mkdirSync(scratch, { recursive: true });

// Notes about the layout come from the composition now; keep the draft's notes on the copy.
const LAYOUT_NOTE = /template|layout|composition|photo|image|crop/i;
const RETRY_NOTE = /^(fix|fixes|fix from|previous|retry)/i;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let packed = 0;
try {
  for (const post of demo.posts) {
    const sources = runs.flatMap((run) => run.results.filter((r) => r.briefId === post.briefId).map((r) => ({ run, r }))).reverse();
    if (!sources.length) continue;
    const slots = Object.fromEntries(TEXT_SLOTS.map((s) => [s, post.kit.slots[s] ?? null])) as Record<TextSlot, string | null>;
    const aspect = getTemplate(post.kit.template).aspect as "1:1" | "4:5";
    const photo = post.kit.photo ? { src: pathToFileURL(join(brandDir(brand), post.kit.photo)).href, alt: "" } : null;
    let kept: { composition: Composition; runId: string } | null = null;
    const why: string[] = [];
    for (const { run, r } of sources) {
      for (const [i, a] of r.attempts.entries()) {
        const check = checkComposition(a.composition, slots, Boolean(photo));
        let issues: string[] = check.errors;
        if (check.ok) {
          const file = join(scratch, `pack-${post.briefId}.html`);
          writeFileSync(file, buildComposedPage({ composition: a.composition, slots, aspect, tokensCss, fontsHref, wordmarkLines: lockup, photo }));
          const page = await browser.newPage({ viewport: { width: 1080, height: aspect === "4:5" ? 1350 : 1080 } });
          try {
            await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
            await page.evaluate(() => document.fonts.ready);
            issues = ((await page.evaluate(LAYOUT_PROBE)) as ProbeIssue[]).map((x) => `${x.slot}: ${x.problem}`);
          } finally {
            await page.close();
          }
        }
        if (!issues.length) {
          kept = { composition: a.composition, runId: run.runId };
          break;
        }
        why.push(`${run.runId} attempt ${i + 1}: ${issues.join("; ")}`);
      }
      if (kept) break;
    }
    if (!kept) {
      delete post.kit.composed;
      console.log(`  template: ${post.briefId}\n    ${why.join("\n    ")}`);
      continue;
    }
    const layoutNotes: Note[] = kept.composition.rationale.filter((n) => !RETRY_NOTE.test(n.decision.trim()));
    const copyNotes = post.kit.notes.filter((n) => !LAYOUT_NOTE.test(n.decision));
    post.kit.composed = { html: kept.composition.html, css: kept.composition.css, rationale: [...layoutNotes, ...copyNotes], sourceRun: kept.runId };
    packed++;
    console.log(`  composed: ${post.briefId} (from ${kept.runId})`);
  }
} finally {
  await browser.close();
}

const out = DemoPostsSchema.parse({
  ...demo,
  composeCostUsd: Math.round(runs.reduce((s, r) => s + r.totalUsd, 0) * 100) / 100,
});
writeFileSync(demoFile, JSON.stringify(out, null, 2) + "\n");
console.log(`Packed ${packed} of ${demo.posts.length} composed layout(s) into ${demoFile}`);
