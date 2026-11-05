// The A2UI component catalog (spec, "A2UI component catalog"). The intake agent can render only
// these ten components, so these schemas are the guardrail: the server validates every component
// the agent asks for against them before it reaches the browser, and the browser validates again
// before rendering. Each component also has an answer schema for what it sends back.
//
// Pure: no file access and no React, so the server, the spike and the browser all share it.
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a six-digit hex color like #687853");
const id = z.string().min(1).max(60);
const short = (max: number) => z.string().min(1).max(max);

/** Every question is set in two tones: `title` in ink, then `titleMuted` in gray ("Which palette is" / "really yours?"). */
const heading = { title: short(80), titleMuted: z.string().max(60).optional() };

export const sourceRef = z.object({ upload: short(120), location: z.string().max(80).optional() });
export type SourceRef = z.infer<typeof sourceRef>;

export const KIT_CHUNKS = [
  "positioning-core",
  "brand-about",
  "voice-core",
  "voice-examples",
  "terminology",
  "audience",
  "visual-system",
  "art-direction",
  "social-rules",
  "guardrails",
] as const;
const chunkId = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/, "a chunk id like voice-core");
const whyNote = z.object({
  decision: short(160),
  choice: z.string().max(400).optional(),
  reason: z.string().max(600).optional(),
  chunks: z.array(chunkId).max(6),
});

export const POST_INTENTS = ["promo", "announcement", "event", "testimonial", "tip"] as const;

export const catalogProps = {
  SwatchPicker: z.object({
    ...heading,
    options: z
      .array(z.object({ id, label: short(40), note: z.string().max(60).optional(), colors: z.array(hex).min(2).max(6), heading: hex.optional(), sources: z.array(sourceRef).max(3).default([]) }))
      .min(2)
      .max(3),
  }),
  FontPairCard: z.object({
    ...heading,
    options: z
      .array(z.object({ id, display: short(40), body: short(40), note: z.string().max(60).optional(), sample: z.string().max(60).optional() }))
      .min(1)
      .max(3),
  }),
  ToneSlider: z.object({
    ...heading,
    left: z.object({ label: short(24), sample: short(140) }),
    right: z.object({ label: short(24), sample: short(140) }),
    middle: z.string().max(140).optional(),
    value: z.number().min(0).max(100).default(50),
    /** A size slider (the logo): the line reads the size as a percent of the standard, half to double. */
    size: z.boolean().optional(),
  }),
  ChoiceChips: z.object({
    ...heading,
    options: z.array(z.object({ id, label: short(36) })).min(2).max(8),
    multiple: z.boolean().default(false),
  }),
  LineCompare: z.object({
    ...heading,
    a: z.object({ text: short(200), source: sourceRef.optional() }),
    b: z.object({ text: short(200), source: sourceRef.optional() }),
  }),
  PhotoPicker: z.object({
    ...heading,
    mode: z.enum(["choose", "exclude"]),
    photos: z.array(z.object({ id, src: short(400), alt: short(140), note: z.string().max(60).optional() })).min(2).max(9),
    max: z.number().int().min(1).max(9).default(3),
  }),
  SourceCard: z.object({
    chunk: chunkId,
    label: short(40),
    fact: short(160),
    sources: z.array(sourceRef).min(1).max(4),
    conflict: z.object({ text: short(200), sources: z.array(sourceRef).max(3).default([]) }).optional(),
  }),
  BriefForm: z.object({
    ...heading,
    intent: z.enum(POST_INTENTS),
    fields: z
      .array(
        z.object({
          id,
          label: short(40),
          kind: z.enum(["text", "textarea", "date"]),
          required: z.boolean().default(false),
          maxChars: z.number().int().min(1).max(600).default(120),
          placeholder: z.string().max(80).optional(),
        }),
      )
      .min(1)
      .max(6),
  }),
  PostPreview: z.object({
    format: z.enum(["1:1", "4:5"]),
    /** The filled template HTML. Rendered in a frame with scripts off. */
    html: z.string().min(1).max(60_000),
    alt: short(200),
    /** "Why this works": each decision with the kit chunks behind it. Pinned to the post where it can be. */
    rationale: z.array(whyNote).max(16),
    caption: short(2200).optional(),
    /** The same brief made with no kit, for the with / without toggle. */
    baseline: z
      .object({ format: z.enum(["1:1", "4:5"]), html: z.string().min(1).max(60_000), alt: short(200), rationale: z.array(whyNote).max(16), caption: short(2200).optional() })
      .optional(),
    /** File name stem for the PNG download. */
    fileName: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
  }),
  KitProgress: z.object({
    chunks: z.array(z.object({ id: chunkId, status: z.enum(["complete", "needs-review", "missing"]) })).min(1).max(16),
  }),
} as const;

export type ComponentName = keyof typeof catalogProps;
export const COMPONENT_NAMES = Object.keys(catalogProps) as ComponentName[];
export type PropsOf<N extends ComponentName> = z.output<(typeof catalogProps)[N]>;
export type InputPropsOf<N extends ComponentName> = z.input<(typeof catalogProps)[N]>;

/** What each component sends back when the person answers. `null` means it never answers. */
export const catalogAnswers = {
  SwatchPicker: z.object({ optionId: id }),
  FontPairCard: z.object({ optionId: id }),
  ToneSlider: z.object({ value: z.number().min(0).max(100) }),
  ChoiceChips: z.object({ optionIds: z.array(id).min(1) }),
  LineCompare: z.object({ pick: z.enum(["a", "b", "neither"]) }),
  PhotoPicker: z.object({ photoIds: z.array(id) }),
  SourceCard: z.union([z.object({ action: z.literal("confirm") }), z.object({ action: z.literal("edit"), value: short(160) })]),
  BriefForm: z.object({ values: z.record(z.string(), z.string().max(600)) }),
  PostPreview: null,
  KitProgress: null,
} as const;
export type AnswerOf<N extends ComponentName> = (typeof catalogAnswers)[N] extends z.ZodType ? z.output<(typeof catalogAnswers)[N]> : never;

/** Where each component's answer is written (spec table). Shown on the card so the person sees what changes. */
export const WRITES_TO: Record<ComponentName, string | null> = {
  SwatchPicker: "visual-system",
  FontPairCard: "visual-system",
  ToneSlider: "voice-core",
  ChoiceChips: null, // any chunk: the agent says which
  LineCompare: "voice-examples",
  PhotoPicker: "art-direction",
  SourceCard: null, // the fact's own chunk
  BriefForm: "post brief",
  PostPreview: null,
  KitProgress: null,
};

/** One A2UI turn from the agent: a single component (spec: one component per turn). */
export type CatalogCall = { [N in ComponentName]: { component: N; props: InputPropsOf<N> } }[ComponentName];

export type ParsedCall = { [N in ComponentName]: { component: N; props: PropsOf<N> } }[ComponentName];

/** Validate a component call. Unknown components and bad props are rejected, never rendered. */
export function parseCall(input: unknown): { ok: true; call: ParsedCall } | { ok: false; error: string } {
  const shape = z.object({ component: z.string(), props: z.unknown() }).safeParse(input);
  if (!shape.success) return { ok: false, error: "Expected { component, props }." };
  const name = shape.data.component as ComponentName;
  const schema = catalogProps[name];
  if (!schema) return { ok: false, error: `"${shape.data.component}" is not in the catalog.` };
  const props = schema.safeParse(shape.data.props);
  if (!props.success) return { ok: false, error: `${name}: ${props.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  return { ok: true, call: { component: name, props: props.data } as ParsedCall };
}

export function parseAnswer<N extends ComponentName>(name: N, input: unknown): AnswerOf<N> {
  const schema = catalogAnswers[name];
  if (!schema) throw new Error(`${name} does not send answers.`);
  return schema.parse(input) as AnswerOf<N>;
}

/** The curated free fonts for FontPairCard and "Change the look". The browser loads only these from Google Fonts; any other name falls back to a system face. */
export const CURATED_FONTS = [
  "Fraunces",
  "Atkinson Hyperlegible",
  "Caveat",
  "DM Serif Display",
  "Work Sans",
  "Inter",
  "Playfair Display",
  "Space Grotesk",
  "Archivo Black",
  "Libre Franklin",
  "Instrument Serif",
  "Manrope",
  "Bricolage Grotesque",
  "IBM Plex Sans",
  "Lora",
  "Syne",
] as const;

/** A size slider's position (0–100, 50 = standard) as a percent of the standard size: half to double. */
export const sizePercent = (v: number) => Math.round(100 * 2 ** ((v - 50) / 50));
/** The slider position for a percent of the standard size, clamped to half and double. */
export const sliderForPercent = (pct: number) => Math.round(50 + 50 * Math.log2(Math.min(200, Math.max(50, pct)) / 100));
