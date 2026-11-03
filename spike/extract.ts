// Phase 4 gate: runs extraction on a demo brand's messy uploads with the same prompts, models
// and checks the app uses, then writes a comparison page: the extracted kit next to the
// hand-built one, a checklist of facts it should find (and must not invent), and how long each
// call took, since the deployed app gives each call about 26 seconds.
//
// Usage: npm run spike -- spike/extract.ts half-acre-club      (costs roughly $0.30–0.50)
//        npm run review-extract -- output/extract-<run-id>      (rebuilds the page, free)
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { chromium } from "playwright";
import YAML from "yaml";
import { callStructured, type Usage } from "./lib/claude.ts";
import { OUTPUT_DIR, PROMPTS_DIR, brandDir, kitDir } from "./lib/paths.ts";
import { writeExtractReview, type ExtractRun } from "./lib/extract-review.ts";
import {
  ASSEMBLE_TARGETS,
  ChunkDraftSchema,
  ConflictsSchema,
  EvidenceSchema,
  assemblePrompt,
  checkHexes,
  checkSources,
  formatEvidence,
  readPrompt,
  type Evidence,
  type SampledColors,
  type UploadKind,
} from "../core/extract.ts";
import { dominantColors } from "../core/colors.ts";
import type { Image } from "../core/claude.ts";

const brand = process.argv[2] ?? "";
if (!brand) {
  console.error("Usage: npm run spike -- spike/extract.ts <brand>");
  process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("No ANTHROPIC_API_KEY. Put it in .env (see spike/README.md).");
  process.exit(2);
}

type CheckFile = { uploads: { file: string; kind: UploadKind }[]; checks: ExtractRun["checks"] };
const checkFile = YAML.parse(readFileSync(join(brandDir(brand), "extraction-check.yaml"), "utf8")) as CheckFile;
const prompts = { read: readFileSync(join(PROMPTS_DIR, "read.md"), "utf8"), assemble: readFileSync(join(PROMPTS_DIR, "assemble.md"), "utf8") };

const runId = `extract-${new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "")}`;
const runDir = join(OUTPUT_DIR, runId);
mkdirSync(runDir, { recursive: true });

const calls: ExtractRun["calls"] = [];
async function timed<T>(name: string, fn: () => Promise<{ data: T; usage: Usage }>): Promise<T | null> {
  const t0 = performance.now();
  try {
    const { data, usage } = await fn();
    const seconds = (performance.now() - t0) / 1000;
    calls.push({ name, seconds, usd: usage.usd, input: usage.input, output: usage.output, cacheRead: usage.cacheRead, ok: true });
    console.log(`  ${name}: ${seconds.toFixed(1)} s, $${usage.usd.toFixed(3)}${usage.cacheRead ? `, ${usage.cacheRead} cached tokens` : ""}`);
    return data;
  } catch (err) {
    const seconds = (performance.now() - t0) / 1000;
    const usd = (err as { usage?: Usage }).usage?.usd ?? 0;
    calls.push({ name, seconds, usd, input: 0, output: 0, cacheRead: 0, ok: false, error: (err as Error).message });
    console.log(`  ${name}: FAILED after ${seconds.toFixed(1)} s: ${(err as Error).message}`);
    return null;
  }
}

// ---------- colors, the way the browser samples them ----------

async function sampleColors(files: string[]): Promise<Record<string, SampledColors["colors"]>> {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  const out: Record<string, SampledColors["colors"]> = {};
  for (const f of files) {
    const dataUrl = `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(join(brandDir(brand), f)).toString("base64")}`;
    const pixels = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = 96 / Math.max(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
    }, dataUrl);
    out[f] = dominantColors(pixels, 6).filter((s) => s.share >= 0.03);
  }
  await browser.close();
  return out;
}

// ---------- run ----------

const started = Date.now();
console.log(`${runId}: extracting ${brand} from ${checkFile.uploads.length} uploads`);

const imageFiles = checkFile.uploads.filter((u) => u.kind === "photo" || u.kind === "logo").map((u) => u.file);
const colors = await sampleColors(imageFiles);
const sampled: SampledColors[] = imageFiles.map((f) => ({ upload: basename(f), colors: colors[f] ?? [] }));

console.log("Step 1: read each upload");
const notes: { upload: string; kind: UploadKind; evidence: Evidence }[] = [];
await Promise.all(
  checkFile.uploads.map(async (u) => {
    const label = basename(u.file);
    const bytes = readFileSync(join(brandDir(brand), u.file));
    const prompt = readPrompt(prompts.read, { label, kind: u.kind, text: u.kind === "pasted" || u.kind === "note" ? bytes.toString("utf8") : undefined });
    const images: Image[] = u.kind === "photo" || u.kind === "logo" ? [{ mediaType: u.file.endsWith(".png") ? "image/png" : "image/jpeg", base64: bytes.toString("base64") }] : [];
    const documents = u.kind === "pdf" ? [{ base64: bytes.toString("base64") }] : [];
    const evidence = await timed(`read ${label}`, () => callStructured({ step: "read", ...prompt, images, documents, schema: EvidenceSchema }));
    if (evidence) notes.push({ upload: label, kind: u.kind, evidence });
  }),
);
notes.sort((a, b) => checkFile.uploads.findIndex((u) => basename(u.file) === a.upload) - checkFile.uploads.findIndex((u) => basename(u.file) === b.upload));

if (!notes.length) {
  console.error("No upload could be read, so there's nothing to draft from. Check the errors above.");
  process.exit(1);
}

console.log("Step 2: draft each chunk");
const evidenceText = formatEvidence(notes, sampled);
const labels = notes.map((n) => n.upload);
const chunks: ExtractRun["chunks"] = {};
const draftOne = async (target: (typeof ASSEMBLE_TARGETS)[number]) => {
  const prompt = assemblePrompt(prompts.assemble, target);
  if (target === "conflicts") {
    const data = await timed(`draft ${target}`, () => callStructured({ step: "assemble", ...prompt, cachedText: evidenceText, schema: ConflictsSchema }));
    if (data) chunks[target] = { conflicts: data.conflicts, warnings: [] };
    return;
  }
  const data = await timed(`draft ${target}`, () => callStructured({ step: "assemble", ...prompt, cachedText: evidenceText, schema: ChunkDraftSchema }));
  if (!data) return;
  const s = checkSources(data, labels);
  const h = checkHexes(s.draft, evidenceText, sampled);
  chunks[target] = { draft: h.draft, warnings: [...s.warnings, ...h.warnings] };
};
// Same order as the app: the first call fills the prompt cache, then three at a time.
const [first, ...rest] = ASSEMBLE_TARGETS;
await draftOne(first);
for (let i = 0; i < rest.length; i += 3) await Promise.all(rest.slice(i, i + 3).map(draftOne));

const handBuilt = Object.fromEntries(
  readdirSync(kitDir(brand))
    .filter((f) => !f.startsWith("_") && f !== "tokens.css")
    .map((f) => [f, readFileSync(join(kitDir(brand), f), "utf8")]),
);

const run: ExtractRun = {
  runId,
  brand,
  createdAt: new Date().toISOString(),
  wallSeconds: (Date.now() - started) / 1000,
  uploads: checkFile.uploads.map((u) => ({ ...u, label: basename(u.file) })),
  sampled,
  evidence: notes,
  chunks,
  calls,
  checks: checkFile.checks,
  handBuilt,
};
writeFileSync(join(runDir, "run.json"), JSON.stringify(run, null, 2));
const summary = writeExtractReview(runDir, run);
console.log(`\n${summary}\nOpen ${join(runDir, "index.html")}`);
