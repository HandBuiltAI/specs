// POST /api/posts/compose: designs one written post's layout from the kit's layout-system chunk.
// The browser renders the result and runs LAYOUT_PROBE on it; if the probe finds problems it
// sends them back here (as codes and numbers, never text) for one fixing call. After that, or
// when the kit has no layout chunk, the browser shows the template. Each call is its own
// request, so neither comes near the function's time limit.
import "server-only";
import { z } from "zod";
import { LIMITS } from "../core/limits.ts";
import { ComposeSchema, ProbeReportSchema, TEXT_SLOTS, checkComposition, probeText, type TextSlot } from "../core/compose.ts";
import { asData, fillPrompt } from "../core/prompts.ts";
import { formatChunks, parseChunks } from "../core/kit.ts";
import { canvasSize } from "../core/templates.ts";
import type { Image } from "../core/claude.ts";
import { CONTENT } from "./generated/content.ts";
import { Refusal, json, readJson } from "./http.ts";
import { assertGenerationOpen } from "./spend.ts";
import { loadSession, updateSession, type PostRecord } from "./sessions.ts";
import { guardedCall, notBilled, parseBody, id, type Deps } from "./handlers.ts";
import { kitFor, type KitSource } from "./kit-source.ts";
import { resolvePlan } from "./pipeline.ts";

export const COMPOSE_ATTEMPTS = 2;
const KIT_IDS = ["layout-system", "visual-system", "art-direction", "social-rules"];

const ComposeBody = z.strictObject({ sessionId: id, postId: id, issues: z.array(ProbeReportSchema).max(20).optional() });

export function composePrompt(kit: KitSource, post: PostRecord, feedback: string) {
  const chunks = parseChunks(kit.files);
  if (!chunks.has("layout-system")) throw new Refusal(409, "no_layout", "This kit has no layout chunk, so this post uses its template.");
  const { template, photo } = resolvePlan(kit, post.plan!);
  const size = canvasSize(template);
  const slots = post.written!.slots;
  const copy = TEXT_SLOTS.filter((s) => slots[s]).map((s) => `${s}: "${asData(slots[s]!)}" (${slots[s]!.length} characters)`).join("\n");
  const pic = photo ? kit.photos.find((p) => p.file === photo) : undefined;
  const images: Image[] = pic ? [{ mediaType: pic.mediaType, base64: pic.base64 }] : [];
  const prompt = fillPrompt("compose", CONTENT.prompts.compose, {
    kit: formatChunks(KIT_IDS.flatMap((k) => (chunks.has(k) ? [chunks.get(k)!] : []))),
    tokens: kit.tokensCss,
    business_name: asData(kit.businessName),
    intent: post.intent,
    goal: asData(post.brief.goal),
    angle: asData(post.plan!.angle),
    canvas: `${size.width} × ${size.height} px (${template.aspect}). The brand's safe margin is var(--safe-margin).`,
    copy,
    photo: pic ? `Attached above. ${asData(pic.alt)}` : "None. This post has no photo; don't include a photo slot.",
    feedback,
  });
  return { prompt: { ...prompt, images }, slots, hasPhoto: Boolean(pic), aspect: template.aspect };
}

export async function composePost(req: Request, deps: Deps) {
  const body = parseBody(ComposeBody, await readJson(req, LIMITS.jsonBodyBytes));
  const now = deps.now();
  await assertGenerationOpen(deps.kv, deps.settings, now);
  const session = await loadSession(deps.kv, body.sessionId, now);
  const existing = session.posts[body.postId];
  if (!existing) throw new Refusal(404, "no_post", "There's no such post in this session.");
  if (existing.status !== "written") throw new Refusal(409, "not_ready", `This post can't be laid out now (it's ${existing.status}).`);
  const kit = await kitFor(deps, session, existing.brand);

  // Claim the call before making it, so two tabs can't spend past the cap.
  let post!: PostRecord;
  await updateSession(deps.kv, body.sessionId, (s) => {
    const p = s.posts[body.postId]!;
    const c = p.compose ?? { attempts: 0, running: false };
    if (c.running) throw new Refusal(409, "busy", "This post's layout is already being made.");
    if (c.attempts >= COMPOSE_ATTEMPTS) throw new Refusal(429, "compose_cap", "This post has had its two layout tries; it uses its template.");
    post = { ...p, compose: { ...c, attempts: c.attempts + 1, running: true } };
    return { ...s, posts: { ...s.posts, [p.id]: post } };
  });
  const release = (change: (c: NonNullable<PostRecord["compose"]>) => NonNullable<PostRecord["compose"]>) =>
    updateSession(deps.kv, body.sessionId, (s) => ({ ...s, posts: { ...s.posts, [post.id]: { ...s.posts[post.id]!, compose: change(s.posts[post.id]!.compose!) } } }));

  const last = post.compose!.last;
  const problems = [...(last?.errors ?? []), ...(body.issues ?? []).map(probeText)];
  const feedback = last
    ? `<previous_attempt_sent_back>\nYour previous HTML:\n${last.html}\n\nYour previous CSS:\n${last.css}\n\nProblems found by code:\n${problems.map((e) => `- ${e}`).join("\n") || "- none listed"}\n</previous_attempt_sent_back>`
    : "";

  let built, result;
  try {
    built = composePrompt(kit, post, feedback);
    result = await guardedCall(deps, "compose", built.prompt, ComposeSchema);
  } catch (err) {
    // A refusal before the call (no layout chunk) or an unbilled failure gives the try back.
    const refund = notBilled(err);
    await release((c) => ({ ...c, running: false, attempts: c.attempts - (refund ? 1 : 0) }));
    throw err;
  }
  const check = checkComposition(result.data, built.slots as Partial<Record<TextSlot, string | null>>, built.hasPhoto);
  await release((c) => ({ ...c, running: false, last: { html: result.data.html.slice(0, 20000), css: result.data.css.slice(0, 20000), errors: check.errors } }));
  return json({
    ok: check.ok,
    errors: check.errors,
    composition: check.ok ? result.data : null,
    aspect: built.aspect,
    attemptsLeft: COMPOSE_ATTEMPTS - post.compose!.attempts,
  });
}
