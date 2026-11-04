// The Make posts screen's other two requests for a live session's own kit:
//   POST /api/kit/files  the kit as files (for rendering posts and the zip), with its photos' ids
//   POST /api/posts/baseline  the same brief written with no kit, once per post
import "server-only";
import { z } from "zod";
import { LIMITS } from "../core/limits.ts";
import { WriteSchema } from "../core/schemas.ts";
import { Refusal, json, readJson } from "./http.ts";
import { CONTENT } from "./generated/content.ts";
import { assertGenerationOpen } from "./spend.ts";
import { loadSession, updateSession } from "./sessions.ts";
import { guardedCall, notBilled, parseBody, id, type Deps } from "./handlers.ts";
import { kitFor, sessionKit } from "./kit-source.ts";
import { baselinePrompt, cleanWritten } from "./pipeline.ts";

const KitBody = z.strictObject({ sessionId: id });
const BaselineBody = z.strictObject({ sessionId: id, postId: id });

export async function kitFiles(req: Request, deps: Deps) {
  const body = parseBody(KitBody, await readJson(req, LIMITS.jsonBodyBytes));
  const session = await loadSession(deps.kv, body.sessionId, deps.now());
  const kit = await sessionKit(deps, session);
  return json({
    businessName: kit.businessName,
    files: kit.files,
    tokensCss: kit.tokensCss,
    wordmarkLines: kit.wordmarkLines,
    fontsHref: kit.fontsHref,
    templates: CONTENT.templates,
    templatesManifest: CONTENT.templatesManifest,
    baseCss: CONTENT.baseCss,
    neutralTokensCss: CONTENT.neutralTokensCss,
    photos: kit.photos.map((p) => ({ file: p.file, uploadId: p.uploadId })),
  });
}

export async function baselinePost(req: Request, deps: Deps) {
  const body = parseBody(BaselineBody, await readJson(req, LIMITS.jsonBodyBytes));
  const now = deps.now();
  const session = await loadSession(deps.kv, body.sessionId, now);
  const existing = session.posts[body.postId];
  if (!existing) throw new Refusal(404, "no_post", "There's no such post in this session.");
  if (existing.baseline?.status === "done") return json(view(existing.baseline));
  if (existing.status !== "written") throw new Refusal(409, "not_ready", `This post's without-kit version can't be made now (it's ${existing.status}).`);
  await assertGenerationOpen(deps.kv, deps.settings, now);
  const kit = await kitFor(deps, session, existing.brand);

  await updateSession(deps.kv, body.sessionId, (s) => {
    const p = s.posts[body.postId]!;
    if (p.baseline) throw new Refusal(409, "busy", "This post's without-kit version is already being made.");
    return { ...s, posts: { ...s.posts, [p.id]: { ...p, baseline: { status: "running" } } } };
  });
  const built = baselinePrompt(kit, existing.intent, existing.brief, existing.photo ?? null);
  let written;
  try {
    written = await guardedCall(deps, "write", built.prompt, WriteSchema);
  } catch (err) {
    // Unbilled failures can be tried again; a billed one stays used up, so the toggle just stays off.
    const back = notBilled(err) ? undefined : { status: "done" as const };
    await updateSession(deps.kv, body.sessionId, (s) => ({ ...s, posts: { ...s.posts, [body.postId]: { ...s.posts[body.postId]!, baseline: back } } }));
    throw err;
  }
  const cleaned = cleanWritten(built.template, written.data).written;
  const baseline = { status: "done" as const, template: built.template.id, photo: built.photo, written: cleaned };
  await updateSession(deps.kv, body.sessionId, (s) => ({ ...s, posts: { ...s.posts, [body.postId]: { ...s.posts[body.postId]!, baseline } } }));
  return json(view(baseline));
}

const view = (b: NonNullable<import("./sessions.ts").PostRecord["baseline"]>) =>
  b.written ? { template: b.template, photo: b.photo ?? null, slots: b.written.slots, rationale: b.written.rationale } : { template: null, photo: null, slots: null, rationale: [] };
