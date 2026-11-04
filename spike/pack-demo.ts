// Packs a finished spike run into a demo brand's precomputed posts, so the app can show them
// with no API calls. Free: it only reads run.json. Takes each brief's final kit draft and its
// no-kit baseline, with the plan's and the draft's "why" notes.
//
// Usage: npx tsx spike/pack-demo.ts <run.json or run folder>
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { brandDir } from "./lib/paths.ts";
import { DemoPostsSchema, type DemoPosts } from "../core/demo.ts";
import type { PostRecord } from "./generate.ts";

const arg = process.argv[2];
if (!arg) throw new Error("Usage: npx tsx spike/pack-demo.ts <output/<run-id>/run.json>");
const runFile = statSync(arg).isDirectory() ? join(arg, "run.json") : arg;

type Run = {
  runId: string;
  brand: string;
  briefs: { id: string; intent: string; goal: string; details: string }[];
  posts: PostRecord[];
  totalUsd: number;
};
const run = JSON.parse(readFileSync(runFile, "utf8")) as Run;
if (!existsSync(brandDir(run.brand))) throw new Error(`No brand folder for "${run.brand}".`);

const version = (p: PostRecord | undefined) => {
  if (!p || p.error || !p.drafts.length) return null;
  const last = p.drafts.at(-1)!;
  return { template: p.plan.template, photo: p.photo, slots: last.slots, notes: [...p.plan.rationale, ...last.rationale] };
};

const posts: DemoPosts["posts"] = [];
for (const brief of run.briefs) {
  const kitRec = run.posts.find((p) => p.briefId === brief.id && p.variant === "kit");
  const kit = version(kitRec);
  if (!kit || !kitRec) {
    console.warn(`  skipped ${brief.id}: the kit post failed in this run`);
    continue;
  }
  const last = kitRec.drafts.at(-1)!;
  posts.push({
    briefId: brief.id,
    intent: brief.intent as DemoPosts["posts"][number]["intent"],
    goal: brief.goal.trim(),
    details: brief.details.trim(),
    kit: { ...kit, critique: last.critique ? { verdict: last.critique.verdict, summary: last.critique.summary } : null, drafts: kitRec.drafts.length },
    nokit: version(run.posts.find((p) => p.briefId === brief.id && p.variant === "nokit")),
  });
}

const packed = DemoPostsSchema.parse({
  brand: run.brand,
  sourceRun: run.runId ?? basename(join(runFile, "..")),
  packedAt: new Date().toISOString(),
  costUsd: Math.round(run.totalUsd * 100) / 100,
  posts,
});
const out = join(brandDir(run.brand), "demo-posts.json");
writeFileSync(out, JSON.stringify(packed, null, 2) + "\n");
console.log(`Packed ${posts.length} post(s) from run ${packed.sourceRun} into ${out}`);
