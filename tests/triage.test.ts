// Intake triage: which gaps get asked, settled or skipped, how settlements are written into the
// kit, and Undo. Pure, plus one pass through the endpoint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { respond } from "../server/http.ts";
import { startSession, upload } from "../server/handlers.ts";
import { readUpload, assemble, getKit } from "../server/extract.ts";
import { intakeTurn } from "../server/intake.ts";
import { ASSEMBLE_TARGETS, EXTRACT_CHUNKS, type ChunkDraft } from "../core/extract.ts";
import { findGaps, type IntakeChunks } from "../core/intake.ts";
import { ASK_CAP, countCalls, keepItem, pullOf, reconcile, relatedItems, triage, undoRestore, writeConflict } from "../core/triage.ts";
import { makeDeps, jsonReq, formReq, body, CONFLICTS, DRAFT } from "./helpers.ts";
import { PDFDocument } from "pdf-lib";

const chunksFrom = (): IntakeChunks => ({
  ...Object.fromEntries(EXTRACT_CHUNKS.map((c) => [c.id, { draft: structuredClone(DRAFT) }])),
  conflicts: { conflicts: structuredClone(CONFLICTS.conflicts) },
});

test("triage: a price is always asked, a settled count is settled, background is skipped", () => {
  const chunks = chunksFrom();
  const plan = triage(findGaps(chunks, {}), chunks);
  // Monthly price: the notes are trusted, but a price is a promise, so the owner says.
  assert.ok(plan.ask.includes("conflict:0:monthly-price"));
  assert.equal(plan.ask[0], "conflict:0:monthly-price");
  // Box number: the uploads settle it on the notes' side.
  const box = plan.settle.find((s) => s.gap.startsWith("conflict:1"));
  assert.ok(box && box.mode === "conflict" && box.text === "Box 01");
  // Missing terminology or guardrails don't change a post enough to ask.
  assert.ok(plan.skip.includes("need:terminology:use"));
  assert.ok(!plan.ask.includes("need:guardrails:never"));
});

test("triage: one call per group, capped", () => {
  const chunks = chunksFrom();
  const plan = triage(findGaps(chunks, {}), chunks);
  const gaps = findGaps(chunks, {});
  // Body text color and both fonts are missing: one palette call, one font call.
  const colorAsks = plan.ask.filter((id) => id.startsWith("need:visual-system:color"));
  assert.ok(colorAsks.length >= 1);
  const calls = countCalls(plan.ask, gaps.map((g) => pullOf(g, chunks)));
  assert.ok(calls <= ASK_CAP && calls < plan.ask.length, `${calls} calls for ${plan.ask.length} gaps`);
  // The look and the voice come right after the price.
  assert.ok(plan.ask.indexOf("need:visual-system:type-heading") < plan.ask.indexOf("need:positioning-core:what-it-is"));
  // Everything is accounted for.
  const all = new Set([...plan.ask, ...plan.settle.map((s) => s.gap), ...plan.skip, ...plan.folded]);
  assert.equal(all.size, gaps.length);
});

test("triage: a kit drafted before conflict topics existed still asks about its conflicts", () => {
  const chunks = chunksFrom();
  for (const c of chunks.conflicts!.conflicts) delete (c as Partial<typeof c>).topic;
  const plan = triage(findGaps(chunks, {}), chunks);
  assert.ok(plan.ask.some((id) => id.startsWith("conflict:1")));
});

test("a doubtful item that rests on a conflict is answered with it, not asked twice", () => {
  const chunks = chunksFrom();
  const pos = chunks["positioning-core"]!.draft;
  pos.items.push({ label: "fact: price", value: "$24 a month, cancel anytime", why: null, sources: [{ upload: "rough-notes.pdf", location: "page 1" }], confidence: "needs-review" });
  const idx = pos.items.length - 1;
  assert.deepEqual(relatedItems(chunks, 0), [{ chunk: "positioning-core", index: idx }]);
  const plan = triage(findGaps(chunks, {}), chunks);
  assert.ok(plan.folded.some((id) => id.startsWith("item:positioning-core:fact-price")));
  assert.ok(!plan.ask.some((id) => id.startsWith("item:positioning-core:fact-price")));

  // The owner picks the other side: the resolved item is added and the doubtful one follows it.
  const { drafts, restore } = writeConflict(chunks, 0, "positioning-core", "$22 a month", "owner");
  const after = drafts["positioning-core"]!;
  assert.equal(after.items[idx]!.value, "$22 a month, cancel anytime");
  assert.equal(after.items[idx]!.confidence, "high");
  assert.equal(after.items.at(-1)!.label, "resolved: Monthly price");
  // Undo puts both back.
  const undone = undoRestore(after, restore);
  assert.equal(undone.items.length, pos.items.length);
  assert.equal(undone.items[idx]!.value, "$24 a month, cancel anytime");
  assert.equal(undone.items[idx]!.confidence, "needs-review");
});

test("reconcile swaps the one disputed figure, or adds the answer", () => {
  assert.equal(reconcile("Cups are $36. Plates $54.", ["$36", "$38"], "$38"), "Cups are $38. Plates $54.");
  assert.equal(reconcile("Cups are $38.", ["$36", "$38"], "$38"), "Cups are $38.");
  assert.equal(reconcile("Cups and mugs", ["$36", "$38"], "$38 for cups"), "Cups and mugs (answer: $38 for cups)");
});

test("keeping an item as drafted closes it, and Undo reopens it", () => {
  const draft = structuredClone(DRAFT) as ChunkDraft;
  draft.items[1]!.confidence = "needs-review";
  const { draft: kept, restore } = keepItem(draft, 1, "visual-system");
  assert.equal(kept.items[1]!.confidence, "medium");
  assert.equal(kept.items[1]!.sources.at(-1)!.upload, "specs");
  const back = undoRestore(kept, restore);
  assert.equal(back.items[1]!.confidence, "needs-review");
  assert.ok(!back.items[1]!.sources.some((s) => s.upload === "specs"));
});

// ---------- the endpoint ----------

const run = (fn: () => Promise<Response>) => respond(fn);

test("the endpoint settles on the first request for free, and Undo turns a settlement into the next call", async () => {
  const { deps, sent } = makeDeps();
  const sid = (await body(await run(() => startSession(jsonReq("/api/session", { turnstileToken: "good-token" }), deps)))).sessionId as string;
  const doc = await PDFDocument.create();
  doc.addPage();
  const bytes = new Uint8Array(await doc.save());
  const up = await body(await run(() => upload(formReq({ sessionId: sid, kind: "pdf", file: new File([bytes], "rough-notes.pdf") }), deps)));
  await run(() => readUpload(jsonReq("/api/extract/read", { sessionId: sid, uploadId: (up.upload as { id: string }).id }), deps));
  for (const t of ASSEMBLE_TARGETS) await run(() => assemble(jsonReq("/api/extract/assemble", { sessionId: sid, target: t }), deps));

  const before = sent.length;
  const peek = await body(await run(() => intakeTurn(jsonReq("/api/intake", { sessionId: sid, peek: true }), deps)));
  assert.equal(sent.length, before);
  const settled = peek.settled as { gap: string; text: string }[];
  const box = settled.find((s) => s.text === "Box 01")!;
  assert.ok(box);
  // The settlement is in the kit, credited to Specs.
  const kit = await body(await run(() => getKit(jsonReq("/api/kit", { sessionId: sid }), deps)));
  const pos = (kit.chunks as { target: string; draft?: { items: { label: string; sources: { upload: string }[] }[] } }[]).find((c) => c.target === "positioning-core")!;
  assert.ok(pos.draft!.items.some((i) => i.label === "resolved: Box number for pea shoots" && i.sources.some((s) => s.upload === "specs")));

  // Undo: the settled item leaves the kit and the box question becomes the next call.
  const undone = await body(await run(() => intakeTurn(jsonReq("/api/intake", { sessionId: sid, undo: box.gap }), deps)));
  assert.ok(!(undone.settled as { gap: string }[]).some((s) => s.gap === box.gap));
  assert.match(sent.at(-1)!.user, /ask about: Uploads disagree: Box number/);
  const kit2 = await body(await run(() => getKit(jsonReq("/api/kit", { sessionId: sid }), deps)));
  const pos2 = (kit2.chunks as { target: string; draft?: { items: { label: string }[] } }[]).find((c) => c.target === "positioning-core")!;
  assert.ok(!pos2.draft!.items.some((i) => i.label === "resolved: Box number for pea shoots"));

  const again = await respond(() => intakeTurn(jsonReq("/api/intake", { sessionId: sid, undo: box.gap }), deps));
  assert.equal(again.status, 404); // already undone
});
