// Runs the app's real bold pass (server/bold.ts, server/bold-run.ts) on a demo brand's
// precomputed posts, on this machine, and packs the critic's top two into
// brands/<brand>/demo-posts.json, so the demo page can show a bolder version for free.
// It is also an end-to-end check of the server code with real Claude and Gemini calls:
// the same handlers, with memory storage and Playwright standing in for the browser.
//
// Costs money: about $0.60–0.85 a post (two directions, the image model's rough at energy 4–5,
// the critic). Scott's rule: one brand, one or two posts at a time.
//
// Usage: npm run spike -- --conditions=react-server spike/pack-bold.ts <brand> --only <briefId>[,<briefId>]
//        add --dry to run without writing demo-posts.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "playwright";
import { DemoPostsSchema, type DemoPost } from "../core/demo.ts";
import { buildComposedPage, LAYOUT_PROBE, TEXT_SLOTS, type ProbeIssue, type TextSlot } from "../core/compose.ts";
import { callStructured, type Usage } from "../core/claude.ts";
import { POST_INTENTS } from "../core/limits.ts";
import { findTemplate, parseTemplates } from "../core/templates.ts";
import { todaysSpend } from "../server/spend.ts";
import { memoryKV } from "../server/store.ts";
import { readSettings } from "../server/settings.ts";
import { startBold, boldRender, boldJudge, loadJob, type BoldTrigger } from "../server/bold.ts";
import { runBold } from "../server/bold-run.ts";
import { respond } from "../server/http.ts";
import type { Deps } from "../server/handlers.ts";
import type { CallStep } from "../server/claude.ts";
import type { Session } from "../server/sessions.ts";
import { brandDir, kitDir, OUTPUT_DIR, ROOT } from "./lib/paths.ts";
import { wordmarkLines } from "./lib/kit.ts";

const args = process.argv.slice(2);
const brand = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");
const onlyArg = args[args.indexOf("--only") + 1];
const dry = args.includes("--dry");
if (!brand || !args.includes("--only") || !onlyArg) throw new Error("Usage: spike/pack-bold.ts <brand> --only <briefId>[,<briefId>] [--dry]");
const only = onlyArg.split(",");
const gemini = process.env.GEMINI_API_KEY?.trim() || undefined;

const demoFile = join(brandDir(brand), "demo-posts.json");
const demo = DemoPostsSchema.parse(JSON.parse(readFileSync(demoFile, "utf8")));
const posts = demo.posts.filter((p) => only.includes(p.briefId));
if (!posts.length) throw new Error(`No posts ${only.join(", ")} in ${demoFile}`);

const runId = `bold-pack-${new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "")}`;
const runDir = join(OUTPUT_DIR, runId);
mkdirSync(join(runDir, "posts"), { recursive: true });
const rel = (abs: string) => relative(join(runDir, "posts"), abs).split("\\").join("/");
const tokensCss = readFileSync(join(kitDir(brand), "tokens.css"), "utf8");
const logoAbs = join(brandDir(brand), "logo.png");
const templates = parseTemplates(readFileSync(join(ROOT, "templates", "templates.json"), "utf8"));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// Real Claude, long timeout; a generous cap, since this machine pays and the run is small.
const client = new Anthropic({ timeout: 360_000, maxRetries: 1 });
const usage: Usage[] = [];
const callStep: CallStep = async (o) => {
  const r = await callStructured(client, o);
  usage.push(r.usage);
  return r;
};
const deps: Deps = {
  kv: memoryKV(),
  settings: readSettings({ ANTHROPIC_API_KEY: "set", TURNSTILE_SECRET_KEY: "local", IP_HASH_SALT: "local", GENERATION_ENABLED: "true", DAILY_SPEND_CAP_USD: "10", GEMINI_API_KEY: gemini }),
  now: () => new Date(),
  verifyTurnstile: async () => true,
  callStep,
};
const req = (path: string, body: unknown) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function call(path: string, run: () => Promise<Response>) {
  const res = await respond(run);
  const json = await res.json();
  if (res.status >= 400) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
}

async function render(html: string, name: string, aspect: "1:1" | "4:5"): Promise<{ issues: ProbeIssue[]; jpeg: string; png: string }> {
  const file = join(runDir, "posts", `${name}.html`);
  writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: 1080, height: aspect === "4:5" ? 1350 : 1080 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const issues = (await page.evaluate(LAYOUT_PROBE)) as ProbeIssue[];
    const png = `posts/${name}.png`;
    await page.locator(".post").screenshot({ path: join(runDir, png) });
    // Half size, like the browser sends.
    await page.setViewportSize({ width: 540, height: aspect === "4:5" ? 675 : 540 });
    await page.evaluate(() => (document.body.style.zoom = "0.5"));
    const jpeg = (await page.locator(".post").screenshot({ type: "jpeg", quality: 82 })).toString("base64");
    return { issues, jpeg, png };
  } finally {
    await page.close();
  }
}

const unfillEchoes = (html: string) => html.replace(/(<([a-zA-Z0-9]+)[^>]*\sdata-echo=["']?[\w-]+["']?[^>]*>)[\s\S]*?(<\/\2>)/g, "$1$3").replace(/ class="([^"]*?)\s*\becho\b\s*([^"]*)"/g, (_m, a: string, b: string) => ` class="${`${a} ${b}`.trim()}"`);

console.log(`${runId}: ${brand}, ${posts.length} post(s)${gemini ? "" : " (no GEMINI_API_KEY: Claude only)"}`);
const results: { post: DemoPost; bold: NonNullable<DemoPost["kit"]["bold"]>; pngs: Record<string, string> }[] = [];
try {
  for (const post of posts) {
    const sessionId = crypto.randomUUID();
    const postId = "p1";
    const aspect = findTemplate(templates, post.kit.template).aspect as "1:1" | "4:5";
    const spentBefore = (await todaysSpend(deps.kv, deps.now())).spentUsd;
    const session: Session = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      ipHash: "local",
      postsUsed: 1,
      regenerationsUsed: 0,
      uploads: [],
      posts: {
        [postId]: {
          id: postId,
          brand: brand as never,
          intent: post.intent as (typeof POST_INTENTS)[number],
          brief: { goal: post.goal, details: post.details },
          regenerationOf: null,
          status: "written",
          plan: { template: post.kit.template, photo: post.kit.photo ?? "none", angle: "(precomputed demo post)", rationale: [] },
          photo: post.kit.photo,
          written: { slots: post.kit.slots, rationale: [] },
          warnings: [],
        },
      },
    };
    await deps.kv.put(`session/${sessionId}`, session, { ifNew: true });
    const starter = (t: BoldTrigger) => runBold(deps, t, gemini);
    await call("start", () => startBold(req("/api/posts/bold/start", { sessionId, postId }), deps, starter));
    const job = (await loadJob(deps.kv, sessionId, postId))!;
    console.log(`  ${post.briefId}: energy ${job.energy}, image model ${job.sketch}, ${job.candidates.length} candidate(s) passed the code checks${job.error ? `, error: ${job.error}` : ""}`);

    const slots = Object.fromEntries(TEXT_SLOTS.map((s) => [s, post.kit.slots[s] ?? null])) as Record<TextSlot, string | null>;
    const photo = post.kit.photo ? { src: rel(join(brandDir(brand), post.kit.photo)), alt: "" } : null;
    const page = (c: { html: string; css: string }, usesPhoto: boolean) =>
      buildComposedPage({ composition: c, slots, aspect, tokensCss, fontsHref: rel(join(ROOT, "assets", "fonts", "fonts.css")), wordmarkLines: wordmarkLines(brand), logoSrc: rel(logoAbs), photo: usesPhoto ? photo : null });
    const pngs: Record<string, string> = {};
    if (job.status === "rendering") {
      const quick = post.kit.composed ? page(post.kit.composed, Boolean(post.kit.photo)) : null;
      if (!quick) throw new Error(`${post.briefId} has no composed layout to compare with; pack its compose run first.`);
      for (const [label, html] of [["quick", quick], ...job.candidates.map((c) => [c.label, page(c, c.usesPhoto)])] as [string, string][]) {
        const r = await render(html, `${post.briefId}--${label}`, aspect);
        pngs[label] = r.png;
        if (r.issues.length) console.log(`    ${label}: probe flags ${r.issues.map((i) => `${i.slot} ${i.code}`).join(", ")}`);
        await call("render", () => boldRender(req("/api/posts/bold/render", { sessionId, postId, label, jpeg: r.jpeg, issues: r.issues.map(({ slot, code, n }) => ({ slot, code, ...(n === undefined ? {} : { n }) })) }), deps));
      }
      await call("judge", () => boldJudge(req("/api/posts/bold/judge", { sessionId, postId }), deps, starter));
    }
    const done = (await loadJob(deps.kv, sessionId, postId))!;
    // Every call, the image model's included, was settled against the (memory) daily total.
    const usd = (await todaysSpend(deps.kv, deps.now())).spentUsd - spentBefore;
    const r = done.ranking;
    console.log(`  ${post.briefId}: ${done.status}; order ${r?.order.join(" > ") ?? "-"}; about $${usd.toFixed(2)}`);
    if (!r || !done.candidates.length) continue;
    const options = r.order.slice(0, 2).map((label) => {
      const c = done.candidates.find((x) => x.label === label);
      return c
        ? { label, name: c.source === "sketch" ? "From a painted rough" : c.name, source: c.source, pick: label === r.winner, note: r.notes[label] ?? "", html: unfillEchoes(c.html), css: c.css, usesPhoto: c.usesPhoto, rationale: c.rationale }
        : { label: "quick", name: "As first made", source: "quick" as const, pick: label === r.winner, note: r.notes[label] ?? "" };
    });
    results.push({ post, pngs, bold: { sourceRun: runId, costUsd: Math.round(usd * 100) / 100, why: r.why, energy: done.energy, options } });
  }
} finally {
  await browser.close();
}

// Review sheet: every candidate, the top two marked.
const tiles = results
  .map((x) => `<section><h2>${x.post.briefId}</h2><div class="row">${Object.entries(x.pngs).map(([l, png]) => {
    const o = x.bold.options.find((y) => y.label === l);
    return `<figure class="${o?.pick ? "win" : o ? "top" : ""}"><img src="${png}"><figcaption>${l === "quick" ? "As first made" : l === "S" ? "S: painted rough, rebuilt" : `Direction ${l}`}${o?.pick ? " · critic's pick" : o ? " · runner-up" : ""}<br>${(o?.note ?? "").replace(/</g, "&lt;")}</figcaption></figure>`;
  }).join("")}</div><p>${x.bold.why.replace(/</g, "&lt;")}</p></section>`)
  .join("");
writeFileSync(join(runDir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Bold pack</title><style>body{font:14px system-ui;margin:24px;background:#ececea}section{background:#fff;border-radius:16px;padding:16px;margin-bottom:20px}.row{display:flex;gap:12px}figure{margin:0;width:260px}img{width:100%;border-radius:6px}.win img{outline:4px solid #e5372b}.top img{outline:3px solid #999}</style><h1>${runId}</h1>${tiles}`);
const sheet = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const sp = await sheet.newPage({ viewport: { width: 1500, height: 900 } });
await sp.goto(pathToFileURL(join(runDir, "index.html")).href, { waitUntil: "load" });
await sp.screenshot({ path: join(runDir, "sheet.png"), fullPage: true });
await sheet.close();

if (!dry && results.length) {
  const fresh = DemoPostsSchema.parse(JSON.parse(readFileSync(demoFile, "utf8")));
  for (const x of results) {
    const p = fresh.posts.find((y) => y.briefId === x.post.briefId)!;
    p.kit.bold = x.bold;
  }
  writeFileSync(demoFile, `${JSON.stringify(DemoPostsSchema.parse(fresh), null, 2)}\n`);
  console.log(`Packed into ${relative(ROOT, demoFile)}`);
}
const total = results.reduce((s, x) => s + x.bold.costUsd, 0);
console.log(`About $${total.toFixed(2)}. Review: ${join(runDir, "index.html")} and sheet.png`);
