// Phase 6 spike: brand-composed layouts. Takes a brand's packed demo posts (same photo, same
// approved copy), asks the compose step to lay each one out from the kit's layout-system chunk,
// checks the result in code (core/compose.ts), and writes a review page with the template post
// and the composed post side by side. Only the layout changes, so the comparison is fair.
//
// Usage: npm run spike -- spike/compose.ts <brand> [--only brief-id,brief-id]
// Needs brands/<brand>/demo-posts.json (run spike/generate.ts, then spike/pack-demo.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import YAML from "yaml";
import { STEPS } from "../core/config.ts";
import { DemoPostsSchema, type DemoPost } from "../core/demo.ts";
import { ComposeSchema, checkComposition, buildComposedPage, LAYOUT_PROBE, TEXT_SLOTS, type Composition, type ProbeIssue, type TextSlot } from "../core/compose.ts";
import { brandDir, kitDir, OUTPUT_DIR, ROOT } from "./lib/paths.ts";
import { loadChunks, formatChunks, wordmarkLines } from "./lib/kit.ts";
import { loadPrompt } from "./lib/prompts.ts";
import { callStructured, type Image, type Usage } from "./lib/claude.ts";
import { buildPostHtml, getTemplate, canvasSize, type Look } from "./lib/templates.ts";

const args = process.argv.slice(2);
const brand = args.find((a) => !a.startsWith("--"));
if (!brand) throw new Error("Usage: npm run spike -- spike/compose.ts <brand> [--only id,id]");
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1]! : args[args.indexOf(onlyArg) + 1]!).split(",") : null;

const demoFile = join(brandDir(brand), "demo-posts.json");
if (!existsSync(demoFile)) throw new Error(`No ${demoFile}. Run spike/generate.ts ${brand}, then spike/pack-demo.ts on its run.json.`);
const demo = DemoPostsSchema.parse(JSON.parse(readFileSync(demoFile, "utf8")));
const posts = demo.posts.filter((p) => !only || only.includes(p.briefId));
const briefFile = YAML.parse(readFileSync(join(brandDir(brand), "briefs.yaml"), "utf8")) as { business_name: string; photos: { file: string; alt: string }[] };

const chunks = loadChunks(brand);
const KIT_IDS = ["layout-system", "visual-system", "art-direction", "social-rules"];
const missing = KIT_IDS.filter((id) => !chunks.has(id));
if (missing.length) throw new Error(`The ${brand} kit is missing ${missing.join(", ")}.`);
const kitText = formatChunks(KIT_IDS.map((id) => chunks.get(id)!));
const tokensCss = readFileSync(join(kitDir(brand), "tokens.css"), "utf8");
const lockup = wordmarkLines(brand);

const runId = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
const runDir = join(OUTPUT_DIR, `compose-${runId}`);
mkdirSync(join(runDir, "posts"), { recursive: true });
const rel = (abs: string) => relative(join(runDir, "posts"), abs).split("\\").join("/");
const fontsHref = rel(join(ROOT, "assets", "fonts", "fonts.css"));

type Attempt = { composition: Composition; codeErrors: string[]; probe: ProbeIssue[]; png?: string };
type Result = { briefId: string; intent: string; goal: string; templatePng: string; composedPng: string | null; usedFallback: boolean; attempts: Attempt[]; usage: Usage[]; seconds: number; error?: string };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function shoot(htmlFile: string, pngFile: string, aspect: "1:1" | "4:5", probe: boolean): Promise<ProbeIssue[]> {
  const page = await browser.newPage({ viewport: { width: 1080, height: aspect === "4:5" ? 1350 : 1080 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const issues = probe ? ((await page.evaluate(LAYOUT_PROBE)) as ProbeIssue[]) : [];
    await page.locator(".post").screenshot({ path: pngFile });
    return issues;
  } finally {
    await page.close();
  }
}

async function composeOne(p: DemoPost): Promise<Result> {
  const started = Date.now();
  const usage: Usage[] = [];
  const t = getTemplate(p.kit.template);
  const aspect = t.aspect as "1:1" | "4:5";
  const photoFile = p.kit.photo;
  const photoAbs = photoFile ? join(brandDir(brand!), photoFile) : null;
  const alt = briefFile.photos.find((x) => x.file === photoFile)?.alt.trim() ?? "";
  const slots = Object.fromEntries(TEXT_SLOTS.map((s) => [s, p.kit.slots[s] ?? null])) as Record<TextSlot, string | null>;

  // The template version, for the side-by-side.
  const tHtml = join(runDir, "posts", `${p.briefId}--template.html`);
  const look: Look = { kind: "brand", brand: brand!, wordmarkLines: lockup };
  writeFileSync(tHtml, buildPostHtml({ templateId: t.id, slots: Object.fromEntries(Object.entries(p.kit.slots).map(([k, v]) => [k, v ?? undefined])), photoPath: photoAbs ?? undefined, look, outFile: tHtml }));
  await shoot(tHtml, tHtml.replace(/\.html$/, ".png"), aspect, false);

  const copy = TEXT_SLOTS.filter((s) => slots[s]).map((s) => `${s}: "${slots[s]}" (${slots[s]!.length} characters)`).join("\n");
  const size = canvasSize(t);
  const images: Image[] = photoAbs ? [{ mediaType: "image/jpeg", base64: readFileSync(photoAbs).toString("base64") }] : [];
  const attempts: Attempt[] = [];
  let composedPng: string | null = null;

  for (let n = 1; n <= 2; n++) {
    const last = attempts.at(-1);
    const feedback = last
      ? `<previous_attempt_sent_back>\nYour previous HTML:\n${last.composition.html}\n\nYour previous CSS:\n${last.composition.css}\n\nProblems found by code:\n${[...last.codeErrors, ...last.probe.map((i) => `${i.slot}: ${i.problem}`)].map((e) => `- ${e}`).join("\n")}\n</previous_attempt_sent_back>`
      : "";
    const prompt = loadPrompt("compose", {
      kit: kitText,
      tokens: tokensCss,
      business_name: briefFile.business_name,
      intent: p.intent,
      goal: p.goal,
      angle: p.kit.notes.find((x) => /angle/i.test(x.decision))?.reason ?? "(see the copy)",
      canvas: `${size.width} × ${size.height} px (${aspect}). The brand's safe margin is var(--safe-margin).`,
      copy,
      photo: photoAbs ? `Attached above. ${alt}` : "None. This post has no photo; don't include a photo slot.",
      feedback,
    });
    const out = await callStructured({ step: "compose", ...prompt, images, schema: ComposeSchema });
    usage.push(out.usage);
    const check = checkComposition(out.data, slots, Boolean(photoAbs));
    const attempt: Attempt = { composition: out.data, codeErrors: check.errors, probe: [] };
    attempts.push(attempt);
    if (!check.ok) continue;
    const cHtml = join(runDir, "posts", `${p.briefId}--composed-${n}.html`);
    writeFileSync(
      cHtml,
      buildComposedPage({ composition: out.data, slots, aspect, tokensCss, fontsHref, wordmarkLines: lockup, photo: photoAbs ? { src: rel(photoAbs), alt } : null }),
    );
    const png = cHtml.replace(/\.html$/, ".png");
    attempt.probe = await shoot(cHtml, png, aspect, true);
    attempt.png = `posts/${p.briefId}--composed-${n}.png`;
    if (!attempt.probe.length) {
      composedPng = attempt.png;
      break;
    }
  }
  const usedFallback = composedPng === null;
  return {
    briefId: p.briefId,
    intent: p.intent,
    goal: p.goal,
    templatePng: `posts/${p.briefId}--template.png`,
    composedPng: composedPng ?? attempts.findLast((a) => a.png)?.png ?? null,
    usedFallback,
    attempts,
    usage,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

console.log(`Compose run ${runId}: ${posts.length} post(s) for ${brand}, from ${demo.sourceRun}`);
const results: Result[] = [];
try {
  for (let i = 0; i < posts.length; i += 2) {
    const batch = posts.slice(i, i + 2);
    results.push(
      ...(await Promise.all(
        batch.map(async (p) => {
          try {
            const r = await composeOne(p);
            console.log(`  ${r.usedFallback ? "fallback" : "composed"}: ${p.briefId} (${r.attempts.length} attempt(s), ${r.seconds}s)`);
            return r;
          } catch (err) {
            console.error(`  failed: ${p.briefId}: ${(err as Error).message}`);
            return { briefId: p.briefId, intent: p.intent, goal: p.goal, templatePng: `posts/${p.briefId}--template.png`, composedPng: null, usedFallback: true, attempts: [], usage: [], seconds: 0, error: (err as Error).message };
          }
        }),
      )),
    );
  }
} finally {
  await browser.close();
}

const totalUsd = results.flatMap((r) => r.usage).reduce((s, u) => s + u.usd, 0);
writeFileSync(join(runDir, "run.json"), JSON.stringify({ runId, brand, sourceRun: demo.sourceRun, model: STEPS.compose, results, totalUsd }, null, 2));

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cards = results
  .map((r) => {
    const final = r.attempts.at(-1);
    const why = (final?.composition.rationale ?? [])
      .map((x) => `<li><b>${esc(x.decision)}:</b> ${esc(x.choice)}<br><span>${esc(x.reason)}</span> ${x.cites.map((c) => `<code>${esc(c)}</code>`).join(" ")}</li>`)
      .join("");
    const problems = r.attempts
      .map((a, i) => (a.codeErrors.length || a.probe.length ? `<li>Attempt ${i + 1}: ${[...a.codeErrors, ...a.probe.map((x) => `${x.slot}: ${x.problem}`)].map(esc).join("; ")}</li>` : `<li>Attempt ${i + 1}: passed every check</li>`))
      .join("");
    return `<section>
  <h2>${esc(r.intent)} · ${esc(r.goal)}</h2>
  <div class="pair">
    <figure><img src="${r.templatePng}" alt=""><figcaption>Template (today)</figcaption></figure>
    <figure>${r.composedPng ? `<img src="${r.composedPng}" alt="">` : `<div class="none">No composed version</div>`}<figcaption>Composed from the kit${r.usedFallback ? " · <b>failed checks, the app would fall back to the template</b>" : ""}</figcaption></figure>
  </div>
  ${r.error ? `<p class="bad">${esc(r.error)}</p>` : ""}
  <ul class="checks">${problems}</ul>
  <ul class="why">${why}</ul>
  <p class="meta">${r.attempts.length} call(s), ${r.seconds}s, $${r.usage.reduce((s, u) => s + u.usd, 0).toFixed(3)}</p>
</section>`;
  })
  .join("\n");
writeFileSync(
  join(runDir, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><title>Composed layouts · ${esc(brand)}</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:32px;background:#ececea;color:#111}h1{font-size:28px}h2{font-size:17px;margin:0 0 12px}
section{background:#fff;border-radius:20px;padding:24px;margin:0 0 24px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}
figure{margin:0}figure img{width:100%;display:block;border-radius:8px}figcaption{font-size:13px;color:#555;margin-top:6px}
.none{aspect-ratio:1;display:grid;place-items:center;background:#eee;border-radius:8px;color:#888}.why li{margin-bottom:6px}.why span{color:#555}
code{font-size:12px;background:#f1f1ef;padding:1px 5px;border-radius:4px}.checks{font-size:13px;color:#555}.bad{color:#b3261e}.meta{font-size:12px;color:#777}
</style></head><body><h1>${esc(briefFile.business_name)}: template vs composed from the kit</h1>
<p>Same photo, same approved copy. Only the layout changes. Run ${esc(runId)}, model ${esc(STEPS.compose.model)}, total $${totalUsd.toFixed(3)}.</p>
${cards}</body></html>`,
);
console.log(`\nApproximate cost: $${totalUsd.toFixed(3)}`);
console.log(`Review page: ${join(runDir, "index.html")}`);
