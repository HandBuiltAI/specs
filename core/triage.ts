// Intake triage (phase 7 rework, Nov 5): before anything is asked, code sorts every open gap
// into one of three piles, so the owner answers a few calls that change their posts instead of
// a dozen granular ones.
//
//   ask     the gap has pull on a post and the uploads don't settle it, or it's risky (a price
//           or a date is always asked: a wrong one is a broken promise to a customer)
//   settle  the uploads settle it (more sources, newer, or one says the other is out of date),
//           or it's a doubtful item with little pull on a post: kept as drafted, with an Undo
//   skip    little pull and nothing to settle it with; stays editable in the kit
//
// This is rules, not model judgment, on purpose: it's predictable, testable, and the app can
// always say why it asked. The model only words the question for the gap code picked.
// Pure: no file access.
import { EXTRACT_CHUNKS, type ChunkDraft, type Confidence, type ConflictTopic, type ExtractChunkId } from "./extract.ts";
import type { Gap, IntakeChunks } from "./intake.ts";

/** At most this many calls are put to the owner up front. Undo can add one back. */
export const ASK_CAP = 5;

/** 3: printed on a post. 2: shows on every post. 1: background the posts rarely show. */
export type Pull = 1 | 2 | 3;

const TOPIC_PULL: Record<ConflictTopic, Pull> = {
  price: 3, date_time: 3, count: 3, name_place: 3, contact: 3,
  color: 2, font: 2, voice: 2, photo: 2,
  other: 1,
};
/** Settled facts that are still always asked. */
const ALWAYS_ASK: ConflictTopic[] = ["price", "date_time"];

/** Where a settled or answered conflict is written, by topic. */
export const TOPIC_CHUNK: Record<ConflictTopic, ExtractChunkId> = {
  price: "positioning-core", date_time: "positioning-core", count: "positioning-core", name_place: "positioning-core", contact: "positioning-core",
  color: "visual-system", font: "visual-system", voice: "voice-core", photo: "art-direction", other: "positioning-core",
};

/** Calls that one answer covers together: one palette answer fills every color slot, and so on. */
export type Group = "palette" | "fonts" | "voice" | "photos";

const RISKY = /(price|cost|fee|\$|£|€|hours?|open|date|day|time|schedule)/i;

function groupOf(g: Gap): Group | null {
  const label = (g.item?.label ?? g.slot ?? "").toLowerCase();
  if (g.chunk === "visual-system") {
    if (label.startsWith("color") || label.startsWith("palette")) return "palette";
    if (label.startsWith("type") || label.startsWith("font")) return "fonts";
  }
  if (g.chunk === "voice-core" || g.chunk === "voice-examples") return "voice";
  if (g.chunk === "art-direction" && /photo/.test(label)) return "photos";
  return null;
}

export type Triaged = Gap & { pull: Pull; group: Group | null; topic?: ConflictTopic };

export function pullOf(g: Gap, chunks: IntakeChunks): Triaged {
  if (g.kind === "conflict") {
    const c = chunks.conflicts?.conflicts[g.conflict!];
    // Kits drafted before topics existed: ask, since nothing says it's safe to settle.
    if (!c?.topic) return { ...g, pull: 2, group: null };
    const topic = c.topic;
    const group: Group | null = topic === "color" ? "palette" : topic === "font" ? "fonts" : topic === "voice" ? "voice" : topic === "photo" ? "photos" : null;
    return { ...g, pull: TOPIC_PULL[topic] ?? 1, group, topic };
  }
  const group = groupOf(g);
  if (group) return { ...g, pull: 2, group };
  if (g.kind === "needs-review" && g.chunk === "positioning-core" && RISKY.test(`${g.item?.label} ${g.detail}`)) return { ...g, pull: 3, group: null };
  // What the business is and who it's for shape every post's angle, and can't be guessed.
  if (g.kind === "missing" && ["positioning-core", "brand-about"].includes(g.chunk)) return { ...g, pull: 2, group: null };
  return { ...g, pull: 1, group: null };
}

/** The side a conflict settles on, or null when the owner has to say. Risky topics never settle. */
export function settledSide(g: Triaged, chunks: IntakeChunks): number | null {
  if (g.kind !== "conflict" || !g.topic || ALWAYS_ASK.includes(g.topic)) return null;
  const c = chunks.conflicts?.conflicts[g.conflict!];
  const t = c?.trust;
  return c && typeof t === "number" && t >= 0 && t < c.sides.length ? t : null;
}

/**
 * Doubtful items that are really the same question as a conflict (the assemble step keeps the
 * better-supported side and marks it needs-review). They're answered with the conflict instead
 * of being asked twice. Matched by a number or price the conflict quotes, or by citing two of
 * its sides' uploads.
 */
export function relatedItems(chunks: IntakeChunks, conflict: number): { chunk: ExtractChunkId; index: number }[] {
  const c = chunks.conflicts?.conflicts[conflict];
  if (!c) return [];
  const tokens = new Set(c.sides.flatMap((s) => s.says.match(/[$£€]?\d[\d.,/]*/g) ?? []).filter((t) => t.replace(/\D/g, "").length > 0));
  const uploads = new Set(c.sides.map((s) => s.source.upload));
  const out: { chunk: ExtractChunkId; index: number }[] = [];
  for (const { id } of EXTRACT_CHUNKS) {
    chunks[id]?.draft.items.forEach((item, index) => {
      if (item.confidence !== "needs-review") return;
      const cited = new Set(item.sources.map((s) => s.upload).filter((u) => uploads.has(u)));
      const quoted = [...tokens].some((t) => new RegExp(`(^|[^\\d])${t.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")}([^\\d]|$)`).test(item.value));
      if (quoted || cited.size >= 2) out.push({ chunk: id, index });
    });
  }
  return out;
}

export type Settlement =
  | { gap: string; mode: "conflict"; about: string; text: string; why: string; chunk: ExtractChunkId; side: number }
  | { gap: string; mode: "kept"; about: string; text: string; why: string; chunk: ExtractChunkId };

export type Plan = { ask: string[]; settle: Settlement[]; skip: string[]; folded: string[] };

/**
 * Sorts the open gaps. Asks are ordered by pull (conflicts first within a pull), one per group,
 * capped at ASK_CAP; what doesn't fit is settled when it can be and skipped when it can't.
 */
export function triage(gaps: Gap[], chunks: IntakeChunks): Plan {
  // Doubtful items that a conflict covers are folded into it.
  const foldedKeys = new Set<string>();
  gaps.forEach((g) => {
    if (g.kind === "conflict") for (const r of relatedItems(chunks, g.conflict!)) foldedKeys.add(`${r.chunk}:${r.index}`);
  });
  const folded = gaps.filter((g) => g.kind === "needs-review" && foldedKeys.has(`${g.chunk}:${g.item!.index}`)).map((g) => g.id);
  const open = gaps.filter((g) => !folded.includes(g.id)).map((g) => pullOf(g, chunks));

  const plan: Plan = { ask: [], settle: [], skip: [], folded };
  const settle = (g: Triaged): boolean => {
    const side = settledSide(g, chunks);
    if (side !== null) {
      const c = chunks.conflicts!.conflicts[g.conflict!]!;
      const others = c.sides.filter((_, i) => i !== side).map((s) => `${s.source.upload}`).join(", ");
      plan.settle.push({ gap: g.id, mode: "conflict", about: c.about, text: c.sides[side]!.says, why: `Went with ${c.sides[side]!.source.upload} over ${others}. ${c.suggestion}`.trim(), chunk: TOPIC_CHUNK[g.topic!], side });
      return true;
    }
    if (g.kind === "needs-review" && g.item) {
      const value = chunks[g.chunk as ExtractChunkId]?.draft.items[g.item.index]?.value ?? "";
      plan.settle.push({ gap: g.id, mode: "kept", about: g.item.label, text: value, why: "Kept as drafted from your uploads.", chunk: g.chunk as ExtractChunkId });
      return true;
    }
    return false;
  };

  const groupsAsked = new Set<Group>();
  // Within a pull: conflicts, then the look and the voice (every post shows them), then the
  // business basics, then photos (the planner picks photos well without an answer).
  const rank = (g: Triaged) => (g.kind === "conflict" ? 0 : g.group === "palette" ? 1 : g.group === "fonts" ? 2 : g.group === "voice" ? 3 : g.group === "photos" ? 5 : 4);
  const ranked = [...open].sort((a, b) => b.pull - a.pull || rank(a) - rank(b));
  for (const g of ranked) {
    const risky = g.kind === "conflict" ? settledSide(g, chunks) === null : g.pull === 3 || g.kind === "missing" || g.group !== null;
    const wantsAsk = g.pull >= 2 && risky;
    if (wantsAsk && g.group && groupsAsked.has(g.group)) {
      // The group's call answers this one too.
      plan.ask.push(g.id);
      continue;
    }
    if (wantsAsk && countCalls(plan.ask, open) < ASK_CAP) {
      plan.ask.push(g.id);
      if (g.group) groupsAsked.add(g.group);
      continue;
    }
    if (!settle(g)) plan.skip.push(g.id);
  }
  return plan;
}

/** How many separate calls a list of gap ids makes: grouped gaps count once. */
export function countCalls(ids: string[], gaps: Triaged[]): number {
  const seen = new Set<string>();
  for (const id of ids) {
    const g = gaps.find((x) => x.id === id);
    seen.add(g?.group ? `group:${g.group}` : id);
  }
  return seen.size;
}

// ---------- writing settlements and resolved conflicts into the kit ----------

type Draft = ChunkDraft & { items: (ChunkDraft["items"][number] & { edited?: boolean })[] };

/** Where an item settled by Specs (not the owner) says it came from. */
export const SETTLED_SOURCE = { upload: "specs", location: "settled at intake" } as const;

/** What an item looked like before a settlement touched it, so Undo can put it back. */
export type Restore = { chunk: ExtractChunkId; label: string; value: string; confidence: Confidence; added?: boolean };

const numberTokens = (s: string) => (s.match(/[$£€]?\d[\d.,/]*/g) ?? []).map((t) => t.replace(/[.,]$/, ""));

/**
 * An item that rests on the same disagreement, brought in line with how it was resolved. If it
 * already says the answer, it stays; if it quotes exactly one of the conflict's figures and the
 * answer has exactly one, that figure is swapped; otherwise the answer is added after it.
 */
export function reconcile(value: string, sidesSay: string[], answer: string): string {
  const ans = numberTokens(answer);
  if (!ans.length || ans.every((t) => value.includes(t))) return value;
  const conflictTokens = new Set(sidesSay.flatMap(numberTokens));
  const inItem = numberTokens(value).filter((t) => conflictTokens.has(t));
  if (new Set(inItem).size === 1 && ans.length === 1) return value.split(inItem[0]!).join(ans[0]!);
  return `${value} (answer: ${answer})`;
}

/**
 * Writes a resolved conflict into the kit: a "resolved: …" item in its chunk, and every doubtful
 * item that rested on the same disagreement brought in line and closed. Returns the new drafts
 * and what to restore on Undo.
 */
export function writeConflict(
  chunks: IntakeChunks,
  conflict: number,
  chunk: ExtractChunkId,
  text: string,
  by: "owner" | "settled",
): { drafts: Partial<Record<ExtractChunkId, Draft>>; restore: Restore[] } {
  const c = chunks.conflicts!.conflicts[conflict]!;
  const source = by === "owner" ? { upload: "owner", location: "intake answer" } : { ...SETTLED_SOURCE };
  const confidence: Confidence = by === "owner" ? "high" : "medium";
  const drafts: Partial<Record<ExtractChunkId, Draft>> = {};
  const draftOf = (id: ExtractChunkId): Draft =>
    (drafts[id] ??= structuredClone(chunks[id]?.draft ?? { summary: "From the owner's answers during intake.", confidence: "medium", items: [], missing: [] }) as Draft);
  const restore: Restore[] = [];

  const label = `resolved: ${c.about}`;
  const sides = by === "settled" ? c.sides.filter((s) => s.says === text).map((s) => s.source) : [];
  draftOf(chunk).items.push({ label, value: text, why: by === "settled" ? c.suggestion : null, sources: [...sides, source], confidence, edited: true });
  restore.push({ chunk, label, value: text, confidence, added: true });

  for (const r of relatedItems(chunks, conflict)) {
    const d = draftOf(r.chunk);
    const item = d.items[r.index];
    if (!item) continue;
    restore.push({ chunk: r.chunk, label: item.label, value: item.value, confidence: item.confidence });
    d.items[r.index] = { ...item, value: reconcile(item.value, c.sides.map((s) => s.says), text), confidence, sources: [...item.sources, source], edited: true };
  }
  return { drafts, restore };
}

/** A doubtful item kept as drafted: no longer needs review, with Specs as the one who kept it. */
export function keepItem(draft: Draft, index: number, chunk: ExtractChunkId): { draft: Draft; restore: Restore[] } {
  const d = structuredClone(draft);
  const item = d.items[index]!;
  const restore: Restore[] = [{ chunk, label: item.label, value: item.value, confidence: item.confidence }];
  d.items[index] = { ...item, confidence: "medium", sources: [...item.sources, { ...SETTLED_SOURCE }] };
  return { draft: d, restore };
}

/** Puts items back the way a settlement found them: added items removed, changed ones restored. */
export function undoRestore(draft: Draft, restore: Restore[]): Draft {
  const d = structuredClone(draft);
  for (const r of restore) {
    const i = d.items.findIndex((x) => x.label === r.label);
    if (i < 0) continue;
    if (r.added) {
      d.items.splice(i, 1);
      continue;
    }
    const item = d.items[i]!;
    d.items[i] = {
      ...item,
      value: r.value,
      confidence: r.confidence,
      sources: item.sources.filter((s) => !(s.upload === SETTLED_SOURCE.upload && s.location === SETTLED_SOURCE.location)),
    };
  }
  return d;
}
