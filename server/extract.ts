// Extraction endpoints (phase 4): read one upload, draft one kit chunk, show the kit so far,
// and let the owner edit or delete an item. The browser calls read once per upload, then
// assemble once per chunk, and shows each answer as it arrives: that's the DNA reveal.
// Every call goes through the same guards as posts: body shape, kill switch, tripwire,
// session, attempt caps, then a spend reservation before Claude.
import "server-only";
import { z } from "zod";
import { LIMITS, charCount } from "../core/limits.ts";
import { FETCH_LIMITS, type Image } from "../core/claude.ts";
import { approxTokens } from "../core/kit.ts";
import {
  ASSEMBLE_TARGETS,
  EXTRACT_CHUNK_IDS,
  ChunkDraftSchema,
  ConflictsSchema,
  EvidenceSchema,
  assemblePrompt,
  checkHexes,
  checkSources,
  formatEvidence,
  readPrompt,
  type AssembleTarget,
  type ChunkDraft,
  type Conflicts,
  type Evidence,
  type SampledColors,
  type UploadKind,
} from "../core/extract.ts";
import { CONTENT } from "./generated/content.ts";
import { Refusal, json, readJson } from "./http.ts";
import { assertGenerationOpen } from "./spend.ts";
import { loadSession, updateSession, type CallState, type ExtractionState, type Session, type UploadRecord } from "./sessions.ts";
import { update } from "./store.ts";
import { guardedCall, notBilled, parseBody, id, type Deps } from "./handlers.ts";

// ---------- storage ----------

export type EvidenceRecord = { uploadId: string; upload: string; kind: UploadKind; evidence: Evidence };
export type ChunkRecord =
  | { target: Exclude<AssembleTarget, "conflicts">; draft: ChunkDraft & { items: (ChunkDraft["items"][number] & { edited?: boolean })[] }; warnings: string[] }
  | { target: "conflicts"; conflicts: Conflicts["conflicts"]; warnings: string[] };

export const evidenceKey = (sid: string, uploadId: string) => `extract/${sid}/evidence/${uploadId}`;
export const chunkKey = (sid: string, target: string) => `extract/${sid}/chunk/${target}`;

const KIND: Record<UploadRecord["kind"], UploadKind> = { image: "photo", logo: "logo", pdf: "pdf", url: "url", pasted: "pasted", note: "note" };
const emptyExtraction = (): ExtractionState => ({ locked: false, reads: {}, targets: {} });

// ---------- claiming a call ----------

/**
 * Marks one call as running in the session, so a second request for the same thing (a double
 * click, a retry while the first is still going) is refused, and counts the try against the cap.
 */
async function claim(deps: Deps, sid: string, pick: (x: ExtractionState) => Record<string, CallState>, key: string, check: (s: Session) => void, lock = false) {
  await updateSession(deps.kv, sid, (s) => {
    check(s);
    const ex = s.extraction ?? emptyExtraction();
    const cur = pick(ex)[key];
    if (cur?.status === "running") throw new Refusal(409, "already_running", "That step is already running.");
    if (cur?.status === "done") throw new Refusal(409, "already_done", "That step is already done.");
    if ((cur?.attempts ?? 0) >= LIMITS.extractAttempts) {
      throw new Refusal(429, "attempt_cap", `Each extraction step gets ${LIMITS.extractAttempts} tries, and this one has used them.`);
    }
    const next: ExtractionState = { ...ex, locked: ex.locked || lock, reads: { ...ex.reads }, targets: { ...ex.targets } };
    pick(next)[key] = { status: "running", attempts: (cur?.attempts ?? 0) + 1 };
    return { ...s, extraction: next };
  });
}

/** Records how a claimed call ended. A try that cost nothing is given back. */
async function finish(deps: Deps, sid: string, pick: (x: ExtractionState) => Record<string, CallState>, key: string, outcome: "done" | "failed", refund = false) {
  await updateSession(deps.kv, sid, (s) => {
    const ex = s.extraction ?? emptyExtraction();
    const next: ExtractionState = { ...ex, reads: { ...ex.reads }, targets: { ...ex.targets } };
    const cur = pick(next)[key] ?? { status: "running", attempts: 1 };
    pick(next)[key] = { status: outcome, attempts: Math.max(0, cur.attempts - (refund ? 1 : 0)) };
    return { ...s, extraction: next };
  });
}

async function run<T>(deps: Deps, sid: string, pick: (x: ExtractionState) => Record<string, CallState>, key: string, call: () => Promise<T>): Promise<T> {
  try {
    const result = await call();
    await finish(deps, sid, pick, key, "done");
    return result;
  } catch (err) {
    await finish(deps, sid, pick, key, "failed", notBilled(err));
    throw err;
  }
}

const reads = (x: ExtractionState) => x.reads;
const targets = (x: ExtractionState) => x.targets;

// ---------- read one upload ----------

const ReadBody = z.strictObject({ sessionId: id, uploadId: id });

const base64 = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64");

// Rough input sizes for the spend reservation: a PDF page as an image plus its text, a fetched page at its cap.
const PDF_PAGE_TOKENS = 2000;
const IMAGE_TOKENS = 1600;

export async function readUpload(req: Request, deps: Deps) {
  const body = parseBody(ReadBody, await readJson(req, LIMITS.jsonBodyBytes));
  const now = deps.now();
  await assertGenerationOpen(deps.kv, deps.settings, now);
  const session = await loadSession(deps.kv, body.sessionId, now);
  const up = session.uploads.find((u) => u.id === body.uploadId);
  if (!up) throw new Refusal(404, "no_upload", "There's no such upload in this session.");
  await claim(deps, body.sessionId, reads, up.id, (s) => {
    if (s.extraction?.locked) throw new Refusal(409, "extraction_started", "The kit is already being drafted from the uploads read so far.");
  });

  return run(deps, body.sessionId, reads, up.id, async () => {
    const kind = KIND[up.kind];
    const bytes = up.kind === "url" ? null : await deps.kv.getBytes(`upload/${body.sessionId}/${up.id}`);
    if (up.kind !== "url" && !bytes) throw new Refusal(404, "no_upload", "That upload's file is missing. Upload it again.");

    const text = up.kind === "pasted" || up.kind === "note" ? new TextDecoder().decode(bytes!) : undefined;
    const prompt = readPrompt(CONTENT.prompts.read, { label: up.label ?? kind, kind, text, url: up.url });
    const images: Image[] = up.kind === "image" || up.kind === "logo" ? [{ mediaType: up.mediaType as Image["mediaType"], base64: base64(bytes!) }] : [];
    const documents = up.kind === "pdf" ? [{ base64: base64(bytes!) }] : [];
    const fetchDomain = up.kind === "url" ? new URL(up.url!).hostname : undefined;

    const inputTokens =
      approxTokens(prompt.system + prompt.user) +
      IMAGE_TOKENS * images.length +
      PDF_PAGE_TOKENS * (up.pages ?? 0) +
      (fetchDomain ? FETCH_LIMITS.maxUses * FETCH_LIMITS.maxContentTokens : 0);
    const { data } = await guardedCall(deps, "read", { ...prompt, images, documents, fetchDomain }, EvidenceSchema, inputTokens);

    const record: EvidenceRecord = { uploadId: up.id, upload: up.label ?? kind, kind, evidence: data };
    await deps.kv.put(evidenceKey(body.sessionId, up.id), record, { ifNew: true });
    return json({ uploadId: up.id, upload: record.upload, kind, evidence: data });
  });
}

// ---------- draft one chunk ----------

const AssembleBody = z.strictObject({ sessionId: id, target: z.enum(ASSEMBLE_TARGETS) });

async function loadEvidence(deps: Deps, s: Session) {
  const notes: EvidenceRecord[] = [];
  for (const u of s.uploads) {
    if (s.extraction?.reads[u.id]?.status !== "done") continue;
    const rec = (await deps.kv.get<EvidenceRecord>(evidenceKey(s.id, u.id)))?.value;
    if (rec) notes.push(rec);
  }
  const sampled: SampledColors[] = s.uploads.filter((u) => u.colors?.length).map((u) => ({ upload: u.label ?? "photo", colors: u.colors! }));
  return { notes, sampled };
}

export async function assemble(req: Request, deps: Deps) {
  const body = parseBody(AssembleBody, await readJson(req, LIMITS.jsonBodyBytes));
  const now = deps.now();
  await assertGenerationOpen(deps.kv, deps.settings, now);
  await loadSession(deps.kv, body.sessionId, now);
  await claim(
    deps,
    body.sessionId,
    targets,
    body.target,
    (s) => {
      const states = s.uploads.map((u) => s.extraction?.reads[u.id]?.status);
      if (states.includes("running")) throw new Refusal(409, "reads_running", "Wait until every upload has been read.");
      if (!states.includes("done")) throw new Refusal(409, "nothing_read", "Read at least one upload first.");
    },
    true,
  );

  return run(deps, body.sessionId, targets, body.target, async () => {
    const session = await loadSession(deps.kv, body.sessionId, now);
    const { notes, sampled } = await loadEvidence(deps, session);
    const evidenceText = formatEvidence(notes, sampled);
    const prompt = assemblePrompt(CONTENT.prompts.assemble, body.target);
    const extras = { cachedText: evidenceText };
    const labels = notes.map((n) => n.upload);

    let record: ChunkRecord;
    if (body.target === "conflicts") {
      const { data } = await guardedCall(deps, "assemble", { ...prompt, ...extras }, ConflictsSchema, approxTokens(prompt.system + prompt.user + evidenceText));
      record = { target: "conflicts", conflicts: data.conflicts, warnings: [] };
    } else {
      const { data } = await guardedCall(deps, "assemble", { ...prompt, ...extras }, ChunkDraftSchema, approxTokens(prompt.system + prompt.user + evidenceText));
      const sourced = checkSources(data, labels);
      const hexed = checkHexes(sourced.draft, evidenceText, sampled);
      record = { target: body.target, draft: hexed.draft, warnings: [...sourced.warnings, ...hexed.warnings] };
    }
    await deps.kv.put(chunkKey(body.sessionId, body.target), record, { ifNew: true });
    return json(record);
  });
}

// ---------- the kit so far ----------

const KitBody = z.strictObject({ sessionId: id });

export async function getKit(req: Request, deps: Deps) {
  const body = parseBody(KitBody, await readJson(req, LIMITS.jsonBodyBytes));
  const session = await loadSession(deps.kv, body.sessionId, deps.now());
  const ex = session.extraction ?? emptyExtraction();
  const { notes } = await loadEvidence(deps, session);
  const chunks: ChunkRecord[] = [];
  for (const t of ASSEMBLE_TARGETS) {
    if (ex.targets[t]?.status !== "done") continue;
    const rec = (await deps.kv.get<ChunkRecord>(chunkKey(session.id, t)))?.value;
    if (rec) chunks.push(rec);
  }
  return json({ uploads: session.uploads, extraction: ex, evidence: notes, chunks });
}

// ---------- the owner's edits ----------

const EditBody = z.strictObject({
  sessionId: id,
  chunk: z.enum(EXTRACT_CHUNK_IDS),
  item: z.number().int().min(0).max(200),
  /** The new value, or null to delete the item. */
  value: z
    .string()
    .refine((s) => charCount(s) <= LIMITS.messageChars, { message: "too_long" })
    .refine((s) => s.trim().length > 0, { message: "Empty; send null to delete." })
    .nullable(),
});

/** Edits or deletes one item. No model call, so no spend; edited items are marked as the owner's. */
export async function editItem(req: Request, deps: Deps) {
  const body = parseBody(EditBody, await readJson(req, LIMITS.jsonBodyBytes));
  await loadSession(deps.kv, body.sessionId, deps.now());
  const next = await update<ChunkRecord | null>(deps.kv, chunkKey(body.sessionId, body.chunk), () => null, (rec) => {
    if (!rec || rec.target === "conflicts") throw new Refusal(404, "no_chunk", "That chunk hasn't been drafted yet.");
    const items = [...rec.draft.items];
    const item = items[body.item];
    if (!item) throw new Refusal(404, "no_item", "There's no such item in that chunk.");
    if (body.value === null) items.splice(body.item, 1);
    else items[body.item] = { ...item, value: body.value, edited: true, confidence: "high" };
    return { ...rec, draft: { ...rec.draft, items } };
  });
  return json(next);
}
