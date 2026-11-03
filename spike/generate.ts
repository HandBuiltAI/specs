// Phase 2 quality spike: for each brief, plan -> write -> render -> critique (one revision at most)
// with the brand kit, and plan -> write -> render with no kit as the baseline. Then writes the
// review page.
//
// Usage: npm run spike -- spike/generate.ts <brand> [--only brief-id,brief-id] [--no-baseline]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import YAML from "yaml";
import { STEPS } from "../core/config.ts";
import { brandDir, OUTPUT_DIR } from "./lib/paths.ts";
import { selectChunks, formatChunks, wordmarkLines } from "./lib/kit.ts";
import { loadPrompt } from "./lib/prompts.ts";
import { callStructured, type Image, type Usage } from "./lib/claude.ts";
import { PlanSchema, WriteSchema, CritiqueSchema, type Plan, type Written, type Critique } from "../core/schemas.ts";
import { buildPostHtml, canvasSize, getTemplate, loadTemplates, type Look, type TemplateSpec } from "./lib/templates.ts";
import { openRenderer, type Renderer } from "./lib/render.ts";
import { runChecks, formatChecks, type Check } from "./lib/checks.ts";
import { writeReviewPage } from "./review.ts";

// ---------- inputs ----------

type Brief = { id: string; intent: string; goal: string; details: string };
type BriefFile = {
  brand: string;
  business_name: string;
  business_line: string;
  photos: { file: string; alt: string }[];
  briefs: Brief[];
};

const args = process.argv.slice(2);
const brand = args.find((a) => !a.startsWith("--"));
if (!brand) throw new Error("Usage: npm run spike -- spike/generate.ts <brand> [--only id,id] [--no-baseline]");
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1]! : args[args.indexOf(onlyArg) + 1]!).split(",") : null;
const withBaseline = !args.includes("--no-baseline");

const briefFile = YAML.parse(readFileSync(join(brandDir(brand), "briefs.yaml"), "utf8")) as BriefFile;
const briefs = briefFile.briefs.filter((b) => !only || only.includes(b.id));
if (!briefs.length) throw new Error(`No briefs matched ${only?.join(", ")}`);

const runId = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
const runDir = join(OUTPUT_DIR, runId);
const postsDir = join(runDir, "posts");
mkdirSync(postsDir, { recursive: true });

const photoAbs = (file: string) => join(brandDir(brand), file);
const images: Image[] = briefFile.photos.map((p) => ({
  mediaType: p.file.endsWith(".png") ? "image/png" : "image/jpeg",
  base64: readFileSync(photoAbs(p.file)).toString("base64"),
}));
const photoList = briefFile.photos.map((p, i) => `${i + 1}. ${p.file}: ${p.alt.trim()}`).join("\n");

const templateForPrompt = (t: TemplateSpec) => JSON.stringify(t, null, 2);
const templatesForPrompt = JSON.stringify(loadTemplates(), null, 2);
const NO_KIT = "No brand kit is available for this business. Use your own judgment.";

// ---------- one post ----------

export type Draft = { slots: Written["slots"]; rationale: Written["rationale"]; png: string; html: string; checks: Check[]; critique?: Critique };
export type PostRecord = {
  briefId: string;
  variant: "kit" | "nokit";
  plan: Plan;
  photo: string | null;
  drafts: Draft[];
  usage: Usage[];
  chunks?: { generate: string[]; critique: string[]; generateTokens: number; budget: number };
  warnings: string[];
  error?: string;
};

async function makePost(brief: Brief, variant: "kit" | "nokit", renderer: Renderer): Promise<PostRecord> {
  const usage: Usage[] = [];
  const warnings: string[] = [];
  const useKit = variant === "kit";

  const gen = useKit ? selectChunks(brand!, "post_generate", brief.intent) : null;
  const crit = useKit ? selectChunks(brand!, "post_critique", brief.intent) : null;
  const kitText = gen ? formatChunks(gen.chunks) : NO_KIT;

  const common = {
    business_name: briefFile.business_name,
    business_line: briefFile.business_line,
    intent: brief.intent,
    goal: brief.goal,
    details: brief.details.trim(),
  };

  // 1. Plan
  const planPrompt = loadPrompt("plan", { ...common, kit: kitText, templates: templatesForPrompt, photos: photoList });
  const planned = await callStructured({ step: "plan", ...planPrompt, images, schema: PlanSchema });
  usage.push(planned.usage);
  const plan = planned.data;
  const template = getTemplate(plan.template);

  let photo: string | null = null;
  if (template.photo === "required") {
    const listed = briefFile.photos.find((p) => p.file === plan.photo || basename(p.file) === basename(plan.photo));
    if (listed) photo = listed.file;
    else {
      photo = briefFile.photos[0]!.file;
      warnings.push(`Plan picked photo "${plan.photo}", which isn't in the list; used ${photo} instead.`);
    }
  }

  const look: Look = useKit ? { kind: "brand", brand: brand!, wordmarkLines: wordmarkLines(brand!) } : { kind: "neutral", businessName: briefFile.business_name };

  // 2-4. Write, render, check, critique. One revision at most.
  const drafts: Draft[] = [];
  const maxDrafts = useKit ? 2 : 1;
  for (let n = 1; n <= maxDrafts; n++) {
    const previous = drafts.at(-1);
    const critiqueBlock = previous?.critique
      ? `<critique_of_previous_draft>\nPrevious copy:\n${JSON.stringify(previous.slots, null, 2)}\n\nCritique:\n${JSON.stringify(previous.critique, null, 2)}\n\nAutomated checks:\n${formatChecks(previous.checks)}\n</critique_of_previous_draft>`
      : "";
    const writePrompt = loadPrompt("write", {
      ...common,
      kit: kitText,
      plan: JSON.stringify({ template: plan.template, photo, angle: plan.angle }, null, 2),
      template: templateForPrompt(template),
      critique: critiqueBlock,
    });
    const written = await callStructured({ step: "write", ...writePrompt, schema: WriteSchema });
    usage.push(written.usage);

    const stem = `${brief.id}--${variant}${maxDrafts > 1 ? `--draft${n}` : ""}`;
    const htmlFile = join(postsDir, `${stem}.html`);
    const pngFile = join(postsDir, `${stem}.png`);
    // A quote card draws its own quotation mark, so strip quotes the model wrapped around the words.
    if (written.data.slots.quote) written.data.slots.quote = written.data.slots.quote.trim().replace(/^["“”]+|["“”]+$/g, "");
    // Drop any slot the chosen template doesn't have, so it can't render or skew the checks.
    for (const [k, v] of Object.entries(written.data.slots)) {
      if (v && k !== "caption" && !(k in template.slots)) {
        warnings.push(`Draft ${n} filled "${k}", which ${template.id} doesn't have; dropped it.`);
        (written.data.slots as Record<string, string | null>)[k] = null;
      }
    }
    const slotsForRender = Object.fromEntries(Object.entries(written.data.slots).map(([k, v]) => [k, v ?? undefined]));
    writeFileSync(htmlFile, buildPostHtml({ templateId: template.id, slots: slotsForRender, photoPath: photo ? photoAbs(photo) : undefined, look, outFile: htmlFile }));
    const overflow = await renderer.render({ htmlFile, pngFile, ...canvasSize(template) });
    const checks = runChecks({ slots: written.data.slots, template, brand: useKit ? brand! : null, details: brief.details, overflow });

    const draft: Draft = { slots: written.data.slots, rationale: written.data.rationale, png: `posts/${stem}.png`, html: `posts/${stem}.html`, checks };
    drafts.push(draft);
    if (!useKit) break;

    const critPrompt = loadPrompt("critique", {
      kit: formatChunks(crit!.chunks),
      intent: brief.intent,
      goal: brief.goal,
      details: brief.details.trim(),
      template: templateForPrompt(template),
      slots: JSON.stringify(written.data.slots, null, 2),
      checks: formatChecks(checks),
    });
    const png: Image = { mediaType: "image/png", base64: readFileSync(pngFile).toString("base64") };
    const critiqued = await callStructured({ step: "critique", ...critPrompt, images: [png], schema: CritiqueSchema });
    usage.push(critiqued.usage);
    draft.critique = critiqued.data;
    const failedChecks = checks.some((c) => !c.ok);
    if (critiqued.data.verdict === "pass" && !failedChecks) break;
  }

  return {
    briefId: brief.id,
    variant,
    plan,
    photo,
    drafts,
    usage,
    chunks: gen && crit ? { generate: gen.chunks.map((c) => c.id), critique: crit.chunks.map((c) => c.id), generateTokens: gen.tokens, budget: gen.budget } : undefined,
    warnings,
  };
}

// ---------- run ----------

async function safely(brief: Brief, variant: "kit" | "nokit", renderer: Renderer): Promise<PostRecord> {
  try {
    const rec = await makePost(brief, variant, renderer);
    console.log(`  done: ${brief.id} (${variant})`);
    return rec;
  } catch (err) {
    console.error(`  failed: ${brief.id} (${variant}): ${(err as Error).message}`);
    return { briefId: brief.id, variant, plan: undefined as unknown as Plan, photo: null, drafts: [], usage: [], warnings: [], error: (err as Error).message };
  }
}

console.log(`Run ${runId}: ${briefs.length} brief(s) for ${brand}${withBaseline ? ", with no-kit baseline" : ""}`);
const renderer = await openRenderer();
const posts: PostRecord[] = [];
try {
  // Two briefs at a time keeps well under typical rate limits.
  for (let i = 0; i < briefs.length; i += 2) {
    const batch = briefs.slice(i, i + 2);
    const jobs = batch.flatMap((b) => [safely(b, "kit", renderer), ...(withBaseline ? [safely(b, "nokit", renderer)] : [])]);
    posts.push(...(await Promise.all(jobs)));
  }
} finally {
  await renderer.close();
}

const totalUsd = posts.flatMap((p) => p.usage).reduce((s, u) => s + u.usd, 0);
const run = {
  runId,
  brand,
  createdAt: new Date().toISOString(),
  models: STEPS,
  business: { name: briefFile.business_name, line: briefFile.business_line },
  briefs,
  posts,
  totalUsd,
};
writeFileSync(join(runDir, "run.json"), JSON.stringify(run, null, 2));
const page = writeReviewPage(runDir);
console.log(`\nApproximate cost: $${totalUsd.toFixed(3)}`);
console.log(`Review page: ${page}`);
