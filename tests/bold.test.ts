// The bold pass: one per session, a background run that only a started job can trigger,
// spend reserved for every call, renders as JPEGs only, and the critic's ranking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { respond } from "../server/http.ts";
import { startSession, createPost, writePost } from "../server/handlers.ts";
import { startBold, boldStatus, boldRender, boldJudge, loadJob, type BoldTrigger } from "../server/bold.ts";
import { runBold } from "../server/bold-run.ts";
import { todaysSpend } from "../server/spend.ts";
import type { CallStep } from "../server/claude.ts";
import { StepError } from "../core/claude.ts";
import type { Deps } from "../server/handlers.ts";
import { makeDeps, jsonReq, body, brief, COMPOSED } from "./helpers.ts";

const run = (fn: () => Promise<Response>) => respond(fn);

const DIRECTIONS = {
  energy: 3,
  photo_notes: "A sill.",
  fact_conflicts: [],
  directions: ["Seed packet", "Huge ten", "Tiny sprout"].map((name) => ({
    label: "A",
    name,
    idea: `${name} idea.`,
    hero: "The headline.",
    composition: "Top to bottom.",
    treatments: ["giant-type"],
    uses_photo: true,
    photo_treatment: "Full bleed.",
    logo: "Bottom right.",
    breaks: "Scale.",
    energy_fit: "Friendly.",
  })),
};
const BOLD = { ...COMPOSED, html: `${COMPOSED.html}<div class="ghost" data-echo="headline" aria-hidden="true"></div>` };
const critique = (n: number) => ({
  candidates: Array.from({ length: n }, (_, i) => ({ label: String(i + 1), idea: 3 + (i % 2), stop: 3, brand: 4, legible: 4, honesty: [], notes: `Notes ${i + 1}.` })),
  winner: "2",
  why: "Number two commits.",
  revision: [],
  fact_conflicts: [],
});

/** A JPEG-looking body: the right magic bytes, padded past the minimum size. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]).toString("base64");

async function setup(opts: { usd?: number; runOutOnce?: boolean } = {}) {
  const made = makeDeps({ usd: opts.usd });
  const base = made.deps.callStep;
  const steps: string[] = [];
  let judged = 0;
  let ranOut = false;
  const callStep: CallStep = async (o) => {
    steps.push(o.step);
    if (o.step === "directions") return { data: DIRECTIONS as never, usage: { step: o.step, model: "claude-sonnet-5-5", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, usd: 0.03 } };
    if (o.step === "compose_bold" && opts.runOutOnce && !ranOut) {
      ranOut = true;
      throw new StepError("compose_bold: hit max_tokens", "max_tokens", { step: o.step, model: "claude-sonnet-5-5", input: 1, output: 20000, cacheRead: 0, cacheWrite: 0, usd: 0.3 });
    }
    if (o.step === "compose_bold") return { data: BOLD as never, usage: { step: o.step, model: "claude-sonnet-5-5", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, usd: 0.1 } };
    if (o.step === "art_critique") {
      judged = o.images?.length ?? 0;
      return { data: critique(judged) as never, usage: { step: o.step, model: "claude-sonnet-5-5", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, usd: 0.04 } };
    }
    return base(o);
  };
  const deps: Deps = { ...made.deps, callStep };
  const s = await body(await run(() => startSession(jsonReq("/api/session", { turnstileToken: "good-token" }), deps)));
  const sessionId = s.sessionId as string;
  const p = await body(await run(() => createPost(jsonReq("/api/posts", { sessionId, brand: "half-acre-club", intent: "promo", brief }), deps)));
  const postId = p.postId as string;
  await run(() => writePost(jsonReq("/api/posts/write", { sessionId, postId }), deps));
  const triggers: BoldTrigger[] = [];
  // In-process, awaited, so each test sees the finished phase.
  const starter = async (t: BoldTrigger) => {
    triggers.push(t);
    await runBold(deps, t, undefined);
  };
  return { deps, sessionId, postId, steps, triggers, starter, judgedImages: () => judged };
}

test("a bold pass builds two directions, takes JPEG renders, and ranks with the critic", async () => {
  const { deps, sessionId, postId, steps, starter, judgedImages } = await setup();
  const started = await run(() => startBold(jsonReq("/api/posts/bold/start", { sessionId, postId }), deps, starter));
  assert.equal(started.status, 202);
  assert.equal((await body(started)).token, undefined, "the token never reaches the browser");

  const job = await body(await run(() => boldStatus(jsonReq("/api/posts/bold/status", { sessionId, postId }), deps)));
  assert.equal(job.status, "rendering");
  assert.equal(job.energy, 3, "Half Acre's energy chunk says 3");
  assert.equal(job.sketch, "none", "below energy 4 (and no key) there's no image model");
  const candidates = job.candidates as { label: string; html: string }[];
  assert.deepEqual(candidates.map((c) => c.label), ["A", "B"]);
  assert.match(candidates[0]!.html, /class="ghost echo" data-echo="headline" aria-hidden="true">Pea shoots\. Ten days\.</, "echoes come back filled");
  assert.deepEqual(steps.filter((s) => s !== "plan" && s !== "write"), ["directions", "compose_bold", "compose_bold"]);

  // Not a JPEG: refused.
  const png = await run(() => boldRender(jsonReq("/api/posts/bold/render", { sessionId, postId, label: "A", jpeg: Buffer.from("\x89PNG....").toString("base64"), issues: [] }), deps));
  assert.equal(png.status, 400);
  // Judging needs the quick post's render.
  for (const label of ["A", "B"]) await run(() => boldRender(jsonReq("/api/posts/bold/render", { sessionId, postId, label, jpeg: JPEG, issues: label === "B" ? [{ slot: "headline", code: "overlap" }] : [] }), deps));
  assert.equal((await run(() => boldJudge(jsonReq("/api/posts/bold/judge", { sessionId, postId }), deps, starter))).status, 409);
  await run(() => boldRender(jsonReq("/api/posts/bold/render", { sessionId, postId, label: "quick", jpeg: JPEG, issues: [] }), deps));

  assert.equal((await run(() => boldJudge(jsonReq("/api/posts/bold/judge", { sessionId, postId }), deps, starter))).status, 202);
  const done = await body(await run(() => boldStatus(jsonReq("/api/posts/bold/status", { sessionId, postId }), deps)));
  assert.equal(done.status, "done");
  assert.equal(judgedImages(), 2, "B failed the probe, so only quick and A are judged");
  const ranking = done.ranking as { order: string[]; winner: string };
  assert.equal(ranking.order.length, 2);
  assert.equal(ranking.winner, ranking.order[0]);
  const spend = await todaysSpend(deps.kv, deps.now());
  assert.equal(spend.reservedUsd, 0, "every reservation settled");
});

test("one bold pass per session", async () => {
  const { deps, sessionId, postId, starter } = await setup();
  await run(() => startBold(jsonReq("/api/posts/bold/start", { sessionId, postId }), deps, starter));
  const p2 = await body(await run(() => createPost(jsonReq("/api/posts", { sessionId, brand: "half-acre-club", intent: "tip", brief }), deps)));
  await run(() => writePost(jsonReq("/api/posts/write", { sessionId, postId: p2.postId }), deps));
  const second = await run(() => startBold(jsonReq("/api/posts/bold/start", { sessionId, postId: p2.postId }), deps, starter));
  assert.equal(second.status, 429);
  assert.equal((await body(second)).error?.code, "bold_cap");
  // Asking again for the same post just returns its job.
  assert.equal((await run(() => startBold(jsonReq("/api/posts/bold/start", { sessionId, postId }), deps, starter))).status, 200);
});

test("a background trigger with the wrong token, or a repeat, does nothing", async () => {
  const { deps, sessionId, postId, steps, triggers } = await setup();
  const queued: BoldTrigger[] = [];
  await run(() => startBold(jsonReq("/api/posts/bold/start", { sessionId, postId }), deps, async (t) => void queued.push(t)));
  const before = steps.length;
  await runBold(deps, { ...queued[0]!, token: "guess" }, undefined);
  assert.equal(steps.length, before, "a wrong token spends nothing");
  await runBold(deps, queued[0]!, undefined);
  const after = steps.length;
  await runBold(deps, queued[0]!, undefined);
  assert.equal(steps.length, after, "a retried trigger doesn't run the build twice");
  assert.equal(triggers.length, 0);
  assert.equal((await loadJob(deps.kv, sessionId, postId))?.status, "rendering");
});

test("if the background function can't start, the visit keeps its bold pass", async () => {
  const { deps, sessionId, postId, starter } = await setup();
  const failed = await run(() => startBold(jsonReq("/api/posts/bold/start", { sessionId, postId }), deps, async () => { throw new Error("down"); }));
  assert.equal(failed.status, 503);
  const p2 = await body(await run(() => createPost(jsonReq("/api/posts", { sessionId, brand: "half-acre-club", intent: "tip", brief }), deps)));
  await run(() => writePost(jsonReq("/api/posts/write", { sessionId, postId: p2.postId }), deps));
  assert.equal((await run(() => startBold(jsonReq("/api/posts/bold/start", { sessionId, postId: p2.postId }), deps, starter))).status, 202);
});

test("a loud brand with the image model's key gets a rough rebuilt as a third candidate", async () => {
  const { deps, sessionId, steps } = await setup();
  const p = await body(await run(() => createPost(jsonReq("/api/posts", { sessionId, brand: "third-shift-slice", intent: "promo", brief: { goal: "Sell $3 slices", details: "" } }), deps)));
  const postId = p.postId as string;
  await run(() => writePost(jsonReq("/api/posts/write", { sessionId, postId }), deps));
  const realFetch = globalThis.fetch;
  let geminiCalls = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("generativelanguage")) {
      geminiCalls++;
      assert.equal((init?.headers as Record<string, string>)["x-goog-api-key"], "gemini-test-key");
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: JPEG } }] } }] });
    }
    return realFetch(url, init);
  }) as typeof fetch;
  try {
    await run(() => startBold(jsonReq("/api/posts/bold/start", { sessionId, postId }), deps, (t) => runBold(deps, t, "gemini-test-key")));
  } finally {
    globalThis.fetch = realFetch;
  }
  const job = (await loadJob(deps.kv, sessionId, postId))!;
  assert.equal(geminiCalls, 1);
  assert.equal(job.energy, 5);
  assert.equal(job.sketch, "used");
  assert.deepEqual(job.candidates.map((c) => c.label).sort(), ["A", "B", "S"]);
  assert.equal(steps.filter((s) => s === "compose_bold").length, 3);
  const spend = await todaysSpend(deps.kv, deps.now());
  assert.ok(spend.spentUsd > 0.13, "the image counts toward the daily cap");
  assert.equal(spend.reservedUsd, 0);
});

test("a design that runs out of tokens gets its second try", async () => {
  const { deps, sessionId, postId, steps, starter } = await setup({ runOutOnce: true });
  await run(() => startBold(jsonReq("/api/posts/bold/start", { sessionId, postId }), deps, starter));
  const job = (await loadJob(deps.kv, sessionId, postId))!;
  assert.deepEqual(job.candidates.map((c) => c.label).sort(), ["A", "B"]);
  assert.equal(steps.filter((s) => s === "compose_bold").length, 3);
  assert.equal((await todaysSpend(deps.kv, deps.now())).reservedUsd, 0);
});
