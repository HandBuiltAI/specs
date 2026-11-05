// Phase 5, "Fill the gaps": the completeness check, the shape of one intake turn, and how an
// answer is written back into the kit. Pure: no file access, so the server, the tests and the
// gate script share it.
//
// The check runs in code, not in the model: a kit is complete when every chunk has its required
// items, nothing is still marked needs-review, and every conflict between uploads has an answer
// (or was settled from the uploads, or skipped). Which gaps get asked is decided in code too
// (core/triage.ts); the model only chooses how to ask.
import { z } from "zod";
import type { ComponentName, ParsedCall } from "./catalog.ts";
import { EXTRACT_CHUNKS, type ChunkDraft, type ConflictTopic, type Conflicts, type ExtractChunkId } from "./extract.ts";
import { TOPIC_CHUNK } from "./triage.ts";
import { asData, fillPrompt } from "./prompts.ts";

// ---------- the kit as intake sees it ----------

export type IntakeItem = ChunkDraft["items"][number] & { edited?: boolean };
export type IntakeChunks = Partial<Record<ExtractChunkId, { draft: ChunkDraft & { items: IntakeItem[] } }>> & {
  conflicts?: { conflicts: Conflicts["conflicts"] };
};
/** answered: the owner said. settled: Specs settled it from the uploads (undoable). skipped: left as is. */
export type Resolution = { status: "answered" | "settled" | "skipped"; text?: string };
export type Resolutions = Record<string, Resolution>;

/** What each chunk must hold before the kit counts as complete. Labels match by prefix. */
export const REQUIRED: Record<ExtractChunkId, { slot: string; topic: string; match: string[] }[]> = {
  "positioning-core": [
    { slot: "what_it_is", topic: "what the business is", match: ["what_it_is"] },
    { slot: "who_its_for", topic: "who it's for", match: ["who_its_for"] },
  ],
  "brand-about": [{ slot: "description", topic: "a plain description of the business", match: ["description"] }],
  audience: [{ slot: "segment", topic: "the main customer", match: ["segment"] }],
  "voice-core": [{ slot: "tone", topic: "how the brand sounds", match: ["tone", "rule"] }],
  "voice-examples": [{ slot: "approved_line", topic: "a line that sounds like the brand", match: ["approved_line"] }],
  terminology: [{ slot: "use", topic: "the brand's own words for its things", match: ["use"] }],
  "visual-system": [
    { slot: "color: background", topic: "the background color", match: ["color: background", "palette"] },
    { slot: "color: body_text", topic: "the body text color", match: ["color: body_text", "palette"] },
    { slot: "color: accent", topic: "the accent color", match: ["color: accent", "palette"] },
    { slot: "type: heading", topic: "the heading font", match: ["type: heading", "fonts"] },
    { slot: "type: body", topic: "the body font", match: ["type: body", "fonts"] },
  ],
  // Layout is partly a design call, so it's never a required gap; the compose step falls back to the template without it.
  "layout-system": [],
  "art-direction": [{ slot: "photo_rule", topic: "how photos should look", match: ["photo_rule", "strongest_photo", "hero_photos"] }],
  "social-rules": [{ slot: "post_rule", topic: "how posts work", match: ["post_rule", "cta_style", "caption_length"] }],
  guardrails: [{ slot: "never", topic: "what never to say or show", match: ["never_say", "never_claim", "never_show"] }],
};

export type Gap = {
  id: string;
  kind: "conflict" | "needs-review" | "missing";
  chunk: ExtractChunkId | "conflicts";
  /** One line for the model and the transcript. */
  about: string;
  /** Evidence for the model: the item, the conflict's sides, or what's missing. */
  detail: string;
  item?: { index: number; label: string };
  conflict?: number;
  slot?: string;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
const matches = (label: string, prefixes: string[]) => prefixes.some((p) => label.toLowerCase().trim().startsWith(p));
const cite = (s: { upload: string; location: string }[]) => s.map((x) => `${x.upload}, ${x.location}`).join("; ");

/** Every open gap, in the order a person would want them: conflicts, then doubtful items, then missing ones. */
export function findGaps(chunks: IntakeChunks, resolutions: Resolutions): Gap[] {
  const gaps: Gap[] = [];
  (chunks.conflicts?.conflicts ?? []).forEach((c, i) => {
    gaps.push({
      id: `conflict:${i}:${slug(c.about)}`,
      kind: "conflict",
      chunk: "conflicts",
      about: `Uploads disagree: ${c.about}`,
      detail: `${c.sides.map((s) => `"${s.says}" (${cite([s.source])})`).join(" vs ")}. Suggestion: ${c.suggestion}`,
      conflict: i,
    });
  });
  for (const { id: chunk } of EXTRACT_CHUNKS) {
    const draft = chunks[chunk]?.draft;
    draft?.items.forEach((item, index) => {
      if (item.confidence !== "needs-review") return;
      gaps.push({
        id: `item:${chunk}:${slug(item.label)}:${index}`,
        kind: "needs-review",
        chunk,
        about: `Not sure about ${chunk} → ${item.label}`,
        detail: `"${item.value}"${item.why ? ` (why: ${item.why})` : ""}. Sources: ${cite(item.sources)}`,
        item: { index, label: item.label },
      });
    });
    for (const req of REQUIRED[chunk]) {
      if (draft?.items.some((i) => matches(i.label, req.match))) continue;
      gaps.push({
        id: `need:${chunk}:${slug(req.slot)}`,
        kind: "missing",
        chunk,
        about: `Missing from ${chunk}: ${req.topic}`,
        detail: draft ? `No item for ${req.topic} yet. The draft lists as missing: ${draft.missing.join("; ") || "nothing"}.` : `The ${chunk} chunk wasn't drafted.`,
        slot: req.slot,
      });
    }
  }
  return gaps.filter((g) => !resolutions[g.id]);
}

export type ChunkProgress = { id: string; status: "complete" | "needs-review" | "missing" };

/** One row per chunk for KitProgress: missing when it has no draft, needs-review while any of its gaps is open. */
export function progress(chunks: IntakeChunks, gaps: Gap[]): ChunkProgress[] {
  const rows: ChunkProgress[] = EXTRACT_CHUNKS.map(({ id }) => ({
    id,
    status: !chunks[id] ? "missing" : gaps.some((g) => g.chunk === id) ? "needs-review" : "complete",
  }));
  if (chunks.conflicts?.conflicts.length) rows.push({ id: "conflicts", status: gaps.some((g) => g.kind === "conflict") ? "needs-review" : "complete" });
  return rows;
}

// ---------- one turn ----------

/** The catalog components intake may use. BriefForm and PostPreview belong to making posts; KitProgress is always on screen. */
export const INTAKE_COMPONENTS = ["SourceCard", "ChoiceChips", "SwatchPicker", "FontPairCard", "ToneSlider", "LineCompare", "PhotoPicker"] as const satisfies readonly ComponentName[];

// The props travel as a JSON string, not as a nested schema: a union of all seven components'
// props compiles to a structured-output grammar the API rejects as too large (gate run, Nov 4).
// The prompt lists each component's props, and the server checks them strictly with parseCall.
// Code picks the gap (core/triage.ts); the model only chooses how to ask about it.
export const IntakeTurnSchema = z.object({
  say: z.string().describe("At most one short sentence to the owner, shown above the component. Plain words, no greeting."),
  component: z.enum(INTAKE_COMPONENTS).describe("Exactly one component from the catalog."),
  props: z.string().describe("The component's props as one JSON object, following that component's shape in the catalog section."),
});
export type IntakeTurnOutput = z.infer<typeof IntakeTurnSchema>;

/** A change the owner asked for in their own words: one component (or none, with a one-sentence answer), and where the answer goes. */
export const ChangeTurnSchema = z.object({
  say: z.string().describe("One short sentence to the owner: what the answer changes on their posts, or the answer itself when component is none."),
  component: z.enum([...INTAKE_COMPONENTS, "none"]).describe("Exactly one component from the catalog, or none."),
  props: z.string().describe("The component's props as one JSON object; {} for none."),
  chunk: z.enum(EXTRACT_CHUNKS.map((c) => c.id) as [ExtractChunkId, ...ExtractChunkId[]]).describe("The kit chunk the answer is written into."),
  about: z.string().describe("What the owner asked for, in at most six words."),
});
export type ChangeTurnOutput = z.infer<typeof ChangeTurnSchema>;

/** The gap a change request stands for, so its answer is written like any other. */
export function requestGap(id: string, chunk: ExtractChunkId, about: string, component: string | null): Gap {
  const slot = component === "SwatchPicker" ? "color" : component === "FontPairCard" ? "type" : component === "PhotoPicker" && chunk === "art-direction" ? "photos" : `owner: ${about.toLowerCase().replace(/[^a-z0-9 ]+/g, "").trim().slice(0, 40)}`;
  return { id, kind: "missing", chunk, about, detail: "", slot };
}

export function changePrompt(
  promptText: string,
  input: { chunks: IntakeChunks; transcript: Transcript; photos: string[]; sampled: { upload: string; colors: string[] }[]; fonts: readonly string[]; message: string },
) {
  const d = asData;
  const summaries = EXTRACT_CHUNKS.map(({ id }) => {
    const c = input.chunks[id]?.draft;
    return c ? `- ${id} (${c.confidence}): ${d(c.summary)}` : `- ${id}: not drafted`;
  }).join("\n");
  const visual = (input.chunks["visual-system"]?.draft.items ?? []).map((i) => `- ${d(i.label)}: ${d(i.value)}`).join("\n") || "- not drafted";
  const transcript = input.transcript.length ? input.transcript.slice(-6).map((t) => `- ${d(t.say)} → owner: ${d(t.answer)}`).join("\n") : "- nothing asked yet";
  return fillPrompt("change", promptText, {
    summaries,
    visual,
    transcript,
    photos: input.photos.map((p) => `- ${d(p)}`).join("\n") || "- none uploaded",
    colors: input.sampled.map((s) => `- ${d(s.upload)}: ${s.colors.join(", ")}`).join("\n") || "- no photos",
    fonts: input.fonts.join(", "),
    owner_message: d(input.message),
  });
}

/** The model's component call as plain data, ready for parseCall. Bad JSON comes back as an error. */
export function rawCall(out: IntakeTurnOutput): { ok: true; call: { component: string; props: unknown } } | { ok: false; error: string } {
  try {
    const props: unknown = JSON.parse(out.props);
    if (!props || typeof props !== "object" || Array.isArray(props)) return { ok: false, error: "props isn't a JSON object" };
    return { ok: true, call: { component: out.component, props } };
  } catch {
    return { ok: false, error: "props isn't valid JSON" };
  }
}

/** First sentence only, capped: the spec allows one component plus at most one sentence per turn. */
export function oneSentence(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  const first = t.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? t;
  return first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first;
}

// ---------- the prompt ----------

export type Transcript = { gap: string; say: string; component: string; answer: string }[];

export function intakePrompt(
  promptText: string,
  input: {
    chunks: IntakeChunks;
    gaps: Gap[];
    transcript: Transcript;
    photos: string[];
    sampled: { upload: string; colors: string[] }[];
    fonts: readonly string[];
    ownerMessage?: string;
  },
) {
  const d = asData;
  const summaries = EXTRACT_CHUNKS.map(({ id }) => {
    const c = input.chunks[id]?.draft;
    return c ? `- ${id} (${c.confidence}): ${d(c.summary)}` : `- ${id}: not drafted`;
  }).join("\n");
  // The gap code picked, then any others the same answer covers (a palette fills every color slot).
  const gaps = input.gaps.map((g, i) => `- ${i === 0 ? "ask about" : "same answer covers"}: ${d(g.about)}\n  kind: ${g.kind}\n  detail: ${d(g.detail)}`).join("\n");
  const transcript = input.transcript.length
    ? input.transcript.slice(-6).map((t) => `- asked about ${t.gap} with ${t.component}: "${d(t.say)}" → owner: ${d(t.answer)}`).join("\n")
    : "- nothing asked yet";
  const colors = input.sampled.map((s) => `- ${d(s.upload)}: ${s.colors.join(", ")}`).join("\n") || "- no photos";
  return fillPrompt("intake", promptText, {
    summaries,
    gaps,
    transcript,
    photos: input.photos.map((p) => `- ${d(p)}`).join("\n") || "- none uploaded",
    colors,
    fonts: input.fonts.join(", "),
    owner_message: input.ownerMessage ? d(input.ownerMessage) : "(none)",
  });
}

// ---------- answers ----------

/** The owner's answer as one plain sentence: what the transcript shows and what the kit stores. */
export function describeAnswer(call: ParsedCall, answer: unknown): string {
  const a = answer as Record<string, unknown>;
  switch (call.component) {
    case "SwatchPicker": {
      const o = call.props.options.find((x) => x.id === a.optionId);
      return o ? `Palette: ${o.label} (${o.colors.join(", ")})` : "Palette: none of these";
    }
    case "FontPairCard": {
      const o = call.props.options.find((x) => x.id === a.optionId);
      return o ? `Fonts: ${o.display} for headings, ${o.body} for body text` : "Fonts: none of these";
    }
    case "ToneSlider": {
      const v = Number(a.value);
      const { left, right, middle } = call.props;
      const line = middle ? (v < 34 ? left.sample : v > 66 ? right.sample : middle) : v < 50 ? left.sample : right.sample;
      return `Tone: ${v} on a scale from ${left.label} (0) to ${right.label} (100). Closest sample: "${line}"`;
    }
    case "ChoiceChips": {
      const ids = (a.optionIds as string[]) ?? [];
      return call.props.options.filter((o) => ids.includes(o.id)).map((o) => o.label).join(", ") || "None of these";
    }
    case "LineCompare":
      return a.pick === "a" ? `Sounds like us: "${call.props.a.text}"` : a.pick === "b" ? `Sounds like us: "${call.props.b.text}"` : `Neither sounds like us: "${call.props.a.text}" / "${call.props.b.text}"`;
    case "PhotoPicker": {
      const ids = (a.photoIds as string[]) ?? [];
      const picked = call.props.photos.filter((p) => ids.includes(p.id)).map((p) => p.alt);
      return call.props.mode === "choose" ? `Hero photos: ${picked.join("; ") || "none"}` : picked.length ? `Leave out: ${picked.join("; ")}` : "Keep every photo";
    }
    case "SourceCard":
      return a.action === "edit" ? String(a.value) : `Confirmed: ${call.props.fact}`;
    default:
      return JSON.stringify(answer);
  }
}

export const OWNER_SOURCE = { upload: "owner", location: "intake answer" } as const;

/** The label an answer is stored under, so it fills the gap's required slot. */
function labelFor(gap: Gap, call: ParsedCall | null): string {
  if (gap.item) return gap.item.label;
  if (gap.slot) {
    if (call?.component === "SwatchPicker" && gap.slot.startsWith("color")) return "palette";
    if (call?.component === "FontPairCard" && gap.slot.startsWith("type")) return "fonts";
    if (call?.component === "PhotoPicker" && gap.chunk === "art-direction") return "hero_photos";
    return gap.slot;
  }
  return `resolved: ${gap.about.replace(/^Uploads disagree: /, "")}`;
}

/** The chunk a conflict's answer is written to: the one the agent named on its SourceCard, if it's a real chunk. */
export function targetChunk(gap: Gap, call: ParsedCall | null, topic?: ConflictTopic): ExtractChunkId {
  if (gap.chunk !== "conflicts") return gap.chunk;
  const named = call?.component === "SourceCard" ? call.props.chunk : null;
  return (EXTRACT_CHUNKS.find((c) => c.id === named)?.id ?? (topic ? TOPIC_CHUNK[topic] : "positioning-core")) as ExtractChunkId;
}

/**
 * Writes an answer into a chunk draft. A doubtful item becomes the owner's (confirmed as is, or
 * replaced by the answer); a missing item or a resolved conflict is added as a new item. Either
 * way it's marked high confidence with the owner as its source.
 */
export function applyAnswer(
  draft: (ChunkDraft & { items: IntakeItem[] }) | undefined,
  gap: Gap,
  call: ParsedCall | null,
  text: string,
  confirmed: boolean,
): ChunkDraft & { items: IntakeItem[] } {
  const base = draft ?? { summary: "From the owner's answers during intake.", confidence: "medium" as const, items: [], missing: [] };
  const items = [...base.items];
  const owner = { ...OWNER_SOURCE };
  if (gap.item) {
    // Find the item by index, or by label if the list changed since the gap was found.
    const i = items[gap.item.index]?.label === gap.item.label ? gap.item.index : items.findIndex((x) => x.label === gap.item!.label);
    if (i >= 0) {
      const cur = items[i]!;
      items[i] = { ...cur, value: confirmed ? cur.value : text, confidence: "high", edited: true, sources: [...cur.sources, owner] };
      return { ...base, items };
    }
  }
  items.push({ label: labelFor(gap, call), value: text, why: null, sources: [owner], confidence: "high", edited: true });
  return { ...base, items };
}
