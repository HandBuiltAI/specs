// Checks that the compose-bold toolkit recipes pass the code checks and the render probe, using
// one hand-built composition (written by Claude in the spike thread, not a model run).
// Usage: npx tsx spike/toolkit-check.ts  →  output/toolkit-check.png
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildComposedPage, LAYOUT_PROBE, TEXT_SLOTS, type TextSlot } from "../core/compose.ts";
import { checkBold, fillEchoes, relevantIssues } from "./lib/bold.ts";
import { brandDir, kitDir, OUTPUT_DIR, ROOT } from "./lib/paths.ts";

const brand = "third-shift-slice";
const slots = Object.fromEntries(TEXT_SLOTS.map((s) => [s, null])) as Record<TextSlot, string | null>;
Object.assign(slots, { badge: "$3", headline: "slices", subhead: "from 3am - 3:30am!" });

const html = `
<img data-slot="photo" class="ph">
<div class="grade" aria-hidden="true"></div>
<div class="grain" aria-hidden="true"></div>
<div class="ghost" data-echo="badge" aria-hidden="true"></div>
<div data-slot="wordmark" class="logo"></div>
<div class="paint">
  <div class="stroke s1"><span data-slot="badge"></span><span data-slot="headline"></span></div>
  <div class="swash" aria-hidden="true"></div>
  <div class="stroke s2"><p data-slot="subhead"></p></div>
</div>`;
const css = `
.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:62% 40%;filter:contrast(1.25) saturate(1.3) brightness(.85)}
.grade{position:absolute;inset:0;background:linear-gradient(105deg,var(--role-background) 0%,color-mix(in srgb,var(--role-background) 70%,transparent) 38%,transparent 62%)}
.grain{position:absolute;inset:0;background-image:radial-gradient(color-mix(in srgb,var(--color-paper) 16%,transparent) 1px,transparent 1.6px);background-size:5px 5px;mix-blend-mode:overlay}
.ghost{position:absolute;left:-60px;bottom:-140px;font-family:var(--font-heading);font-size:900px;line-height:.8;color:transparent;-webkit-text-stroke:3px color-mix(in srgb,var(--color-paint) 35%,transparent);rotate:-8deg}
.logo{position:absolute;left:56px;top:56px;width:340px;--logo-height:250px;filter:drop-shadow(0 0 10px var(--role-accent)) drop-shadow(0 0 30px color-mix(in srgb,var(--role-accent) 70%,transparent))}
.paint{position:absolute;left:52px;top:440px;rotate:-4deg}
.stroke{background-color:var(--color-paint);color:var(--color-night);padding:10px 40px 18px 34px;width:max-content;
 background-image:repeating-linear-gradient(176deg,color-mix(in srgb,var(--color-paper) 22%,transparent) 0 2px,transparent 2px 9px),repeating-linear-gradient(4deg,color-mix(in srgb,var(--role-background) 10%,transparent) 0 1px,transparent 1px 13px);
 clip-path:polygon(2% 8%,9% 0,30% 4%,52% 0,74% 5%,97% 1%,100% 22%,98% 52%,100% 84%,95% 100%,70% 96%,44% 100%,18% 95%,3% 100%,0 78%,2% 46%,0 20%)}
.s1{display:flex;align-items:baseline;gap:22px}
.s1 [data-slot=badge]{font-family:var(--font-heading);font-size:300px;line-height:.92}
.s1 [data-slot=headline]{font-family:var(--font-heading);font-size:150px;line-height:.92;text-transform:uppercase}
.swash{height:16px;width:520px;margin:6px 0 10px 120px;background:var(--role-accent);border-radius:50% 40% 60% 45%/60% 50% 70% 40%;rotate:-2deg;box-shadow:0 0 18px var(--role-accent)}
.s2{margin-left:24px}
.s2 p{margin:0;font-family:var(--font-heading);font-size:96px;line-height:1;text-transform:uppercase}
`;
const check = checkBold({ html, css }, slots, true);
console.log("code check:", check.ok ? "passed" : check.errors);
mkdirSync(OUTPUT_DIR, { recursive: true });
const file = join(OUTPUT_DIR, "toolkit-check.html");
const r = (p: string) => relative(OUTPUT_DIR, p).split("\\").join("/");
writeFileSync(file, buildComposedPage({
  composition: { html: fillEchoes(html, slots), css }, slots, aspect: "4:5",
  tokensCss: readFileSync(join(kitDir(brand), "tokens.css"), "utf8"), fontsHref: r(join(ROOT, "assets", "fonts", "fonts.css")),
  wordmarkLines: ["THIRD SHIFT", "SLICE"], logoSrc: r(join(brandDir(brand), "logo.png")),
  photo: { src: r(join(brandDir(brand), "uploads/photo-02-cheese-pull.jpg")), alt: "" },
}));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
console.log("probe:", relevantIssues(await page.evaluate(LAYOUT_PROBE) as any, true));
await page.locator(".post").screenshot({ path: file.replace(/\.html$/, ".png") });
await browser.close();
