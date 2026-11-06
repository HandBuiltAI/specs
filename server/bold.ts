// The bold pass (spec, "Bolder posts", Nov 6): after a post is made the quick way, the owner
// can ask for a bolder version once per visit. The work takes minutes, so it runs in a
// background function (netlify/functions/bold-background.mts, up to 15 minutes), and the
// browser follows it with short requests:
//
//   POST /api/posts/bold/start   claims the session's one bold pass and starts the build
//   POST /api/posts/bold/status  the job as it stands (stage, candidates, ranking)
//   POST /api/posts/bold/render  the browser's render of one candidate (a JPEG) and its probe result
//   POST /api/posts/bold/judge   once every candidate is rendered, starts the critic
//
// The background run (server/bold-run.ts) checks a per-job token before doing anything, so
// only a job this file started can spend money. Every model call is reserved against the daily
// cap first, like every other call.
import "server-only";
import { z } from "zod";
import { LIMITS } from "../core/limits.ts";
import { ProbeReportSchema } from "../core/compose.ts";
import { Refusal, json, readJson } from "./http.ts";
import { assertGenerationOpen } from "./spend.ts";
import { loadSession, updateSession } from "./sessions.ts";
import { parseBody, id, type Deps } from "./handlers.ts";
import { update, type KV } from "./store.ts";

export type BoldCandidate = {
  /** "A", "B" for the art director's directions, "S" for the image model's rough rebuilt. */
  label: string;
  name: string;
  idea: string;
  source: "direction" | "sketch";
  /** Echoes already filled in; slots still empty (the browser fills them like any composition). */
  html: string;
  css: string;
  usesPhoto: boolean;
  rationale: { decision: string; choice: string; reason: string; cites: string[] }[];
};

export type BoldJob = {
  status: "building" | "rendering" | "judging" | "done" | "failed";
  /** Shared only with the background function, never sent to the browser. */
  token: string;
  startedAt: string;
  updatedAt: string;
  /** What's happening now, in a few words, for the working line. */
  stage: string;
  energy: number | null;
  sketch: "none" | "running" | "used" | "failed";
  /** Phases the background run has claimed, so each runs once. */
  ran: ("build" | "judge")[];
  candidates: BoldCandidate[];
  /** Labels the browser has rendered ("quick" is the post as first made), with how many probe issues each had. */
  renders: Record<string, { issues: number }>;
  /** Best first, after the critic: labels, including "quick". */
  ranking?: { order: string[]; winner: string; why: string; notes: Record<string, string>; factConflicts: string[] };
  error?: string;
};

export type BoldTrigger = { sessionId: string; postId: string; token: string; phase: "build" | "judge" };
/** Starts the background run. Live: a request to the background function. Tests and local dev: in-process. */
export type StartBackground = (t: BoldTrigger) => Promise<void>;

export const boldKey = (sessionId: string, postId: string) => `bold/${sessionId}/${postId}`;
export const renderKey = (sessionId: string, postId: string, label: string) => `bold/${sessionId}/${postId}/render/${label}`;
const LABEL = z.string().regex(/^(quick|[A-Z])$/);

const PostBody = z.strictObject({ sessionId: id, postId: id });
const RenderBody = z.strictObject({
  sessionId: id,
  postId: id,
  label: LABEL,
  /** A JPEG as base64, without the data: prefix. */
  jpeg: z.string().max(Math.ceil((LIMITS.boldRenderBytes * 4) / 3) + 8),
  issues: z.array(ProbeReportSchema).max(20),
});

export async function loadJob(kv: KV, sessionId: string, postId: string) {
  return (await kv.get<BoldJob>(boldKey(sessionId, postId)))?.value ?? null;
}

export function updateJob(kv: KV, sessionId: string, postId: string, change: (j: BoldJob) => BoldJob) {
  return update<BoldJob>(kv, boldKey(sessionId, postId), () => {
    throw new Refusal(404, "no_bold", "This post has no bold version in the works.");
  }, (j) => ({ ...change(j), updatedAt: new Date().toISOString() }));
}

/** What the browser sees: no token. */
export function jobView(j: BoldJob) {
  const { token: _token, ...rest } = j;
  return rest;
}

export async function startBold(req: Request, deps: Deps, startBackground: StartBackground) {
  const body = parseBody(PostBody, await readJson(req, LIMITS.jsonBodyBytes));
  const now = deps.now();
  await assertGenerationOpen(deps.kv, deps.settings, now);
  const session = await loadSession(deps.kv, body.sessionId, now);
  const post = session.posts[body.postId];
  if (!post) throw new Refusal(404, "no_post", "There's no such post in this session.");
  if (post.status !== "written") throw new Refusal(409, "not_ready", `This post can't get a bolder version yet (it's ${post.status}).`);
  const existing = await loadJob(deps.kv, body.sessionId, body.postId);
  if (existing) return json(jobView(existing));

  // Claim the session's one bold pass before any work, so two tabs can't both take it.
  await updateSession(deps.kv, body.sessionId, (s) => {
    const used = s.boldUsed ?? 0;
    if (used >= LIMITS.boldPerSession) throw new Refusal(429, "bold_cap", "Each visit gets one bolder version, and this one's been used.");
    return { ...s, boldUsed: used + 1 };
  });
  const job: BoldJob = {
    status: "building",
    token: crypto.randomUUID(),
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    stage: "Finding ideas",
    energy: null,
    sketch: "none",
    ran: [],
    candidates: [],
    renders: {},
  };
  if (!(await deps.kv.put(boldKey(body.sessionId, body.postId), job, { ifNew: true }))) {
    const j = await loadJob(deps.kv, body.sessionId, body.postId);
    return json(j ? jobView(j) : null);
  }
  try {
    await startBackground({ sessionId: body.sessionId, postId: body.postId, token: job.token, phase: "build" });
  } catch (err) {
    // Nothing ran, so the visit keeps its bold pass.
    await deps.kv.put(boldKey(body.sessionId, body.postId), { ...job, status: "failed", error: "start_failed" }, { ifMatch: (await deps.kv.get(boldKey(body.sessionId, body.postId)))!.etag });
    await updateSession(deps.kv, body.sessionId, (s) => ({ ...s, boldUsed: Math.max(0, (s.boldUsed ?? 1) - 1) }));
    console.error("Bold pass didn't start:", err instanceof Error ? err.message : String(err));
    throw new Refusal(503, "bold_unavailable", "The bolder version couldn't start. Try again in a minute.");
  }
  return json(jobView(job), 202);
}

export async function boldStatus(req: Request, deps: Deps) {
  const body = parseBody(PostBody, await readJson(req, LIMITS.jsonBodyBytes));
  await loadSession(deps.kv, body.sessionId, deps.now());
  const job = await loadJob(deps.kv, body.sessionId, body.postId);
  if (!job) throw new Refusal(404, "no_bold", "This post has no bold version in the works.");
  return json(jobView(job));
}

export async function boldRender(req: Request, deps: Deps) {
  const body = parseBody(RenderBody, await readJson(req, Math.ceil((LIMITS.boldRenderBytes * 4) / 3) + 16 * 1024));
  await loadSession(deps.kv, body.sessionId, deps.now());
  const job = await loadJob(deps.kv, body.sessionId, body.postId);
  if (!job) throw new Refusal(404, "no_bold", "This post has no bold version in the works.");
  if (job.status !== "rendering") throw new Refusal(409, "not_rendering", "This bold pass isn't waiting for renders.");
  if (body.label !== "quick" && !job.candidates.some((c) => c.label === body.label)) throw new Refusal(400, "bad_label", "There's no such candidate.");
  const bytes = Buffer.from(body.jpeg, "base64");
  // A JPEG starts FF D8 FF. Anything else isn't a render.
  if (bytes.length < 1000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Refusal(400, "bad_render", "Send the render as a JPEG.");
  await deps.kv.putBytes(renderKey(body.sessionId, body.postId, body.label), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { label: body.label });
  const updated = await updateJob(deps.kv, body.sessionId, body.postId, (j) => ({ ...j, renders: { ...j.renders, [body.label]: { issues: body.issues.length } } }));
  return json(jobView(updated));
}

export async function boldJudge(req: Request, deps: Deps, startBackground: StartBackground) {
  const body = parseBody(PostBody, await readJson(req, LIMITS.jsonBodyBytes));
  await assertGenerationOpen(deps.kv, deps.settings, deps.now());
  await loadSession(deps.kv, body.sessionId, deps.now());
  let job!: BoldJob;
  await updateJob(deps.kv, body.sessionId, body.postId, (j) => {
    if (j.status === "judging" || j.status === "done") {
      job = j;
      return j;
    }
    if (j.status !== "rendering") throw new Refusal(409, "not_rendering", "This bold pass isn't waiting for renders.");
    if (!j.renders.quick) throw new Refusal(409, "missing_render", "Send the render of the post as first made, too.");
    job = { ...j, status: "judging", stage: "Judging the posts" };
    return job;
  });
  if (job.status === "judging" && !job.ran.includes("judge")) {
    try {
      await startBackground({ sessionId: body.sessionId, postId: body.postId, token: job.token, phase: "judge" });
    } catch {
      job = await updateJob(deps.kv, body.sessionId, body.postId, (j) => ({ ...j, status: "rendering", stage: "Ready to judge" }));
      throw new Refusal(503, "bold_unavailable", "The critic couldn't start. Try again in a minute.");
    }
  }
  return json(jobView(job), 202);
}
