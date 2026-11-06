// Image-model spike (Nov 6). Does an image model make Specs posts bolder? The "concept sketch"
// idea: an image model paints a bold rough of the whole ad from the kit, the copy, the owner's
// photo and the real logo; then Claude rebuilds each sketch in HTML/CSS under the same code
// checks as every Specs post (exact copy, the real logo, kit colors and fonts, the render probe).
// The sketch is never the post: its painted words and redrawn logo are thrown away.
//
// One post only (Scott's rule for paid test runs): Third Shift's "$3 slices from 3am - 3:30am!".
//   1. Sketch: SKETCH.takes calls to the image model (prompts/sketch.md), one per take.
//   2. Rebuild: prompts/compose-bold.md plus prompts/rebuild.md, sketch attached (two tries each
//      against the code checks and the render probe).
//   3. Critique, blind: prompts/art-critique.md sees the rebuilds beside today's post and the
//      winner of the last bold run (spike/bold.ts, PR #44), under shuffled numbers.
//   4. Revise the winner once if it's a rebuild and the critic asked for changes.
// Writes output/sketch-<run-id>/index.html and a comparison sheet PNG.
//
// Usage: npm run spike -- spike/sketch.ts [--vs output/bold-<run-id>] [--takes 3]
// Needs ANTHROPIC_API_KEY and GEMINI_API_KEY in .env. Neither is logged.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import YAML from "yaml";
import { STEPS, SKETCH } from "../core/config.ts";
import { ComposeSchema, buildComposedPage, LAYOUT_PROBE, TEXT_SLOTS, type Composition, type ProbeIssue, type TextSlot } from "../core/compose.ts";
import { brandDir, kitDir, OUTPUT_DIR, ROOT } from "./lib/paths.ts";
import { loadChunks, formatChunks, wordmarkLines } from "./lib/kit.ts";
import { loadPrompt } from "./lib/prompts.ts";
import { callStructured, type Image, type Usage } from "./lib/claude.ts";
import { ArtCritiqueSchema, checkBold, fillEchoes, relevantIssues, type ArtCritique } from "../core/bold.ts";
import { paintSketch, SKETCH_WORST_USD } from "../core/sketch.ts";

const BRAND = "third-shift-slice";
const POST_ID = "promo-three-dollar-slices";

const args = process.argv.slice(2);
const argOf = (name: string) => {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return args[i]!.includes("=") ? args[i]!.split("=")[1] : args[i + 1];
};
const takes = Number(argOf("--takes") ?? SKETCH.takes);
const geminiKey = process.env.GEMINI_API_KEY;
if (!geminiKey) throw new Error("GEMINI_API_KEY is missing from .env. See the steps in the thread (Google AI Studio → Get API key).");

// The post, from the bold spike's list, so both spikes use the same copy and photo.
type PostSpec = { brand: string; id?: string; intent?: string; goal?: string; aspect?: "4:5" | "1:1"; photo?: string; reads_as?: string; slots?: Partial<Record<TextSlot, string>> };
const spec = (YAML.parse(readFileSync(join(ROOT, "spike", "bold-posts.yaml"), "utf8")) as { posts: PostSpec[] }).posts.find((p) => p.brand === BRAND && p.id === POST_ID);
if (!spec) throw new Error(`No ${POST_ID} in spike/bold-posts.yaml`);
const blank = Object.fromEntries(TEXT_SLOTS.map((k) => [k, null])) as Record<TextSlot, string | null>;
const post = { intent: spec.intent!, goal: spec.goal!, aspect: (spec.aspect ?? "4:5") as "4:5" | "1:1", photo: spec.photo!, readsAs: spec.reads_as, slots: { ...blank, ...spec.slots } as Record<TextSlot, string | null> };

const runId = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
const runDir = join(OUTPUT_DIR, `sketch-${runId}`);
mkdirSync(join(runDir, "posts"), { recursive: true });
const rel = (abs: string) => relative(join(runDir, "posts"), abs).split("\\").join("/");
const fontsHref = rel(join(ROOT, "assets", "fonts", "fonts.css"));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const usage: Usage[] = [];
const imageCalls: { model: string; usd: number; seconds: number }[] = [];

// Kit, copy, photo, logo: the same inputs spike/bold.ts gives its designer.
const chunks = loadChunks(BRAND);
const pick = (ids: string[]) => formatChunks(ids.filter((id) => chunks.has(id)).map((id) => chunks.get(id)!));
const designKit = pick(["energy", "layout-system", "visual-system", "art-direction", "social-rules"]);
const fullKit = pick(["positioning-core", "energy", "layout-system", "visual-system", "art-direction", "social-rules", "guardrails"]);
const tokensCss = readFileSync(join(kitDir(BRAND), "tokens.css"), "utf8");
const briefs = YAML.parse(readFileSync(join(brandDir(BRAND), "briefs.yaml"), "utf8")) as { business_name: string; photos: { file: string; alt: string }[] };
const lockup = wordmarkLines(BRAND);
const logoAbs = join(brandDir(BRAND), "logo.png");
const photoAbs = join(brandDir(BRAND), post.photo);
const alt = briefs.photos.find((x) => x.file === post.photo)?.alt.trim() ?? "";
const canvas = `${post.aspect === "4:5" ? "1080 × 1350 px (4:5)" : "1080 × 1080 px (1:1)"}. The brand's safe margin is var(--safe-margin).`;
const copyText = TEXT_SLOTS.filter((s) => post.slots[s]).map((s) => `${s}: "${post.slots[s]}" (${post.slots[s]!.length} characters)`).join("\n");
const copy = copyText + (post.readsAs ? `\nReads as: "${post.readsAs}"` : "");
const photoB64 = readFileSync(photoAbs).toString("base64");
const logoB64 = readFileSync(logoAbs).toString("base64");
const photoImg: Image[] = [{ mediaType: "image/jpeg", base64: photoB64 }];
const logoImg: Image[] = [{ mediaType: "image/png", base64: logoB64 }];
const photoLine = `The first image attached. ${alt}`;
const logoLine = "The second image attached: the brand's real logo (transparent PNG), placed by code in the wordmark slot.";
const issueText = (b: { errors: string[]; probe: ProbeIssue[] }) => [...b.errors, ...b.probe.map((i) => `${i.slot}: ${i.problem}`)];

type Built = { label: string; name: string; png: string | null; composition: Composition | null; errors: string[]; probe: ProbeIssue[]; tries: number; sketch?: string };

async function shoot(htmlFile: string, pngFile: string): Promise<ProbeIssue[]> {
  const page = await browser.newPage({ viewport: { width: 1080, height: post.aspect === "4:5" ? 1350 : 1080 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const issues = (await page.evaluate(LAYOUT_PROBE)) as ProbeIssue[];
    await page.locator(".post").screenshot({ path: pngFile });
    return issues;
  } finally {
    await page.close();
  }
}

async function render(c: Pick<Composition, "html" | "css">, name: string, usesPhoto: boolean): Promise<{ png: string; probe: ProbeIssue[] }> {
  const html = join(runDir, "posts", `${name}.html`);
  writeFileSync(
    html,
    buildComposedPage({
      composition: { html: fillEchoes(c.html, post.slots), css: c.css },
      slots: post.slots,
      aspect: post.aspect,
      tokensCss,
      fontsHref,
      wordmarkLines: lockup,
      logoSrc: rel(logoAbs),
      photo: usesPhoto ? { src: rel(photoAbs), alt } : null,
    }),
  );
  const probe = relevantIssues(await shoot(html, html.replace(/\.html$/, ".png")), true);
  return { png: `posts/${name}.png`, probe };
}

// 1. Sketch: core/sketch.ts calls the Gemini API. The key is passed in, never logged.
let sketchModel: string | null = null;
async function sketch(take: number): Promise<{ file: string; jpeg: string; note: string } | { error: string }> {
  const { system, user } = loadPrompt("sketch", { take: String(take), business_name: briefs.business_name, intent: post.intent, goal: post.goal, copy, kit: designKit });
  const r = await paintSketch({ apiKey: geminiKey!, text: `${system}\n\n${user}`, images: [...photoImg, ...logoImg], aspect: post.aspect, model: sketchModel });
  if (!r.ok) {
    if (r.billed && r.model) imageCalls.push({ model: r.model, usd: SKETCH.usdPerImage[r.model] ?? SKETCH_WORST_USD, seconds: 0 });
    return { error: r.error };
  }
  sketchModel = r.model;
  imageCalls.push({ model: r.model, usd: r.usd, seconds: r.seconds });
  const ext = r.mediaType.includes("png") ? "png" : "jpg";
  const file = `posts/sketch-${take}.${ext}`;
  writeFileSync(join(runDir, file), Buffer.from(r.base64, "base64"));
  // A smaller JPEG copy for Claude (images over 5 MB are refused).
  const jpeg = `posts/sketch-${take}-small.jpg`;
  const page = await browser.newPage({ viewport: { width: 1080, height: post.aspect === "4:5" ? 1350 : 1080 } });
  await page.setContent(`<body style="margin:0"><img src="data:${r.mediaType};base64,${r.base64}" style="width:100vw;height:100vh;object-fit:contain;display:block">`);
  await page.screenshot({ path: join(runDir, jpeg), type: "jpeg", quality: 88 });
  await page.close();
  return { file, jpeg, note: "" };
}

// 2. Rebuild: the bold designer's prompt and toolkit, plus the rebuild notes and the sketch.
async function rebuild(take: number, sketchJpeg: string, notes: string[] = [], from?: Built): Promise<Built> {
  const sketchImg: Image[] = [{ mediaType: "image/jpeg", base64: readFileSync(join(runDir, sketchJpeg)).toString("base64") }];
  const extra = loadPrompt("rebuild", {});
  let b: Built = from ? { ...from, tries: 0 } : { label: `S${take}`, name: `Sketch ${take}, rebuilt`, png: null, composition: null, errors: [], probe: [], tries: 0, sketch: sketchJpeg };
  for (let n = 1; n <= 2; n++) {
    const feedback = b.composition
      ? `<previous_attempt_sent_back>\nYour previous HTML:\n${b.composition.html}\n\nYour previous CSS:\n${b.composition.css}\n\n${
          notes.length && n === 1 ? `The creative director picked this post and asks for these changes:\n${notes.map((x) => `- ${x}`).join("\n")}` : `Problems found by code:\n${issueText(b).map((e) => `- ${e}`).join("\n")}`
        }\n</previous_attempt_sent_back>`
      : "";
    const prompt = loadPrompt("compose-bold", { kit: designKit, tokens: tokensCss, business_name: briefs.business_name, intent: post.intent, goal: post.goal, direction: extra.user, canvas, copy, photo: photoLine, logo: logoLine, feedback });
    const out = await callStructured({ step: "compose_bold", system: `${prompt.system}\n\n${extra.system}`, user: prompt.user, images: [...photoImg, ...logoImg, ...sketchImg], schema: ComposeSchema });
    usage.push(out.usage);
    const check = checkBold(out.data, post.slots, true);
    // The rebuild may drop the photo slot if the sketch did; then render without it.
    const usesPhoto = /data-slot=["']?photo/.test(out.data.html);
    const check2 = usesPhoto ? check : checkBold(out.data, post.slots, false);
    b = { ...b, composition: out.data, errors: check2.errors, probe: [], tries: n, png: check2.ok ? null : b.png };
    if (!check2.ok) continue;
    const r = await render(out.data, `sketch-${take}-rebuild${from ? "-revised" : ""}-${n}`, usesPhoto);
    b.png = r.png;
    b.probe = r.probe;
    if (!r.probe.length) break;
  }
  return b;
}

// The comparison: today's post and the winner of the latest bold run (or --vs).
function boldRun(): { dir: string; before: string | null; winner: string | null; winnerName: string } | null {
  const vs = argOf("--vs");
  const dirs = vs ? [join(ROOT, vs)] : existsSync(OUTPUT_DIR) ? readdirSync(OUTPUT_DIR).filter((d) => d.startsWith("bold-")).sort().reverse().map((d) => join(OUTPUT_DIR, d)) : [];
  for (const dir of dirs) {
    const runFile = join(dir, "run.json");
    if (!existsSync(runFile)) continue;
    const run = JSON.parse(readFileSync(runFile, "utf8")) as { results: any[] };
    const r = run.results.find((x) => x.post.brand === BRAND && x.post.id === POST_ID);
    if (!r) continue;
    const w = r.revised?.png ? r.revised : r.built.find((b: any) => b.label === r.winner);
    return { dir, before: r.before?.png ?? null, winner: w?.png ?? (r.winner === "before" ? r.before.png : null), winnerName: w ? `${w.label}. ${w.name}` : "Today's post" };
  }
  return null;
}

console.log(`Sketch run ${runId}: ${BRAND} / ${POST_ID}, ${takes} take(s)`);
const started = Date.now();
const bold = boldRun();
const pool: Built[] = [];
if (bold?.before) {
  copyFileSync(join(bold.dir, bold.before), join(runDir, "posts", "before.png"));
  pool.push({ label: "before", name: "Today's Specs post", png: "posts/before.png", composition: null, errors: [], probe: [], tries: 0 });
}
if (bold?.winner && bold.winner !== bold.before) {
  copyFileSync(join(bold.dir, bold.winner), join(runDir, "posts", "bold-winner.png"));
  pool.push({ label: "bold", name: `Bold spike winner (${bold.winnerName})`, png: "posts/bold-winner.png", composition: null, errors: [], probe: [], tries: 0 });
}
if (!bold) console.log("  No bold run with this post in output/; comparing the rebuilds with each other only.");

let critique: ArtCritique | null = null;
let winner: string | null = null;
let revised: Built | null = null;
const blind: Record<string, string> = {};
const sketches: ({ take: number; file: string; jpeg: string; note: string } | { take: number; error: string })[] = [];
const rebuilt: Built[] = [];
try {
  // Sketches one at a time (the first call settles the model name); rebuilds run side by side.
  for (let t = 1; t <= takes; t++) {
    const s = await sketch(t);
    sketches.push({ take: t, ...s });
    console.log("error" in s ? `  sketch ${t} failed: ${s.error}` : `  sketch ${t}: ${sketchModel}`);
  }
  rebuilt.push(...(await Promise.all(sketches.filter((s): s is { take: number; file: string; jpeg: string; note: string } => "jpeg" in s).map((s) => rebuild(s.take, s.jpeg)))));
  for (const b of rebuilt) console.log(`  ${b.name}: ${b.png && !issueText(b).length ? "passed the checks" : `still flagged: ${issueText(b).join("; ")}`} (${b.tries} tries)`);

  // 3. Critique, blind.
  const judged = [...pool, ...rebuilt.filter((b) => b.png && !issueText(b).length)];
  const order = judged.map((b) => ({ b, k: Math.random() })).sort((x, y) => x.k - y.k).map((x) => x.b);
  order.forEach((b, i) => (blind[String(i + 1)] = b.label));
  if (order.length > 1) {
    const candidates = order.map((_, i) => `Candidate ${i + 1} (image ${i + 1}). Passed every code check.`).join("\n");
    const cPrompt = loadPrompt("art-critique", { kit: fullKit, business_name: briefs.business_name, intent: post.intent, goal: post.goal, copy, candidates });
    const images: Image[] = order.map((b) => ({ mediaType: "image/png", base64: readFileSync(join(runDir, b.png!)).toString("base64") }));
    for (let n = 1; n <= 2; n++) {
      const cOut = await callStructured({ step: "art_critique", ...cPrompt, images, schema: ArtCritiqueSchema });
      usage.push(cOut.usage);
      critique = cOut.data;
      const scored = new Set(critique.candidates.map((c) => c.label.replace(/\D/g, "")));
      if (order.every((_, i) => scored.has(String(i + 1)))) break;
    }
    winner = blind[critique!.winner.replace(/\D/g, "")] ?? null;
    console.log(`  critic picked: ${winner}`);

    // 4. Revise the winner once, if it's a rebuild and the critic asked for changes.
    const w = rebuilt.find((b) => b.label === winner);
    if (w?.sketch && critique!.revision.length) {
      revised = await rebuild(Number(w.label.slice(1)), w.sketch, critique!.revision, w);
      revised.label = `${w.label} revised`;
      if (!revised.png || issueText(revised).length) revised = { ...revised, png: null };
    }
  }

  const claudeUsd = usage.reduce((s, u) => s + u.usd, 0);
  const imageUsd = imageCalls.reduce((s, c) => s + c.usd, 0);
  const seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(join(runDir, "run.json"), JSON.stringify({ runId, sketchModel, models: { compose_bold: STEPS.compose_bold, art_critique: STEPS.art_critique }, bold: bold?.dir ?? null, sketches, rebuilt, pool, critique, blind, winner, revised, imageCalls, usage, claudeUsd, imageUsd, seconds }, null, 2));
  writeFileSync(join(runDir, "index.html"), reviewPage({ claudeUsd, imageUsd, seconds }));
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(runDir, "index.html")).href, { waitUntil: "load" });
  await page.locator(".sheet").first().screenshot({ path: join(runDir, "sheet-posts.png") });
  await page.locator(".sheet").nth(1).screenshot({ path: join(runDir, "sheet-sketches.png") });
  await page.close();
  console.log(`\nApproximate cost: $${(claudeUsd + imageUsd).toFixed(2)} (Claude $${claudeUsd.toFixed(2)}, image model $${imageUsd.toFixed(2)}), ${seconds}s`);
  console.log(`Review page: ${join(runDir, "index.html")}`);
} finally {
  await browser.close();
}

function reviewPage(cost: { claudeUsd: number; imageUsd: number; seconds: number }): string {
  const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const scoreOf = (label: string) => {
    const n = Object.entries(blind).find(([, l]) => l === label)?.[0];
    return critique?.candidates.find((c) => c.label.replace(/\D/g, "") === n);
  };
  const tile = (b: Built, title: string) => {
    const s = b.label.includes("revised") ? undefined : scoreOf(b.label);
    const win = winner === b.label || (revised?.png && b === revised);
    const flags = issueText(b);
    return `<figure class="${win ? "win" : ""}">
      ${b.png ? `<img src="${b.png}" alt="">` : `<div class="none">Didn't pass the checks</div>`}
      <figcaption><b>${esc(title)}</b>${winner === b.label ? ' <span class="pick">Critic\'s pick</span>' : ""}
      ${s ? `<br><span class="sc">idea ${s.idea} · stop ${s.stop} · brand ${s.brand} · legible ${s.legible}</span><br><span class="n">${esc(s.notes)}</span>${s.honesty.length ? `<br><span class="bad">Honesty: ${s.honesty.map(esc).join("; ")}</span>` : ""}` : ""}
      ${flags.length ? `<br><span class="bad">Checks: ${flags.map(esc).join("; ")}</span>` : ""}</figcaption></figure>`;
  };
  const pairs = sketches
    .map((s) => {
      const b = rebuilt.find((x) => x.label === `S${s.take}`);
      if ("error" in s) return `<div class="pair"><div class="none">Sketch ${s.take} failed: ${esc(s.error)}</div></div>`;
      return `<div class="pair"><figure><img src="${s.file}" alt=""><figcaption><b>Sketch ${s.take}</b> (image model, never shown to the owner)</figcaption></figure>${b ? tile(b, `Rebuilt in HTML by Claude`) : ""}</div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Image-model sketch spike</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:32px;background:#ececea;color:#111}h1{font-size:28px}h2{font-size:17px;margin:0 0 14px}
section{background:#fff;border-radius:20px;padding:24px;margin:0 0 28px}.sheet{background:#fff;padding:8px}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;align-items:start}
.pairs{display:grid;grid-template-columns:repeat(auto-fit,minmax(480px,1fr));gap:24px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}
figure{margin:0}figure img{width:100%;display:block;border-radius:6px}figure.win img{outline:4px solid #e5372b;outline-offset:3px}
figcaption{font-size:12.5px;color:#333;margin-top:8px}.n,.meta{color:#666}.sc{font-family:ui-monospace,monospace;font-size:12px}
.pick{background:#e5372b;color:#fff;border-radius:99px;padding:1px 8px;font-size:11px}.none{aspect-ratio:4/5;display:grid;place-items:center;background:#eee;border-radius:6px;color:#888;padding:12px;text-align:center}
.bad{color:#b3261e}
</style></head><body><h1>Image-model concept sketches, rebuilt by Specs</h1>
<p>Third Shift Slice, "${esc(post.readsAs)}". An image model (${esc(sketchModel)}) painted ${takes} rough concepts from the kit, the copy, the owner's photo and the real logo. Claude rebuilt each in HTML under the usual code checks: exact copy, real logo, kit colors and fonts. The critic judged the rebuilds blind, beside today's post and the bold spike's winner. Run ${esc(runId)}.</p>
<section><div class="sheet"><h2>The posts (what the owner would get)</h2><div class="row">
  ${pool.map((b) => tile(b, b.name)).join("")}
  ${rebuilt.map((b) => tile(b, b.name)).join("")}
  ${revised?.png ? tile(revised, `Final: ${winner} revised`) : ""}
</div></div>
${critique ? `<p><b>Why the pick:</b> ${esc(critique.why)}</p>${critique.revision.length ? `<p><b>Revision notes:</b></p><ul>${critique.revision.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${critique.fact_conflicts.length ? `<p class="bad"><b>Copy vs kit:</b> ${critique.fact_conflicts.map(esc).join(" ")}</p>` : ""}` : ""}
</section>
<section><div class="sheet"><h2>Sketch → rebuild</h2><div class="pairs">${pairs}</div></div>
${rebuilt.map((b) => (b.composition ? `<p class="meta"><b>${esc(b.name)}:</b> ${b.composition.rationale.map((r) => esc(`${r.decision}: ${r.choice}`)).join(" · ")}</p>` : "")).join("")}
</section>
<p class="meta">${cost.seconds}s · Claude $${cost.claudeUsd.toFixed(2)} · image model $${cost.imageUsd.toFixed(2)} (${imageCalls.length} images, ${imageCalls.map((c) => `${c.seconds}s`).join(", ")}) · blind labels ${esc(JSON.stringify(blind))}${bold ? ` · compared with ${esc(relative(ROOT, bold.dir))}` : ""}</p>
</body></html>`;
}
