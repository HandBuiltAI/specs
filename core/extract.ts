// Extraction (phase 4): what the kit chunks are, the shapes Claude returns at each step, and
// pure helpers that turn those shapes into prompt text and into kit files. Pure: no file
// access, so the spike's gate script and the app's server share it.
//
// Extraction runs in two steps because a deployed function is cut off at about 30 seconds:
//   1. Read: one call per upload turns it into evidence notes, each with where it was found.
//   2. Assemble: one call per kit chunk drafts that chunk from all the evidence, plus one call
//      that looks only for places where the uploads disagree.
// The browser runs the calls and shows each result as it lands, which is the DNA reveal.
import { z } from "zod";
import { fillPrompt, asData } from "./prompts.ts";

// ---------- what gets extracted ----------

export const UPLOAD_KINDS = ["photo", "logo", "pdf", "url", "pasted", "note"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** The kit chunks extraction drafts, in reveal order. readme, tokens.css and _retrieval-rules are built in code later. */
export const EXTRACT_CHUNKS = [
  {
    id: "positioning-core",
    title: "Positioning",
    job: "What the business is, who it serves, the promise, how it differs, and a facts list (offer, price, shipping, location, founding, people) holding only facts an upload states.",
    labels: "what_it_is, who_its_for, promise, differentiator, fact: <name>",
  },
  {
    id: "brand-about",
    title: "About",
    job: "A plain-language description of the business, its origin story and how using it goes, in the brand's own long-form words where possible.",
    labels: "description, origin_story, how_it_goes, name_meaning",
  },
  {
    id: "audience",
    title: "Audience",
    job: "The main customer segment: who they are, their situation, what holds them back, what wins them. One segment unless the uploads clearly name more.",
    labels: "segment, situation, barrier, what_wins_them",
  },
  {
    id: "voice-core",
    title: "Voice",
    job: "How the brand sounds, as rules with reasons. Each rule names a trait and shows it with a line from the uploads.",
    labels: "tone, rule",
  },
  {
    id: "voice-examples",
    title: "Lines",
    job: "Lines the brand has actually written that show its voice, quoted exactly, and do / don't pairs only where an upload gives both sides.",
    labels: "approved_line, do_dont",
  },
  {
    id: "terminology",
    title: "Words",
    job: "Words the brand uses for its own things (product, customers, steps) and words it avoids, with the reason when an upload gives one.",
    labels: "use: <term>, avoid: <term>",
  },
  {
    id: "visual-system",
    title: "Colors and type",
    job: "Colors with their role (background, body text, heading, accent, and any limits), type (heading, body, wordmark), and logo or wordmark style. A hex value must come from the sampled colors or be written in an upload.",
    labels: "color: background, color: body_text, color: heading, color: accent, color: <other role>, type: heading, type: body, type: wordmark, logo",
  },
  {
    id: "art-direction",
    title: "Photos",
    job: "How photos look and why: subject, light, framing, what to keep in, what to avoid, and which uploaded photos are strongest.",
    labels: "photo_rule, strongest_photo, avoid",
  },
  {
    id: "layout-system",
    title: "Layout",
    job: "How this brand lays out a page, so a designer (or the compose step) can make posts that look like this brand and not a template: the layout idea in one line, margins and grid, type scale and case, the two to four graphic devices it uses (tape, stamps, frames, rules, hand notes, stickers) and how photos and type meet, plus what it never does. Read it off the uploads that have a layout (flyers, menus, signs, packaging, labels, the website, the logo). Where they show none, propose devices that grow out of what the uploads show, cite the upload that suggests each one, and mark those medium.",
    labels: "idea, margins, type_scale, device: <name>, photo_and_type, never",
  },
  {
    id: "social-rules",
    title: "Social",
    job: "How posts work for this brand: what to lead with, CTA style, hashtags and emoji, caption length, logo use on posts. Only what the uploads support; list the rest under missing.",
    labels: "post_rule, cta_style, hashtags, caption_length",
  },
  {
    id: "guardrails",
    title: "Guardrails",
    job: "What never to say or show, with the reason: banned words, claims not to make, facts not to invent, things to keep out of photos.",
    labels: "never_say, never_claim, never_show",
  },
] as const;

export type ExtractChunkId = (typeof EXTRACT_CHUNKS)[number]["id"];
export const EXTRACT_CHUNK_IDS = EXTRACT_CHUNKS.map((c) => c.id) as [ExtractChunkId, ...ExtractChunkId[]];

/** Every assemble call: one per chunk, then the conflict check. */
export const ASSEMBLE_TARGETS = [...EXTRACT_CHUNK_IDS, "conflicts"] as const;
export type AssembleTarget = (typeof ASSEMBLE_TARGETS)[number];

// ---------- step 1: read one upload ----------

const Location = z.string().describe("Where in the upload: page number, heading, part of the photo, or URL path. Short.");

export const EvidenceSchema = z.object({
  summary: z.string().describe("One or two sentences on what this upload is and what it's good evidence for."),
  facts: z.array(
    z.object({
      topic: z.enum(["business", "offer", "audience", "voice", "words", "visual", "photo", "social", "guardrail", "other"]),
      statement: z.string().describe("What the upload says or shows, in plain words. No guessing beyond it."),
      quote: z.string().nullable().describe("The exact words from the upload, if there are any. Null for things only seen in a photo."),
      location: Location,
    }),
  ),
  lines: z.array(z.object({ line: z.string().describe("Exact wording, unchanged."), location: Location })).describe("Lines written in the brand's own voice that could be quoted as examples."),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---------- step 2: assemble one chunk ----------

const Source = z.object({
  upload: z.string().describe("The upload's name exactly as given in its <evidence upload=\"...\"> tag."),
  location: Location,
});
export type Source = z.infer<typeof Source>;

const Confidence = z.enum(["high", "medium", "needs-review"]);
export type Confidence = z.infer<typeof Confidence>;

export const ChunkDraftSchema = z.object({
  summary: z.string().describe("One or two sentences on what this chunk says about the brand."),
  confidence: Confidence.describe("high: several uploads agree or one states it outright. medium: inferred from one source. needs-review: thin, guessed or contradicted."),
  items: z.array(
    z.object({
      label: z.string().describe("Short name for the item, e.g. 'promise', 'color: background', 'avoid: foolproof'."),
      value: z.string().describe("The item itself. Quote the upload's words when it has them."),
      why: z.string().nullable().describe("The reason behind it, when an upload gives or clearly implies one. Null otherwise."),
      sources: z.array(Source).describe("Every upload this item rests on. At least one."),
      confidence: Confidence,
    }),
  ),
  missing: z.array(z.string()).describe("What this chunk needs that no upload says. These become questions later. Short phrases."),
});
export type ChunkDraft = z.infer<typeof ChunkDraftSchema>;
export type ChunkItem = ChunkDraft["items"][number];

export const ConflictsSchema = z.object({
  conflicts: z.array(
    z.object({
      about: z.string().describe("What the uploads disagree on, in a few words."),
      sides: z.array(z.object({ says: z.string(), source: Source })).describe("Each version and where it came from. At least two."),
      suggestion: z.string().describe("Which side to trust and why, or what to ask the owner."),
    }),
  ),
});
export type Conflicts = z.infer<typeof ConflictsSchema>;

// ---------- names and prompt text ----------

/** A safe display name for an upload: the file's own name, cleaned, or a label for text and links. */
export function uploadLabel(kind: UploadKind, name: string | null, url?: string): string {
  if (kind === "note") return "note";
  if (kind === "pasted") return "website text";
  if (kind === "url" && url) {
    try {
      const u = new URL(url);
      return (u.host + (u.pathname === "/" ? "" : u.pathname)).slice(0, 80);
    } catch {
      return "website";
    }
  }
  const clean = (name ?? "").replace(/[^\w.\- ]+/g, "").trim().slice(0, 80);
  return clean || (kind === "pdf" ? "document.pdf" : kind === "logo" ? "logo" : "photo");
}

export type SampledColors = { upload: string; colors: { hex: string; share: number }[] };

/** All evidence as one block of text for the assemble calls. Same input, same text, so it caches. */
export function formatEvidence(notes: { upload: string; kind: UploadKind; evidence: Evidence }[], sampled: SampledColors[]): string {
  const blocks = notes.map(({ upload, kind, evidence }) => {
    // Notes quote the uploads, which a visitor wrote, so they go in as data like any free text.
    const d = asData;
    const facts = evidence.facts
      .map((f) => `- [${f.topic}] ${d(f.statement)}${f.quote ? ` | quote: "${d(f.quote)}"` : ""} (${d(f.location)})`)
      .join("\n");
    const lines = evidence.lines.map((l) => `- "${d(l.line)}" (${d(l.location)})`).join("\n");
    return `<evidence upload="${d(upload)}" kind="${kind}">\nSummary: ${d(evidence.summary)}\nFacts:\n${facts || "- none"}\nLines in the brand's voice:\n${lines || "- none"}\n</evidence>`;
  });
  const colors = sampled
    .filter((s) => s.colors.length)
    .map((s) => `- ${s.upload}: ${s.colors.map((c) => `${c.hex} (${Math.round(c.share * 100)}%)`).join(", ")}`)
    .join("\n");
  return `${blocks.join("\n\n")}\n\n<sampled_colors>\nMeasured in code from the pixels, largest share first:\n${colors || "- no photos"}\n</sampled_colors>`;
}

export function targetInstructions(target: AssembleTarget): string {
  if (target === "conflicts") {
    return "Target: conflicts.\nList every place where two uploads disagree on a fact: a number, a name, a date, what's in the product, a color. Include disagreements between a photo and a document. Leave out differences in wording that don't change the fact. An empty list is fine.";
  }
  const c = EXTRACT_CHUNKS.find((x) => x.id === target)!;
  return `Target: the ${c.id} chunk ("${c.title}").\nIt holds: ${c.job}\nUseful labels: ${c.labels}.`;
}

// ---------- prompts ----------

const ATTACHED: Partial<Record<UploadKind, string>> = {
  photo: "(The photo is attached above.)",
  logo: "(The logo is attached above.)",
  pdf: "(The PDF is attached above.)",
};

/** The read prompt for one upload. Text uploads enter only as escaped data inside <upload>. */
export function readPrompt(promptText: string, u: { label: string; kind: UploadKind; text?: string; url?: string }) {
  const content =
    ATTACHED[u.kind] ??
    (u.kind === "url" ? `Web address to fetch: ${u.url}` : asData(u.text ?? ""));
  return fillPrompt("read", promptText, { upload: asData(u.label), kind: u.kind, content });
}

/** The assemble prompt for one target. The evidence travels separately as cached text. */
export function assemblePrompt(promptText: string, target: AssembleTarget) {
  return fillPrompt("assemble", promptText, { target: targetInstructions(target) });
}

// ---------- checks in code ----------

const HEX = /#[0-9a-f]{6}\b/gi;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const distance = (a: string, b: string) => {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

/**
 * A hex value in the draft must be one the uploads wrote down or one sampled from a photo (within
 * a small distance). Anything else is a guess: it stays, marked needs-review, with a warning.
 */
export function checkHexes(draft: ChunkDraft, evidenceText: string, sampled: SampledColors[]): { draft: ChunkDraft; warnings: string[] } {
  const known = new Set([...(evidenceText.match(HEX) ?? [])].map((h) => h.toLowerCase()));
  const measured = sampled.flatMap((s) => s.colors.map((c) => c.hex.toLowerCase()));
  const warnings: string[] = [];
  const items = draft.items.map((item) => {
    const guessed = (item.value.match(HEX) ?? []).filter((h) => {
      const hex = h.toLowerCase();
      return !known.has(hex) && !measured.some((m) => distance(m, hex) < 24);
    });
    if (!guessed.length) return item;
    warnings.push(`${item.label}: ${guessed.join(", ")} isn't in any upload or photo sample, so it's marked needs-review.`);
    return { ...item, confidence: "needs-review" as const };
  });
  return { draft: { ...draft, items }, warnings };
}

/** Drops sources that name an upload that doesn't exist, and items left with none. */
export function checkSources(draft: ChunkDraft, uploads: string[]): { draft: ChunkDraft; warnings: string[] } {
  const known = new Set(uploads);
  const warnings: string[] = [];
  const items = draft.items.flatMap((item) => {
    const sources = item.sources.filter((s) => known.has(s.upload));
    if (sources.length === item.sources.length && sources.length) return [item];
    if (!sources.length) {
      warnings.push(`Dropped "${item.label}": it didn't cite any of the uploads.`);
      return [];
    }
    return [{ ...item, sources }];
  });
  return { draft: { ...draft, items }, warnings };
}

// ---------- kit files ----------

const yamlString = (s: string) => JSON.stringify(s);

/** A drafted chunk as a kit file in the repo's format: YAML front matter, then the items. */
export function renderChunk(id: ExtractChunkId, draft: ChunkDraft): string {
  const sources = new Map<string, Source>();
  for (const item of draft.items) for (const s of item.sources) sources.set(`${s.upload}|${s.location}`, s);
  const front = [
    "---",
    `chunk_id: ${id}`,
    `domain: ${EXTRACT_CHUNKS.find((c) => c.id === id)!.title.toLowerCase()}`,
    `confidence: ${draft.confidence}`,
    "sources:",
    ...[...sources.values()].map((s) => `  - upload: ${yamlString(s.upload)}\n    location: ${yamlString(s.location)}`),
    "version: 1",
    "generated: extraction draft",
    `summary: >-\n  ${draft.summary.replace(/\n+/g, " ")}`,
    "---",
  ];
  const body = draft.items.map((item) => {
    const cite = item.sources.map((s) => `${s.upload}, ${s.location}`).join("; ");
    const flag = item.confidence === "high" ? "" : ` _(${item.confidence})_`;
    return `- **${item.label}:** ${item.value}${item.why ? `\n  Why: ${item.why}` : ""}\n  Source: ${cite}${flag}`;
  });
  const missing = draft.missing.length ? `\n\n## Missing\n\n${draft.missing.map((m) => `- ${m}`).join("\n")}` : "";
  return `${front.join("\n")}\n\n# ${EXTRACT_CHUNKS.find((c) => c.id === id)!.title}\n\n${body.join("\n")}${missing}\n`;
}
