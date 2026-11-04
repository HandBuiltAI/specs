// Phase 5 intake: "Fill the gaps". One endpoint. Each request may carry the owner's reply to the
// question on screen; the server writes it into the kit (no model call), runs the completeness
// check in code, and only if gaps remain asks Claude (Haiku) for the next question: one gap,
// one catalog component, one sentence. Every model turn goes through the same guards as the
// rest of the app: kill switch, tripwire, session, a per-session cap, a spend reservation.
import "server-only";
import { z } from "zod";
import { LIMITS } from "../core/limits.ts";
import { approxTokens } from "../core/kit.ts";
import { CURATED_FONTS, parseAnswer, parseCall, type ParsedCall } from "../core/catalog.ts";
import { EXTRACT_CHUNKS, type ExtractChunkId } from "../core/extract.ts";
import {
  IntakeTurnSchema,
  applyAnswer,
  describeAnswer,
  findGaps,
  intakePrompt,
  oneSentence,
  progress,
  targetChunk,
  type Gap,
  type IntakeChunks,
  type Resolutions,
  type Transcript,
} from "../core/intake.ts";
import { CONTENT } from "./generated/content.ts";
import { Refusal, json, readJson } from "./http.ts";
import { assertGenerationOpen } from "./spend.ts";
import { loadSession, updateSession, type Session } from "./sessions.ts";
import { update } from "./store.ts";
import { guardedCall, notBilled, parseBody, freeText, id, type Deps } from "./handlers.ts";
import { chunkKey, type ChunkRecord } from "./extract.ts";

// ---------- storage ----------

export type Turn = {
  id: string;
  gap: string;
  about: string;
  say: string;
  call: ParsedCall;
  /** Set once the owner replies. */
  answer?: string;
  skipped?: boolean;
};
export type IntakeState = { turns: Turn[]; resolutions: Resolutions; modelTurns: number; running: boolean };

const intakeKey = (sid: string) => `intake/${sid}`;
const empty = (): IntakeState => ({ turns: [], resolutions: {}, modelTurns: 0, running: false });

async function loadChunks(deps: Deps, s: Session): Promise<IntakeChunks> {
  const out: IntakeChunks = {};
  for (const t of [...EXTRACT_CHUNKS.map((c) => c.id), "conflicts"] as const) {
    if (s.extraction?.targets[t]?.status !== "done") continue;
    const rec = (await deps.kv.get<ChunkRecord>(chunkKey(s.id, t)))?.value;
    if (!rec) continue;
    if (rec.target === "conflicts") out.conflicts = { conflicts: rec.conflicts };
    else out[rec.target] = { draft: rec.draft };
  }
  return out;
}

const pendingOf = (st: IntakeState) => {
  const last = st.turns.at(-1);
  return last && last.answer === undefined && !last.skipped ? last : null;
};

/** What the browser sees: the transcript, the question on screen, and the kit's progress. */
function view(st: IntakeState, chunks: IntakeChunks, gaps: Gap[]) {
  return {
    done: gaps.length === 0,
    gapsLeft: gaps.length,
    turnsLeft: Math.max(0, LIMITS.intakeTurns - st.modelTurns),
    progress: progress(chunks, gaps),
    turns: st.turns.map(({ id, about, say, call, answer, skipped }) => ({ id, about, say, call, answer, skipped })),
    pending: pendingOf(st)?.id ?? null,
  };
}

// ---------- the request ----------

const Body = z.strictObject({
  sessionId: id,
  /** Just report where things stand; never calls the model. */
  peek: z.boolean().optional(),
  reply: z
    .union([
      z.strictObject({ turnId: id, answer: z.record(z.string(), z.unknown()) }),
      z.strictObject({ turnId: id, text: freeText.refine((s) => s.trim().length > 0, { message: "Empty." }) }),
      z.strictObject({ turnId: id, skip: z.literal(true) }),
    ])
    .optional(),
});

export async function intakeTurn(req: Request, deps: Deps) {
  const body = parseBody(Body, await readJson(req, LIMITS.jsonBodyBytes));
  const now = deps.now();
  const session = await loadSession(deps.kv, body.sessionId, now);
  const targets = session.extraction?.targets ?? {};
  const drafted = Object.values(targets).some((t) => t.status === "done");
  if (!drafted || Object.values(targets).some((t) => t.status === "running")) {
    throw new Refusal(409, "kit_not_ready", "Finish drafting the kit before filling the gaps.");
  }

  if (body.reply) await applyReply(deps, session, body.reply);

  const st = (await deps.kv.get<IntakeState>(intakeKey(session.id)))?.value ?? empty();
  const chunks = await loadChunks(deps, session);
  const gaps = findGaps(chunks, st.resolutions);
  if (body.peek || !gaps.length || pendingOf(st)) return json(view(st, chunks, gaps));
  if (st.modelTurns >= LIMITS.intakeTurns) {
    return json({ ...view(st, chunks, gaps), capped: true });
  }

  await assertGenerationOpen(deps.kv, deps.settings, now);
  // Claim the turn so a double click can't start two model calls.
  await update<IntakeState>(deps.kv, intakeKey(session.id), empty, (s) => {
    if (s.running) throw new Refusal(409, "already_running", "The next question is already on its way.");
    if (pendingOf(s)) throw new Refusal(409, "already_asked", "Answer the question on screen first.");
    if (s.modelTurns >= LIMITS.intakeTurns) throw new Refusal(429, "intake_cap", `Intake is capped at ${LIMITS.intakeTurns} questions per session.`);
    return { ...s, running: true, modelTurns: s.modelTurns + 1 };
  });

  try {
    const turn = await nextTurn(deps, session, chunks, gaps, st, body.reply && "text" in body.reply ? body.reply.text : undefined);
    const saved = await update<IntakeState>(deps.kv, intakeKey(session.id), empty, (s) => ({ ...s, running: false, turns: [...s.turns, turn] }));
    return json(view(saved, chunks, gaps));
  } catch (err) {
    const refund = notBilled(err);
    await update<IntakeState>(deps.kv, intakeKey(session.id), empty, (s) => ({ ...s, running: false, modelTurns: s.modelTurns - (refund ? 1 : 0) }));
    throw err;
  }
}

// ---------- the owner's reply ----------

async function applyReply(deps: Deps, session: Session, reply: NonNullable<z.infer<typeof Body>["reply"]>) {
  const st = (await deps.kv.get<IntakeState>(intakeKey(session.id)))?.value ?? empty();
  const turn = pendingOf(st);
  if (!turn || turn.id !== reply.turnId) throw new Refusal(409, "stale_reply", "That question was already answered. Reload to see the next one.");

  const chunks = await loadChunks(deps, session);
  const gap = findGaps(chunks, st.resolutions).find((g) => g.id === turn.gap);

  let text: string | undefined;
  let confirmed = false;
  if ("answer" in reply) {
    let answer: unknown;
    try {
      answer = parseAnswer(turn.call.component, reply.answer);
    } catch {
      throw new Refusal(400, "bad_answer", `That answer doesn't fit the ${turn.call.component} on screen.`);
    }
    text = describeAnswer(turn.call, answer);
    confirmed = turn.call.component === "SourceCard" && (answer as { action: string }).action === "confirm";
  } else if ("text" in reply) {
    // Typed answers are stored as the owner's words. They reach a prompt later only through asData.
    text = `Owner wrote: ${reply.text.trim()}`;
  }

  // Write the answer into the kit (skips and already-closed gaps change nothing).
  if (text && gap) {
    const chunk = targetChunk(gap, turn.call);
    await writeChunk(deps, session, chunk, (draft) => applyAnswer(draft, gap, turn.call, text!, confirmed));
  }

  await update<IntakeState>(deps.kv, intakeKey(session.id), empty, (s) => {
    const cur = pendingOf(s);
    if (!cur || cur.id !== turn.id) throw new Refusal(409, "stale_reply", "That question was already answered. Reload to see the next one.");
    const turns = s.turns.map((t) => (t.id === turn.id ? (text ? { ...t, answer: text } : { ...t, skipped: true }) : t));
    return { ...s, turns, resolutions: { ...s.resolutions, [turn.gap]: text ? { status: "answered", text } : { status: "skipped" } } };
  });
}

/** Updates one chunk's draft. A chunk that was never drafted is created from the owner's answer. */
type Draft = Parameters<typeof applyAnswer>[0];
async function writeChunk(deps: Deps, session: Session, chunk: ExtractChunkId, change: (d: Draft) => NonNullable<Draft>) {
  await update<ChunkRecord | null>(deps.kv, chunkKey(session.id, chunk), () => null, (rec) => {
    const draft = rec && rec.target !== "conflicts" ? rec.draft : undefined;
    return { target: chunk, draft: change(draft), warnings: rec?.warnings ?? [] } as ChunkRecord;
  });
  if (session.extraction?.targets[chunk]?.status !== "done") {
    await updateSession(deps.kv, session.id, (s) => {
      const ex = s.extraction!;
      return { ...s, extraction: { ...ex, targets: { ...ex.targets, [chunk]: { status: "done", attempts: ex.targets[chunk]?.attempts ?? 0 } } } };
    });
  }
}

// ---------- the next question ----------

async function nextTurn(deps: Deps, session: Session, chunks: IntakeChunks, gaps: Gap[], st: IntakeState, ownerMessage?: string): Promise<Turn> {
  const photos = session.uploads.filter((u) => u.kind === "image" && u.label);
  const transcript: Transcript = st.turns
    .filter((t) => t.answer || t.skipped)
    .map((t) => ({ gap: t.gap, say: t.say, component: t.call.component, answer: t.answer ?? "skipped" }));
  const prompt = intakePrompt(CONTENT.prompts.intake, {
    chunks,
    gaps,
    transcript,
    photos: photos.map((p) => p.label!),
    sampled: session.uploads.filter((u) => u.colors?.length).map((u) => ({ upload: u.label ?? "photo", colors: u.colors!.slice(0, 5).map((c) => c.hex) })),
    fonts: CURATED_FONTS,
    ownerMessage,
  });
  const { data } = await guardedCall(deps, "intake", prompt, IntakeTurnSchema, approxTokens(prompt.system + prompt.user));

  const gap = gaps.find((g) => g.id === data.gap);
  if (!gap) throw new Refusal(502, "model_output", "The next question pointed at a gap that isn't open. Try again.");

  // Photos are named by upload in the prompt; the browser fetches them by upload id.
  let raw: unknown = data.call;
  if (data.call.component === "PhotoPicker") {
    const props = data.call.props as { photos: { src: string }[] };
    const known = props.photos.flatMap((p) => {
      const u = photos.find((x) => x.label === p.src);
      return u ? [{ ...p, src: `upload:${u.id}` }] : [];
    });
    raw = { ...data.call, props: { ...props, photos: known } };
  }
  const parsed = parseCall(raw);
  if (!parsed.ok) throw new Refusal(502, "model_output", "The next question came back malformed. Try again.");

  return { id: crypto.randomUUID(), gap: gap.id, about: gap.about, say: oneSentence(data.say), call: parsed.call };
}

// ---------- photos for PhotoPicker ----------

const ImageBody = z.strictObject({ sessionId: id, uploadId: id });

/** Returns one uploaded photo or logo to its own session, so PhotoPicker can show it. */
export async function uploadImage(req: Request, deps: Deps) {
  const body = parseBody(ImageBody, await readJson(req, LIMITS.jsonBodyBytes));
  const session = await loadSession(deps.kv, body.sessionId, deps.now());
  const up = session.uploads.find((u) => u.id === body.uploadId && (u.kind === "image" || u.kind === "logo"));
  if (!up) throw new Refusal(404, "no_upload", "There's no such photo in this session.");
  const bytes = await deps.kv.getBytes(`upload/${session.id}/${up.id}`);
  if (!bytes) throw new Refusal(404, "no_upload", "That photo's file is missing.");
  return new Response(bytes, { headers: { "content-type": up.mediaType ?? "image/jpeg", "cache-control": "private, max-age=3600" } });
}
