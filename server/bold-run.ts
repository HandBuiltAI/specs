// The bold pass's background work (see server/bold.ts). Runs in a Netlify background function,
// so a step may take minutes. Each run first checks the job's token and status, so a stray or
// repeated trigger (Netlify retries a failed background run) does nothing and spends nothing.
//
// Build: the art director's directions (prompts/directions.md); for a brand at energy 4–5, the
// image model's rough in parallel (prompts/sketch.md); then the designer builds the first two
// directions and rebuilds the rough (prompts/compose-bold.md, plus prompts/rebuild.md), each
// checked in code with one fix. The browser renders the survivors and probes them.
// Judge: the creative director (prompts/art-critique.md) sees every render blind, the post as
// first made included, and ranks them. The owner sees the top two.
import "server-only";
import { LIMITS } from "../core/limits.ts";
import { ComposeSchema, TEXT_SLOTS, type Composition, type TextSlot } from "../core/compose.ts";
import { ArtCritiqueSchema, DirectionsSchema, SKETCH_MIN_ENERGY, checkBold, energyLevel, fillEchoes, rankCandidates, type Direction } from "../core/bold.ts";
import { paintSketch, SKETCH_WORST_USD } from "../core/sketch.ts";
import { asData, fillPrompt } from "../core/prompts.ts";
import { formatChunks, parseChunks } from "../core/kit.ts";
import type { Image } from "../core/claude.ts";
import { CONTENT } from "./generated/content.ts";
import { guardedCall, type Deps } from "./handlers.ts";
import { Refusal } from "./http.ts";
import { reserve, settle } from "./spend.ts";
import { loadSession, type PostRecord, type Session } from "./sessions.ts";
import { kitFor, type KitSource } from "./kit-source.ts";
import { resolvePlan } from "./pipeline.ts";
import { loadJob, renderKey, updateJob, type BoldCandidate, type BoldJob, type BoldTrigger } from "./bold.ts";

const IMAGE_MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Runs one phase of a job. Never throws: failures are written to the job for the browser. */
export async function runBold(deps: Deps, t: BoldTrigger, geminiKey: string | undefined): Promise<void> {
  const job = await loadJob(deps.kv, t.sessionId, t.postId);
  if (!job || job.token !== t.token) return; // not a job we started
  // Claim the phase, so a repeated trigger (Netlify retries a failed background run) does nothing.
  const expected = t.phase === "build" ? "building" : "judging";
  let claimed = false;
  await updateJob(deps.kv, t.sessionId, t.postId, (j) => {
    if (j.status !== expected || j.ran.includes(t.phase)) return j;
    claimed = true;
    return { ...j, ran: [...j.ran, t.phase] };
  });
  if (!claimed) return;
  try {
    if (t.phase === "build") await build(deps, t, geminiKey);
    else await judge(deps, t);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Bold ${t.phase} failed:`, message);
    await updateJob(deps.kv, t.sessionId, t.postId, (j) => ({ ...j, status: "failed", stage: "Stopped", error: message.slice(0, 300) })).catch(() => {});
  }
}

type Inputs = {
  session: Session;
  post: PostRecord;
  kit: KitSource;
  slots: Record<TextSlot, string | null>;
  aspect: "1:1" | "4:5";
  photo: Image | null;
  photoAlt: string;
  logo: Image | null;
  chunks: ReturnType<typeof parseChunks>;
};

async function inputs(deps: Deps, t: BoldTrigger): Promise<Inputs> {
  const session = await loadSession(deps.kv, t.sessionId, deps.now());
  const post = session.posts[t.postId];
  if (!post?.written || !post.plan) throw new Error("The post isn't written.");
  const kit = await kitFor(deps, session, post.brand);
  const { template, photo } = resolvePlan(kit, post.plan);
  const pic = photo ? kit.photos.find((p) => p.file === photo) : undefined;
  let logo: Image | null = null;
  if (post.brand !== "session") {
    const png = CONTENT.brands[post.brand].logoPng;
    if (png) logo = { mediaType: "image/png", base64: png };
  } else {
    const up = session.uploads.find((u) => u.kind === "logo");
    const bytes = up && IMAGE_MEDIA.has(up.mediaType ?? "") ? await deps.kv.getBytes(`upload/${session.id}/${up.id}`) : null;
    if (up && bytes) logo = { mediaType: up.mediaType as Image["mediaType"], base64: Buffer.from(bytes).toString("base64") };
  }
  const blank = Object.fromEntries(TEXT_SLOTS.map((k) => [k, null])) as Record<TextSlot, string | null>;
  return {
    session,
    post,
    kit,
    slots: { ...blank, ...(post.written.slots as Partial<Record<TextSlot, string | null>>) },
    aspect: template.aspect as "1:1" | "4:5",
    photo: pic ? { mediaType: pic.mediaType, base64: pic.base64 } : null,
    photoAlt: pic ? asData(pic.alt) : "",
    logo,
    chunks: parseChunks(kit.files),
  };
}

const pick = (chunks: Inputs["chunks"], ids: string[]) => formatChunks(ids.flatMap((k) => (chunks.has(k) ? [chunks.get(k)!] : [])));

function copyOf(slots: Record<TextSlot, string | null>) {
  return TEXT_SLOTS.filter((s) => slots[s]).map((s) => `${s}: "${asData(slots[s]!)}" (${slots[s]!.length} characters)`).join("\n");
}

async function build(deps: Deps, t: BoldTrigger, geminiKey: string | undefined) {
  const x = await inputs(deps, t);
  const set = (change: (j: BoldJob) => BoldJob) => updateJob(deps.kv, t.sessionId, t.postId, change);
  const size = { width: 1080, height: x.aspect === "4:5" ? 1350 : 1080 };
  const canvas = `${size.width} × ${size.height} px (${x.aspect}). The brand's safe margin is var(--safe-margin).`;
  const copy = copyOf(x.slots);
  const business = x.kit.id === "session" ? asData(x.kit.businessName) : x.kit.businessName;
  const goal = asData(x.post.brief.goal);
  const designKit = pick(x.chunks, ["energy", "layout-system", "visual-system", "art-direction", "social-rules"]);
  const fullKit = pick(x.chunks, ["positioning-core", "energy", "layout-system", "visual-system", "art-direction", "social-rules", "guardrails"]);
  const photoLine = x.photo ? `The first image attached. ${x.photoAlt}` : "None.";
  const logoLine = x.logo
    ? `The ${x.photo ? "second" : "first"} image attached: the brand's real logo, placed by code in the wordmark slot.`
    : `No logo image; the wordmark slot gets the lockup lines: ${x.kit.wordmarkLines.map(asData).join(" / ")}.`;
  const refs = [...(x.photo ? [x.photo] : []), ...(x.logo ? [x.logo] : [])];

  // The image model's rough, when the brand is loud and the key is set.
  const sketchOn = Boolean(geminiKey) && Boolean(x.photo);
  const kitEnergy = energyLevel(x.chunks.get("energy")?.text);
  let sketchPromise: Promise<Image | null> | null = null;
  const startSketch = () => {
    sketchPromise = (async () => {
      await set((j) => ({ ...j, sketch: "running" }));
      const filled = fillPrompt("sketch", CONTENT.prompts.sketch, { take: "2", business_name: business, intent: x.post.intent, goal, copy, kit: designKit });
      const reservation = await reserve(deps.kv, deps.settings, deps.now(), SKETCH_WORST_USD);
      const r = await paintSketch({ apiKey: geminiKey!, text: `${filled.system}\n\n${filled.user}`, images: refs, aspect: x.aspect, timeoutMs: 120_000 });
      await settle(deps.kv, reservation, r.ok ? r.usd : r.billed ? SKETCH_WORST_USD : 0);
      if (!r.ok) {
        console.error("Bold sketch failed:", r.error);
        await set((j) => ({ ...j, sketch: "failed" }));
        return null;
      }
      return { mediaType: r.mediaType as Image["mediaType"], base64: r.base64 };
    })().catch(async (err) => {
      console.error("Bold sketch failed:", err instanceof Error ? err.message : String(err));
      await set((j) => ({ ...j, sketch: "failed" })).catch(() => {});
      return null;
    });
  };
  if (sketchOn && kitEnergy !== null && kitEnergy >= SKETCH_MIN_ENERGY) startSketch();

  // Directions.
  const dPrompt = fillPrompt("directions", CONTENT.prompts.directions, { kit: fullKit, business_name: business, intent: x.post.intent, goal, canvas, copy, photo: photoLine, logo: logoLine });
  const d = await guardedCall(deps, "directions", { ...dPrompt, images: refs }, DirectionsSchema);
  const energy = kitEnergy ?? Math.min(5, Math.max(1, Math.round(d.data.energy)));
  if (!sketchPromise && sketchOn && energy >= SKETCH_MIN_ENERGY) startSketch();
  const directions = d.data.directions.slice(0, LIMITS.boldDirections).map((dir, i) => ({ ...dir, label: "AB"[i]! }));
  await set((j) => ({ ...j, energy, stage: "Designing" }));

  // Build each direction, and the rough once it's painted.
  const usesPhotoOf = (html: string) => /data-slot=["']?photo/.test(html);
  async function design(label: string, name: string, idea: string, source: BoldCandidate["source"], direction: string, extraSystem: string, images: Image[], wantsPhoto: boolean): Promise<BoldCandidate | null> {
    let last: { c: Composition; errors: string[] } | null = null;
    let ranOut = false;
    for (let n = 1; n <= 2; n++) {
      const feedback = last
        ? `<previous_attempt_sent_back>\nYour previous HTML:\n${last.c.html}\n\nYour previous CSS:\n${last.c.css}\n\nProblems found by code:\n${last.errors.map((e) => `- ${e}`).join("\n")}\n</previous_attempt_sent_back>`
        : ranOut
          ? "<previous_attempt_sent_back>\nYour previous answer ran out of room before it finished. Build the same idea with leaner CSS: fewer layers, no repeated rules, short rationale notes.\n</previous_attempt_sent_back>"
          : "";
      const p = fillPrompt("compose-bold", CONTENT.prompts["compose-bold"], { kit: designKit, tokens: x.kit.tokensCss, business_name: business, intent: x.post.intent, goal, direction, canvas, copy, photo: wantsPhoto ? photoLine : "Not used in this direction.", logo: logoLine, feedback });
      let out;
      try {
        out = await guardedCall(deps, "compose_bold", { system: extraSystem ? `${p.system}\n\n${extraSystem}` : p.system, user: p.user, images }, ComposeSchema);
      } catch (err) {
        // A design that runs out of tokens (live, Nov 6) gets its second try, told to be leaner.
        if (n === 1 && err instanceof Refusal && err.code === "model_output") {
          console.error(`Bold build ${label} ran out of room; trying once more.`);
          ranOut = true;
          continue;
        }
        throw err;
      }
      const usesPhoto = Boolean(x.photo) && usesPhotoOf(out.data.html);
      const check = checkBold(out.data, x.slots, usesPhoto);
      if (check.ok) {
        return { label, name, idea, source, html: fillEchoes(out.data.html, x.slots).slice(0, 30000), css: out.data.css.slice(0, 30000), usesPhoto, rationale: out.data.rationale.slice(0, 12) };
      }
      last = { c: out.data, errors: check.errors };
    }
    return null;
  }
  const directionText = (dir: Direction & { label: string }) =>
    [`${dir.label}. ${dir.name}`, `Idea: ${dir.idea}`, `Hero: ${dir.hero}`, `Composition: ${dir.composition}`, `Treatments: ${dir.treatments.join(", ")}`, `Photo: ${x.photo && dir.uses_photo ? dir.photo_treatment : "Not used in this direction; leave the photo slot out."}`, `Logo: ${dir.logo}`, `Breaks on purpose: ${dir.breaks}`].join("\n");
  const tasks: Promise<BoldCandidate | null>[] = directions.map((dir) =>
    design(dir.label, dir.name, dir.idea, "direction", directionText(dir), "", [...(x.photo && dir.uses_photo ? [x.photo] : []), ...(x.logo ? [x.logo] : [])], Boolean(x.photo) && dir.uses_photo).catch((err) => {
      console.error(`Bold build ${dir.label} failed:`, err instanceof Error ? err.message : String(err));
      return null;
    }),
  );
  if (sketchPromise) {
    tasks.push(
      (sketchPromise as Promise<Image | null>).then(async (rough) => {
        if (!rough) return null;
        // Claude reads JPEG, PNG, GIF and WebP; Gemini answers in one of those.
        const r = fillPrompt("rebuild", CONTENT.prompts.rebuild, {});
        const c = await design("S", "From a painted rough", "The image model's rough, rebuilt with the kit's own type and colors", "sketch", r.user, r.system, [...refs, rough], Boolean(x.photo)).catch((err) => {
          console.error("Bold rebuild failed:", err instanceof Error ? err.message : String(err));
          return null;
        });
        await set((j) => ({ ...j, sketch: c ? "used" : "failed" }));
        return c;
      }),
    );
  }
  const built = (await Promise.all(tasks)).filter((c): c is BoldCandidate => c !== null);
  await set((j) =>
    built.length
      ? { ...j, status: "rendering", stage: "Checking the layouts", candidates: built }
      : { ...j, status: "done", stage: "No bolder version passed the checks", candidates: [], ranking: { order: ["quick"], winner: "quick", why: "None of the bolder layouts passed the checks, so the post stays as it was.", notes: {}, factConflicts: d.data.fact_conflicts } },
  );
}

async function judge(deps: Deps, t: BoldTrigger) {
  const x = await inputs(deps, t);
  const job = (await loadJob(deps.kv, t.sessionId, t.postId))!;
  // Only renders the probe passed are judged; the post as first made always is.
  const labels = ["quick", ...job.candidates.map((c) => c.label)].filter((l) => job.renders[l] && (l === "quick" || job.renders[l]!.issues === 0));
  const images: Image[] = [];
  const kept: string[] = [];
  for (const l of labels) {
    const bytes = await deps.kv.getBytes(renderKey(t.sessionId, t.postId, l));
    if (!bytes) continue;
    kept.push(l);
    images.push({ mediaType: "image/jpeg", base64: Buffer.from(bytes).toString("base64") });
  }
  if (kept.length < 2) {
    await updateJob(deps.kv, t.sessionId, t.postId, (j) => ({ ...j, status: "done", stage: "Done", ranking: { order: kept.length ? kept : ["quick"], winner: kept[0] ?? "quick", why: "Only one post passed the checks.", notes: {}, factConflicts: [] } }));
    return;
  }
  // Blind: shuffled numbers.
  const order = kept.map((l) => ({ l, k: Math.random() })).sort((a, b) => a.k - b.k).map((o) => o.l);
  // Each image carries its number as text, and the list says which use the owner's photo
  // (live, Nov 6: the critic mixed up three unlabeled images and called a photo post "no photo").
  const shuffled = order.map((l, i) => ({ ...images[kept.indexOf(l)]!, label: `Candidate ${i + 1}:` }));
  const usesPhoto = (l: string) => (l === "quick" ? Boolean(x.photo) : Boolean(job.candidates.find((c) => c.label === l)?.usesPhoto));
  const business = x.kit.id === "session" ? asData(x.kit.businessName) : x.kit.businessName;
  const prompt = fillPrompt("art-critique", CONTENT.prompts["art-critique"], {
    kit: pick(x.chunks, ["positioning-core", "energy", "layout-system", "visual-system", "art-direction", "social-rules", "guardrails"]),
    business_name: business,
    intent: x.post.intent,
    goal: asData(x.post.brief.goal),
    copy: copyOf(x.slots),
    candidates: order.map((l, i) => `Candidate ${i + 1} (image ${i + 1}). Passed every code check. ${usesPhoto(l) ? "Uses the owner's photo." : "No photo."}`).join("\n"),
  });
  let critique = (await guardedCall(deps, "art_critique", { ...prompt, images: shuffled }, ArtCritiqueSchema)).data;
  const scored = () => new Set(critique.candidates.map((c) => c.label.replace(/\D/g, "")));
  if (!order.every((_, i) => scored().has(String(i + 1)))) {
    critique = (await guardedCall(deps, "art_critique", { ...prompt, images: shuffled }, ArtCritiqueSchema)).data;
  }
  const byNumber = (n: string) => order[Number(n) - 1];
  const ranked = rankCandidates(critique).map(byNumber).filter((l): l is string => Boolean(l));
  for (const l of order) if (!ranked.includes(l)) ranked.push(l);
  const notes = Object.fromEntries(critique.candidates.flatMap((c) => {
    const l = byNumber(c.label.replace(/\D/g, ""));
    return l ? [[l, c.notes.slice(0, 400)]] : [];
  }));
  await updateJob(deps.kv, t.sessionId, t.postId, (j) => ({
    ...j,
    status: "done",
    stage: "Done",
    ranking: { order: ranked, winner: ranked[0]!, why: critique.why.slice(0, 600), notes, factConflicts: critique.fact_conflicts.slice(0, 4).map((f) => f.slice(0, 300)) },
  }));
}
