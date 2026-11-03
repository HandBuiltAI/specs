// The API's request handlers. Each one takes its dependencies as an argument so the tests can
// run every guard without Netlify, Cloudflare or Claude. Guards run cheapest first: body shape
// and size, then the kill switch and tripwire, then the session and its caps, then the spend
// reservation, and only then the call to Claude.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LIMITS, POST_INTENTS, charCount } from "../core/limits.ts";
import { PlanSchema, WriteSchema } from "../core/schemas.ts";
import { StepError, worstCaseUsd, type Image, type Usage } from "../core/claude.ts";
import type { StepName } from "../core/config.ts";
import { DEMO_BRAND_IDS } from "./generated/content.ts";
import { Refusal, json, readJson, clientIp, hashIp } from "./http.ts";
import type { KV } from "./store.ts";
import type { Settings } from "./settings.ts";
import { assertGenerationOpen, generationState, reserve, settle, dayKey } from "./spend.ts";
import type { VerifyTurnstile } from "./turnstile.ts";
import type { CallStep } from "./claude.ts";
import { createSession, loadSession, updateSession, claimIpSlot, type PostRecord, type UploadRecord } from "./sessions.ts";
import { planPrompt, resolvePlan, writePrompt, cleanWritten, estimateInputTokens } from "./pipeline.ts";
import { checkImage, checkPdf, checkUrl } from "./uploads.ts";

export type Deps = { kv: KV; settings: Settings; now: () => Date; verifyTurnstile: VerifyTurnstile; callStep: CallStep };

// ---------- body shape ----------

/** Field names that mean someone is trying to hand the server a prompt or model settings. */
const PROMPT_FIELDS = new Set([
  "prompt", "system", "messages", "message", "model", "max_tokens", "maxtokens", "temperature", "top_p", "top_k",
  "instructions", "tools", "tool_choice", "stop_sequences", "thinking", "output_config", "betas", "content", "input",
]);

const RAW_PROMPT = new Refusal(
  400,
  "raw_prompt_refused",
  "This endpoint doesn't take prompts or model settings. Send the structured fields only; the server writes every prompt.",
);

function refuseRawPrompt(fields: string[]) {
  if (fields.some((f) => PROMPT_FIELDS.has(f.toLowerCase()))) throw RAW_PROMPT;
}

function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  if (typeof body === "string" || Array.isArray(body)) throw RAW_PROMPT;
  if (body && typeof body === "object") {
    refuseRawPrompt(Object.keys(body));
    const brief = (body as Record<string, unknown>).brief;
    if (brief && typeof brief === "object") refuseRawPrompt(Object.keys(brief));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.join(".") || "body";
    if (issue.code === "unrecognized_keys") throw new Refusal(400, "unexpected_fields", `Unexpected field(s): ${issue.keys.join(", ")}.`);
    if (issue.code === "custom" && issue.message === "too_long") {
      throw new Refusal(400, "message_too_long", `"${where}" is capped at ${LIMITS.messageChars} characters.`);
    }
    throw new Refusal(400, "bad_fields", `"${where}": ${issue.message}`);
  }
  return parsed.data;
}

const freeText = z.string().refine((s) => charCount(s) <= LIMITS.messageChars, { message: "too_long" });
const id = z.string().min(1).max(64);

const StartSessionBody = z.strictObject({ turnstileToken: z.string().min(1).max(4096) });
const CreatePostBody = z.strictObject({
  sessionId: id,
  brand: z.enum(DEMO_BRAND_IDS),
  intent: z.enum(POST_INTENTS),
  brief: z.strictObject({ goal: freeText.refine((s) => s.trim().length > 0, { message: "Required." }), details: freeText }),
  regenerationOf: id.optional(),
});
const WritePostBody = z.strictObject({ sessionId: id, postId: id });

// ---------- one guarded Claude call ----------

/** True when the request never reached the model, so nothing was billed. */
const notBilled = (err: unknown) => err instanceof Refusal || (err instanceof Anthropic.APIError && typeof err.status === "number");

async function guardedCall<S extends z.ZodType>(deps: Deps, step: StepName, prompt: { system: string; user: string; images?: Image[] }, schema: S) {
  const worst = worstCaseUsd(step, estimateInputTokens(prompt));
  const reservation = await reserve(deps.kv, deps.settings, deps.now(), worst);
  let result: { data: z.infer<S>; usage: Usage };
  try {
    result = await deps.callStep({ step, ...prompt, schema });
  } catch (err) {
    // Count what the call cost: its usage if it got a response, nothing if the API turned it
    // away, and the worst case if it timed out or the connection dropped mid-answer.
    const usd = err instanceof StepError ? err.usage.usd : notBilled(err) ? 0 : worst;
    await settle(deps.kv, reservation, usd);
    if (err instanceof StepError) {
      throw err.kind === "refusal"
        ? new Refusal(422, "model_declined", "The model declined this brief. Try rewording it.")
        : new Refusal(502, "model_output", "The model's answer came back incomplete. Try again.");
    }
    if (err instanceof Refusal) throw err;
    throw new Refusal(502, "model_unavailable", "Claude didn't answer in time. Try again in a minute.");
  }
  await settle(deps.kv, reservation, result.usage.usd);
  return result;
}

// ---------- handlers ----------

export async function getStatus(deps: Deps) {
  return json({ generation: await generationState(deps.kv, deps.settings, deps.now()), limits: LIMITS });
}

export async function startSession(req: Request, deps: Deps) {
  const body = parseBody(StartSessionBody, await readJson(req, LIMITS.jsonBodyBytes));
  const now = deps.now();
  await assertGenerationOpen(deps.kv, deps.settings, now);

  const ip = clientIp(req);
  if (!(await deps.verifyTurnstile(body.turnstileToken, ip))) {
    throw new Refusal(403, "bot_check_failed", "The bot check didn't pass. Reload the page and try again.");
  }
  const ipHash = hashIp(ip, deps.settings.ipHashSalt!);
  await claimIpSlot(deps.kv, ipHash, dayKey(now));
  const session = await createSession(deps.kv, ipHash, now);
  return json(
    { sessionId: session.id, expiresAt: session.expiresAt, limits: { posts: LIMITS.postsPerSession, regenerations: LIMITS.regenerationsPerSession } },
    201,
  );
}

const UPLOAD_FIELDS = new Set(["sessionId", "kind", "file", "url"]);
// The biggest file plus room for the form's other fields.
const MAX_UPLOAD_BODY = Math.max(LIMITS.imageBytes, LIMITS.pdfBytes) + 64 * 1024;

export async function upload(req: Request, deps: Deps) {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    throw new Refusal(415, "multipart_only", "Upload one file or URL per request as multipart/form-data.");
  }
  if (Number(req.headers.get("content-length") ?? "0") > MAX_UPLOAD_BODY) {
    throw new Refusal(413, "upload_too_large", `Uploads are capped at ${Math.round(LIMITS.imageBytes / 1024 / 1024)} MB per file.`);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new Refusal(400, "bad_form", "The upload couldn't be read.");
  }
  const fields = [...new Set(form.keys())];
  refuseRawPrompt(fields);
  const extra = fields.filter((f) => !UPLOAD_FIELDS.has(f));
  if (extra.length) throw new Refusal(400, "unexpected_fields", `Unexpected field(s): ${extra.join(", ")}.`);
  if (form.getAll("file").length > 1 || form.getAll("url").length > 1) {
    throw new Refusal(400, "one_per_request", "Send one file or one URL per request.");
  }

  const kind = form.get("kind");
  const file = form.get("file");
  const rawUrl = form.get("url");
  const uploadId = crypto.randomUUID();
  let record: UploadRecord;
  // Check the upload itself before touching the session, so over-cap files are refused cheaply.
  if (kind === "image" || kind === "pdf") {
    if (!(file instanceof File)) throw new Refusal(400, "bad_fields", `"file" is required for kind "${kind}".`);
    record = kind === "image" ? { id: uploadId, kind, ...(await checkImage(file)) } : { id: uploadId, kind, ...(await checkPdf(file)) };
  } else if (kind === "url") {
    if (typeof rawUrl !== "string") throw new Refusal(400, "bad_fields", `"url" is required for kind "url".`);
    record = { id: uploadId, kind, url: checkUrl(rawUrl) };
  } else {
    throw new Refusal(400, "bad_fields", `"kind" must be "image", "pdf" or "url".`);
  }

  const sessionId = String(form.get("sessionId") ?? "");
  const now = deps.now();
  await loadSession(deps.kv, sessionId, now);
  const caps = { image: LIMITS.imageCount, pdf: LIMITS.pdfCount, url: LIMITS.urlCount };
  const names = { image: "photos", pdf: "PDF", url: "website address" };
  const session = await updateSession(deps.kv, sessionId, (s) => {
    const have = s.uploads.filter((u) => u.kind === record.kind).length;
    if (have >= caps[record.kind]) {
      throw new Refusal(409, "upload_cap", `A session takes ${caps[record.kind]} ${names[record.kind]} at most, and this one has ${have}.`);
    }
    return { ...s, uploads: [...s.uploads, record] };
  });
  if (file instanceof File) {
    await deps.kv.putBytes(`upload/${sessionId}/${uploadId}`, await file.arrayBuffer(), { kind: record.kind, bytes: file.size });
  }
  const count = (k: UploadRecord["kind"]) => session.uploads.filter((u) => u.kind === k).length;
  return json({ upload: record, counts: { image: count("image"), pdf: count("pdf"), url: count("url") } }, 201);
}

export async function createPost(req: Request, deps: Deps) {
  const body = parseBody(CreatePostBody, await readJson(req, LIMITS.jsonBodyBytes));
  const now = deps.now();
  await assertGenerationOpen(deps.kv, deps.settings, now);
  await loadSession(deps.kv, body.sessionId, now);

  // Claim a post (or the one regeneration) before calling Claude, so parallel requests can't overshoot.
  const postId = crypto.randomUUID();
  const regenerationOf = body.regenerationOf ?? null;
  const claimed = await updateSession(deps.kv, body.sessionId, (s) => {
    if (regenerationOf) {
      if (!s.posts[regenerationOf]) throw new Refusal(404, "no_post", "There's no such post in this session to regenerate.");
      if (s.regenerationsUsed >= LIMITS.regenerationsPerSession) {
        throw new Refusal(429, "regeneration_cap", `A session gets ${LIMITS.regenerationsPerSession} regeneration, and it's been used.`);
      }
    } else if (s.postsUsed >= LIMITS.postsPerSession) {
      throw new Refusal(429, "post_cap", `A session makes ${LIMITS.postsPerSession} posts, and they've all been made.`);
    }
    const post: PostRecord = { id: postId, brand: body.brand, intent: body.intent, brief: body.brief, regenerationOf, status: "planning", warnings: [] };
    return {
      ...s,
      postsUsed: s.postsUsed + (regenerationOf ? 0 : 1),
      regenerationsUsed: s.regenerationsUsed + (regenerationOf ? 1 : 0),
      posts: { ...s.posts, [postId]: post },
    };
  });

  let planned;
  try {
    planned = await guardedCall(deps, "plan", planPrompt(body.brand, body.intent, body.brief), PlanSchema);
  } catch (err) {
    // Give the slot back only if nothing was spent; otherwise the post counts.
    const refund = notBilled(err);
    await updateSession(deps.kv, body.sessionId, (s) => ({
      ...s,
      postsUsed: s.postsUsed - (refund && !regenerationOf ? 1 : 0),
      regenerationsUsed: s.regenerationsUsed - (refund && regenerationOf ? 1 : 0),
      posts: { ...s.posts, [postId]: { ...s.posts[postId]!, status: "failed" } },
    }));
    throw err;
  }

  const { template, photo, warnings } = resolvePlan(body.brand, planned.data);
  const session = await updateSession(deps.kv, body.sessionId, (s) => ({
    ...s,
    posts: { ...s.posts, [postId]: { ...s.posts[postId]!, status: "planned", plan: planned.data, photo, warnings } },
  }));
  return json(
    {
      postId,
      plan: { template: template.id, photo, angle: planned.data.angle, rationale: planned.data.rationale },
      warnings,
      ...remaining(session.postsUsed, session.regenerationsUsed),
    },
    201,
  );
}

export async function writePost(req: Request, deps: Deps) {
  const body = parseBody(WritePostBody, await readJson(req, LIMITS.jsonBodyBytes));
  const now = deps.now();
  await assertGenerationOpen(deps.kv, deps.settings, now);
  await loadSession(deps.kv, body.sessionId, now);

  // Each plan gets written once; claiming "writing" stops a second, parallel write.
  let post!: PostRecord;
  await updateSession(deps.kv, body.sessionId, (s) => {
    const p = s.posts[body.postId];
    if (!p) throw new Refusal(404, "no_post", "There's no such post in this session.");
    if (p.status !== "planned") throw new Refusal(409, "not_ready", `This post can't be written now (it's ${p.status}).`);
    post = { ...p, status: "writing" };
    return { ...s, posts: { ...s.posts, [p.id]: post } };
  });

  const { template, photo } = resolvePlan(post.brand, post.plan!);
  let written;
  try {
    written = await guardedCall(deps, "write", writePrompt(post.brand, post.intent, post.brief, post.plan!, photo), WriteSchema);
  } catch (err) {
    const back = notBilled(err) ? "planned" : "failed";
    await updateSession(deps.kv, body.sessionId, (s) => ({ ...s, posts: { ...s.posts, [post.id]: { ...s.posts[post.id]!, status: back } } }));
    throw err;
  }

  const cleaned = cleanWritten(template, written.data);
  const warnings = [...post.warnings, ...cleaned.warnings];
  await updateSession(deps.kv, body.sessionId, (s) => ({
    ...s,
    posts: { ...s.posts, [post.id]: { ...s.posts[post.id]!, status: "written", written: cleaned.written, warnings } },
  }));
  return json({ postId: post.id, template: template.id, photo, slots: cleaned.written.slots, rationale: cleaned.written.rationale, warnings });
}

const remaining = (posts: number, regens: number) => ({
  postsLeft: LIMITS.postsPerSession - posts,
  regenerationsLeft: LIMITS.regenerationsPerSession - regens,
});
