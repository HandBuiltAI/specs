// Bolder posts spike (Nov 6). Scott compared Specs' posts with image-model ads and found ours
// safe. This tests step 1 of the fix, with no image model: an energy level and reference notes in
// each kit (kit/energy.md), a larger CSS toolkit, three directions per post, and a creative
// director that picks the strongest render. Copy, the real logo and the kit's fonts and colors
// stay enforced by code (core/compose.ts, plus echoes in spike/lib/bold.ts).
//
// For each post in spike/bold-posts.yaml:
//   1. "Before": the post as Specs makes it today (the demo's stored composition, or one call
//      to prompts/compose.md for a new post).
//   2. Directions: one call to prompts/directions.md proposes three different ideas.
//   3. Build: prompts/compose-bold.md builds each direction (two tries each against the code
//      checks and the render probe).
//   4. Critique: prompts/art-critique.md sees the renders, including "before", under shuffled
//      labels, scores them and picks one.
//   5. Revise: one more build of the winner with the critic's notes.
// Then writes output/bold-<run-id>/index.html and one comparison sheet PNG per post.
//
// Usage: npm run spike -- spike/bold.ts [brand] [--only post-id,post-id]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import YAML from "yaml";
import { STEPS } from "../core/config.ts";
import { DemoPostsSchema } from "../core/demo.ts";
import { ComposeSchema, checkComposition, buildComposedPage, LAYOUT_PROBE, TEXT_SLOTS, type Composition, type ProbeIssue, type TextSlot } from "../core/compose.ts";
import { brandDir, kitDir, OUTPUT_DIR, ROOT } from "./lib/paths.ts";
import { loadChunks, formatChunks, wordmarkLines } from "./lib/kit.ts";
import { loadPrompt } from "./lib/prompts.ts";
import { callStructured, type Image, type Usage } from "./lib/claude.ts";
import { getTemplate } from "./lib/templates.ts";
import { ArtCritiqueSchema, DirectionsSchema, checkBold, fillEchoes, relevantIssues, type ArtCritique, type Direction } from "./lib/bold.ts";

const args = process.argv.slice(2);
const brandArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1]! : args[args.indexOf(onlyArg) + 1]!).split(",") : null;

type PostSpec = { brand: string; id?: string; demo?: string; intent?: string; goal?: string; angle?: string; aspect?: "1:1" | "4:5"; photo?: string | null; reads_as?: string; slots?: Partial<Record<TextSlot, string>> };
type Post = { brand: string; id: string; intent: string; goal: string; angle: string; aspect: "1:1" | "4:5"; photo: string | null; readsAs?: string; slots: Record<TextSlot, string | null>; stored?: Pick<Composition, "html" | "css" | "rationale"> };

const specs = (YAML.parse(readFileSync(join(ROOT, "spike", "bold-posts.yaml"), "utf8")) as { posts: PostSpec[] }).posts;

function resolvePost(s: PostSpec): Post {
  const blank = Object.fromEntries(TEXT_SLOTS.map((k) => [k, null])) as Record<TextSlot, string | null>;
  if (s.demo) {
    const demo = DemoPostsSchema.parse(JSON.parse(readFileSync(join(brandDir(s.brand), "demo-posts.json"), "utf8")));
    const p = demo.posts.find((x) => x.briefId === s.demo);
    if (!p) throw new Error(`No demo post ${s.demo} for ${s.brand}`);
    return {
      brand: s.brand,
      id: p.briefId,
      intent: p.intent,
      goal: p.goal,
      angle: p.kit.notes.find((x) => /angle/i.test(x.decision))?.reason ?? "(see the copy)",
      aspect: getTemplate(p.kit.template).aspect as "1:1" | "4:5",
      photo: p.kit.photo ?? null,
      slots: { ...blank, ...Object.fromEntries(TEXT_SLOTS.map((k) => [k, p.kit.slots[k] ?? null])) },
      stored: p.kit.composed,
    };
  }
  return { brand: s.brand, id: s.id!, intent: s.intent!, goal: s.goal!, angle: s.angle ?? "(see the copy)", aspect: s.aspect ?? "4:5", photo: s.photo ?? null, readsAs: s.reads_as, slots: { ...blank, ...s.slots } };
}

const posts = specs.filter((s) => !brandArg || s.brand === brandArg).map(resolvePost).filter((p) => !only || only.includes(p.id));
if (!posts.length) throw new Error("No posts matched. Check spike/bold-posts.yaml, the brand and --only.");

const runId = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
const runDir = join(OUTPUT_DIR, `bold-${runId}`);
mkdirSync(join(runDir, "posts"), { recursive: true });
const rel = (abs: string) => relative(join(runDir, "posts"), abs).split("\\").join("/");
const fontsHref = rel(join(ROOT, "assets", "fonts", "fonts.css"));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const usage: Usage[] = [];

type Built = { label: string; name: string; png: string | null; composition: Composition | null; errors: string[]; probe: ProbeIssue[]; tries: number; direction?: Direction };
type PostResult = {
  post: Post;
  before: Built;
  directions: Direction[];
  photoNotes: string;
  factConflicts: string[];
  built: Built[];
  critique: ArtCritique | null;
  blind: Record<string, string>;
  winner: string | null;
  revised: Built | null;
  sheet: string;
  usd: number;
  seconds: number;
  error?: string;
};

async function shoot(htmlFile: string, pngFile: string, aspect: "1:1" | "4:5"): Promise<ProbeIssue[]> {
  const page = await browser.newPage({ viewport: { width: 1080, height: aspect === "4:5" ? 1350 : 1080 }, deviceScaleFactor: 1 });
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

const copyText = (slots: Record<TextSlot, string | null>) =>
  TEXT_SLOTS.filter((s) => slots[s]).map((s) => `${s}: "${slots[s]}" (${slots[s]!.length} characters)`).join("\n");
const issueText = (b: { errors: string[]; probe: ProbeIssue[] }) => [...b.errors, ...b.probe.map((i) => `${i.slot}: ${i.problem}`)];

async function runPost(post: Post): Promise<PostResult> {
  const started = Date.now();
  const before = usage.length;
  const chunks = loadChunks(post.brand);
  const pick = (ids: string[]) => formatChunks(ids.filter((id) => chunks.has(id)).map((id) => chunks.get(id)!));
  const designKit = pick(["energy", "layout-system", "visual-system", "art-direction", "social-rules"]);
  const fullKit = pick(["positioning-core", "energy", "layout-system", "visual-system", "art-direction", "social-rules", "guardrails"]);
  const currentKit = pick(["layout-system", "visual-system", "art-direction", "social-rules"]);
  const tokensCss = readFileSync(join(kitDir(post.brand), "tokens.css"), "utf8");
  const briefs = YAML.parse(readFileSync(join(brandDir(post.brand), "briefs.yaml"), "utf8")) as { business_name: string; photos: { file: string; alt: string }[] };
  const lockup = wordmarkLines(post.brand);
  const logoAbs = join(brandDir(post.brand), "logo.png");
  const logo = existsSync(logoAbs) ? logoAbs : null;
  const photoAbs = post.photo ? join(brandDir(post.brand), post.photo) : null;
  const alt = briefs.photos.find((x) => x.file === post.photo)?.alt.trim() ?? "";
  const size = post.aspect === "4:5" ? "1080 × 1350 px (4:5)" : "1080 × 1080 px (1:1)";
  const canvas = `${size}. The brand's safe margin is var(--safe-margin).`;
  const copy = copyText(post.slots) + (post.readsAs ? `\nReads as: "${post.readsAs}"` : "");
  const photoImg: Image[] = photoAbs ? [{ mediaType: "image/jpeg", base64: readFileSync(photoAbs).toString("base64") }] : [];
  const logoImg: Image[] = logo ? [{ mediaType: "image/png", base64: readFileSync(logo).toString("base64") }] : [];
  const photoLine = photoAbs ? `The first image attached. ${alt}` : "None.";
  const logoLine = logo ? `The ${photoAbs ? "second" : "first"} image attached: the brand's real logo (transparent PNG), placed by code in the wordmark slot.` : `No logo image; the wordmark slot gets the lockup lines: ${lockup.join(" / ")}.`;
  const base = `${post.brand}--${post.id}`;

  async function render(c: Pick<Composition, "html" | "css">, name: string, usesPhoto: boolean, echoes: boolean): Promise<{ png: string; probe: ProbeIssue[] }> {
    const html = join(runDir, "posts", `${name}.html`);
    writeFileSync(
      html,
      buildComposedPage({
        composition: { html: echoes ? fillEchoes(c.html, post.slots) : c.html, css: c.css },
        slots: post.slots,
        aspect: post.aspect,
        tokensCss,
        fontsHref,
        wordmarkLines: lockup,
        logoSrc: logo ? rel(logo) : null,
        photo: usesPhoto && photoAbs ? { src: rel(photoAbs), alt } : null,
      }),
    );
    const probe = relevantIssues(await shoot(html, html.replace(/\.html$/, ".png"), post.aspect), Boolean(logo));
    return { png: `posts/${name}.png`, probe };
  }

  // 1. Before: the post as Specs composes it today.
  let beforeBuilt: Built;
  if (post.stored) {
    const r = await render(post.stored, `${base}--before`, Boolean(photoAbs), false);
    beforeBuilt = { label: "before", name: "Today's Specs post", png: r.png, composition: { ...post.stored }, errors: [], probe: r.probe, tries: 0 };
  } else {
    beforeBuilt = { label: "before", name: "Today's Specs post", png: null, composition: null, errors: [], probe: [], tries: 0 };
    for (let n = 1; n <= 2; n++) {
      const feedback = beforeBuilt.composition
        ? `<previous_attempt_sent_back>\nYour previous HTML:\n${beforeBuilt.composition.html}\n\nYour previous CSS:\n${beforeBuilt.composition.css}\n\nProblems found by code:\n${issueText(beforeBuilt).map((e) => `- ${e}`).join("\n")}\n</previous_attempt_sent_back>`
        : "";
      const prompt = loadPrompt("compose", { kit: currentKit, tokens: tokensCss, business_name: briefs.business_name, intent: post.intent, goal: post.goal, angle: post.angle, canvas, copy, photo: photoAbs ? `Attached above. ${alt}` : "None. This post has no photo; don't include a photo slot.", feedback });
      const out = await callStructured({ step: "compose", ...prompt, images: photoImg, schema: ComposeSchema });
      usage.push(out.usage);
      const check = checkComposition(out.data, post.slots, Boolean(photoAbs));
      beforeBuilt = { ...beforeBuilt, composition: out.data, errors: check.errors, probe: [], tries: n };
      if (!check.ok) continue;
      const r = await render(out.data, `${base}--before`, Boolean(photoAbs), false);
      beforeBuilt.png = r.png;
      beforeBuilt.probe = r.probe;
      if (!r.probe.length) break;
    }
  }

  // 2. Directions.
  const dPrompt = loadPrompt("directions", { kit: fullKit, business_name: briefs.business_name, intent: post.intent, goal: post.goal, canvas, copy, photo: photoLine, logo: logoLine });
  const dOut = await callStructured({ step: "directions", ...dPrompt, images: [...photoImg, ...logoImg], schema: DirectionsSchema });
  usage.push(dOut.usage);
  const directions = dOut.data.directions.slice(0, 3).map((d, i) => ({ ...d, label: "ABC"[i]! }));

  // 3. Build each direction.
  async function build(d: Direction, tag: string, notes: string[] = [], from?: Built): Promise<Built> {
    const usesPhoto = Boolean(photoAbs) && d.uses_photo;
    let b: Built = from ? { ...from, tries: 0 } : { label: d.label, name: d.name, png: null, composition: null, errors: [], probe: [], tries: 0, direction: d };
    const direction = [
      `${d.label}. ${d.name}`,
      `Idea: ${d.idea}`,
      `Hero: ${d.hero}`,
      `Composition: ${d.composition}`,
      `Treatments: ${d.treatments.join(", ")}`,
      `Photo: ${usesPhoto ? d.photo_treatment : "Not used in this direction; leave the photo slot out."}`,
      `Logo: ${d.logo}`,
      `Breaks on purpose: ${d.breaks}`,
    ].join("\n");
    for (let n = 1; n <= 2; n++) {
      const problems = b.composition ? issueText(b) : [];
      const feedback = b.composition
        ? `<previous_attempt_sent_back>\nYour previous HTML:\n${b.composition.html}\n\nYour previous CSS:\n${b.composition.css}\n\n${
            notes.length && n === 1 ? `The creative director picked this post and asks for these changes:\n${notes.map((x) => `- ${x}`).join("\n")}` : `Problems found by code:\n${problems.map((e) => `- ${e}`).join("\n")}`
          }\n</previous_attempt_sent_back>`
        : "";
      const prompt = loadPrompt("compose-bold", { kit: designKit, tokens: tokensCss, business_name: briefs.business_name, intent: post.intent, goal: post.goal, direction, canvas, copy, photo: usesPhoto ? photoLine : "Not used in this direction.", logo: logoLine, feedback });
      const out = await callStructured({ step: "compose_bold", ...prompt, images: [...(usesPhoto ? photoImg : []), ...logoImg], schema: ComposeSchema });
      usage.push(out.usage);
      const check = checkBold(out.data, post.slots, usesPhoto);
      b = { ...b, composition: out.data, errors: check.errors, probe: [], tries: n, png: check.ok ? null : b.png };
      if (!check.ok) continue;
      const r = await render(out.data, `${base}--${tag}-${n}`, usesPhoto, true);
      b.png = r.png;
      b.probe = r.probe;
      if (!r.probe.length) break;
    }
    return b;
  }
  const built = await Promise.all(directions.map((d) => build(d, d.label)));

  // 4. Critique, blind: shuffled numbers, "before" among them.
  const pool = [beforeBuilt, ...built].filter((b) => b.png);
  const order = pool.map((b) => ({ b, k: Math.random() })).sort((x, y) => x.k - y.k).map((x) => x.b);
  const blind: Record<string, string> = {};
  order.forEach((b, i) => (blind[String(i + 1)] = b.label));
  let critique: ArtCritique | null = null;
  let winner: string | null = null;
  let revised: Built | null = null;
  if (order.length) {
    const candidates = order
      .map((b, i) => {
        const issues = issueText(b);
        const d = b.direction;
        return `Candidate ${i + 1} (image ${i + 1}).${d ? ` Intended idea: ${d.idea}` : ""}${issues.length ? ` Code checks still flag: ${issues.join("; ")}.` : " Passed every code check."}`;
      })
      .join("\n");
    const cPrompt = loadPrompt("art-critique", { kit: fullKit, business_name: briefs.business_name, intent: post.intent, goal: post.goal, copy, candidates });
    const images: Image[] = order.map((b) => ({ mediaType: "image/png", base64: readFileSync(join(runDir, b.png!)).toString("base64") }));
    const cOut = await callStructured({ step: "art_critique", ...cPrompt, images, schema: ArtCritiqueSchema });
    usage.push(cOut.usage);
    critique = cOut.data;
    winner = blind[critique.winner.replace(/\D/g, "")] ?? null;

    // 5. Revise the winner once, if it's a new direction and the critic asked for changes.
    const w = built.find((b) => b.label === winner);
    if (w?.direction && critique.revision.length) {
      revised = await build(w.direction, `${w.label}-revised`, critique.revision, w);
      revised.label = `${w.label} revised`;
      if (!revised.png || revised.errors.length) revised = { ...revised, png: null };
    }
  }

  return {
    post,
    before: beforeBuilt,
    directions,
    photoNotes: dOut.data.photo_notes,
    factConflicts: [...new Set([...dOut.data.fact_conflicts, ...(critique?.fact_conflicts ?? [])])],
    built,
    critique,
    blind,
    winner,
    revised,
    sheet: `${base}--sheet.png`,
    usd: usage.slice(before).reduce((s, u) => s + u.usd, 0),
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

console.log(`Bold run ${runId}: ${posts.length} post(s)`);
const results: PostResult[] = [];
try {
  for (const p of posts) {
    try {
      const r = await runPost(p);
      console.log(`  ${p.brand} / ${p.id}: critic picked ${r.winner ?? "nothing"}${r.revised?.png ? " (revised)" : ""}, ${r.seconds}s, $${r.usd.toFixed(2)}`);
      results.push(r);
    } catch (err) {
      console.error(`  failed: ${p.brand} / ${p.id}: ${(err as Error).message}`);
    }
  }
  writeFileSync(join(runDir, "run.json"), JSON.stringify({ runId, models: { directions: STEPS.directions, compose_bold: STEPS.compose_bold, art_critique: STEPS.art_critique }, results, usage }, null, 2));
  writeFileSync(join(runDir, "index.html"), reviewPage(results));
  // One comparison sheet per post, for sharing.
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(runDir, "index.html")).href, { waitUntil: "load" });
  for (const r of results) await page.locator(`#${r.post.brand}--${r.post.id} .sheet`).screenshot({ path: join(runDir, r.sheet) });
  await page.close();
} finally {
  await browser.close();
}
const total = usage.reduce((s, u) => s + u.usd, 0);
console.log(`\nApproximate cost: $${total.toFixed(2)}`);
console.log(`Review page: ${join(runDir, "index.html")}`);

function reviewPage(rs: PostResult[]): string {
  const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const scoreOf = (r: PostResult, label: string) => {
    const n = Object.entries(r.blind).find(([, l]) => l === label)?.[0];
    return r.critique?.candidates.find((c) => c.label.replace(/\D/g, "") === n);
  };
  const tile = (r: PostResult, b: Built, title: string) => {
    const s = scoreOf(r, b.label.replace(" revised", ""));
    const win = r.winner === b.label;
    const flags = issueText(b);
    return `<figure class="${win ? "win" : ""}">
      ${b.png ? `<img src="${b.png}" alt="">` : `<div class="none">Didn't pass the checks</div>`}
      <figcaption><b>${esc(title)}</b>${win ? ' <span class="pick">Critic\'s pick</span>' : ""}
      ${b.direction ? `<br><span class="idea">${esc(b.direction.idea)}</span><br><span class="t">${b.direction.treatments.map(esc).join(" · ")}</span>` : ""}
      ${s && !b.label.includes("revised") ? `<br><span class="sc">idea ${s.idea} · stop ${s.stop} · brand ${s.brand} · legible ${s.legible}</span><br><span class="n">${esc(s.notes)}</span>${s.honesty.length ? `<br><span class="bad">Honesty: ${s.honesty.map(esc).join("; ")}</span>` : ""}` : ""}
      ${flags.length ? `<br><span class="bad">Checks: ${flags.map(esc).join("; ")}</span>` : ""}</figcaption></figure>`;
  };
  const sections = rs
    .map((r) => {
      const final = r.revised?.png ? r.revised : null;
      return `<section id="${esc(`${r.post.brand}--${r.post.id}`)}">
  <div class="sheet">
    <h2>${esc(r.post.brand)} · ${esc(r.post.intent)} · ${esc(r.post.goal)}</h2>
    <div class="row">
      ${tile(r, r.before, "Before: today's Specs")}
      ${r.built.map((b) => tile(r, b, `${b.label}. ${b.name}`)).join("")}
      ${final ? tile(r, final, `Final: ${r.winner} revised`) : ""}
    </div>
  </div>
  ${r.critique ? `<p><b>Why the pick:</b> ${esc(r.critique.why)}</p>${r.critique.revision.length ? `<p><b>Revision notes:</b></p><ul>${r.critique.revision.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}` : ""}
  ${r.factConflicts.length ? `<p class="bad"><b>Copy vs kit:</b> ${r.factConflicts.map(esc).join(" ")}</p>` : ""}
  <p class="meta"><b>Photo notes:</b> ${esc(r.photoNotes)}</p>
  <p class="meta">${r.seconds}s · $${r.usd.toFixed(2)} · blind labels ${esc(JSON.stringify(r.blind))}</p>
</section>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bolder posts spike</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:32px;background:#ececea;color:#111}h1{font-size:28px}h2{font-size:17px;margin:0 0 14px}
section{background:#fff;border-radius:20px;padding:24px;margin:0 0 28px}.sheet{background:#fff;padding:8px}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;align-items:start}
figure{margin:0}figure img{width:100%;display:block;border-radius:6px}figure.win img{outline:4px solid #e5372b;outline-offset:3px}
figcaption{font-size:12.5px;color:#333;margin-top:8px}.idea{color:#111}.t,.n,.meta{color:#666}.sc{font-family:ui-monospace,monospace;font-size:12px}
.pick{background:#e5372b;color:#fff;border-radius:99px;padding:1px 8px;font-size:11px}.none{aspect-ratio:4/5;display:grid;place-items:center;background:#eee;border-radius:6px;color:#888}
.bad{color:#b3261e}
</style></head><body><h1>Bolder posts: before vs three directions</h1>
<p>Same copy, same photo, the brand's real logo. Code still enforces every word, color and font. The critic saw all candidates, including today's post, under shuffled numbers. Run ${esc(runId)}.</p>
${sections}</body></html>`;
}
