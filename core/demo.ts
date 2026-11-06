// The precomputed posts a demo brand shows for free: one per brief, with the kit and without.
// Packed from a spike run by spike/pack-demo.ts into brands/<brand>/demo-posts.json.
import { z } from "zod";
import { TEMPLATE_IDS } from "./templates.ts";
import { SlotsSchema } from "./schemas.ts";
import { POST_INTENTS } from "./limits.ts";

export const NoteSchema = z.object({
  decision: z.string(),
  choice: z.string(),
  reason: z.string(),
  cites: z.array(z.string()),
});
export type Note = z.infer<typeof NoteSchema>;

const VersionSchema = z.object({
  template: z.enum(TEMPLATE_IDS),
  /** Photo path relative to the brand folder, e.g. uploads/photo-01.jpg, or null. */
  photo: z.string().nullable(),
  slots: SlotsSchema,
  /** The plan's layout and photo notes, then the final draft's. */
  notes: z.array(NoteSchema),
});

const ComposedSchema = z.object({
  html: z.string(),
  css: z.string(),
  rationale: z.array(NoteSchema),
  sourceRun: z.string(),
});

/** The bold pass, run ahead of time (spike/pack-bold.ts): the critic's top two, best first.
 * "quick" stands for the post as first made (composed or template); others carry their layout. */
const BoldSchema = z.object({
  sourceRun: z.string(),
  costUsd: z.number(),
  why: z.string(),
  energy: z.number().nullable(),
  options: z.array(
    z.object({
      label: z.string(),
      name: z.string(),
      source: z.enum(["quick", "direction", "sketch"]),
      pick: z.boolean(),
      note: z.string(),
      html: z.string().optional(),
      css: z.string().optional(),
      usesPhoto: z.boolean().optional(),
      rationale: z.array(NoteSchema).optional(),
    }),
  ),
});

export const DemoPostsSchema = z.object({
  brand: z.string(),
  sourceRun: z.string(),
  packedAt: z.string(),
  costUsd: z.number(),
  /** What the compose runs cost, once, on top of costUsd. */
  composeCostUsd: z.number().optional(),
  posts: z.array(
    z.object({
      briefId: z.string(),
      intent: z.enum(POST_INTENTS),
      goal: z.string(),
      details: z.string(),
      kit: VersionSchema.extend({
        /** The layout the compose step designed from the kit's layout-system chunk, when it passed
         * every check (spike/pack-compose.ts). Without it the post shows its template. */
        composed: ComposedSchema.optional(),
        bold: BoldSchema.optional(),
        critique: z.object({ verdict: z.enum(["pass", "revise"]), summary: z.string() }).nullable(),
        drafts: z.number().int().min(1),
      }),
      nokit: VersionSchema.nullable(),
    }),
  ),
});
export type DemoPosts = z.infer<typeof DemoPostsSchema>;
export type DemoPost = DemoPosts["posts"][number];
