// Structured output shapes for each step.
import { z } from "zod";
import { TEMPLATE_IDS } from "./templates.ts";

const Rationale = z.array(
  z.object({
    decision: z.string().describe("What was decided, e.g. 'template', 'photo', 'headline'."),
    choice: z.string().describe("What was chosen."),
    reason: z.string().describe("Why, in one or two sentences."),
    cites: z.array(z.string()).describe("Kit chunk IDs that drove this decision. Empty if none."),
  }),
);

export const PlanSchema = z.object({
  template: z.enum(TEMPLATE_IDS),
  photo: z.string().describe("The chosen photo's file path exactly as listed, or 'none'."),
  angle: z.string().describe("What the copy leads with and why, in one or two sentences."),
  rationale: Rationale,
});
export type Plan = z.infer<typeof PlanSchema>;

const slot = () => z.string().nullable();
export const SlotsSchema = z.object({
  headline: slot(),
  subhead: slot(),
  cta: slot(),
  badge: slot(),
  quote: slot(),
  attribution: slot(),
  date: slot(),
  details: slot(),
  caption: z.string(),
});
export type Slots = z.infer<typeof SlotsSchema>;

export const WriteSchema = z.object({ slots: SlotsSchema, rationale: Rationale });
export type Written = z.infer<typeof WriteSchema>;

export const CritiqueSchema = z.object({
  verdict: z.enum(["pass", "revise"]),
  summary: z.string().describe("One or two sentences on the post overall."),
  issues: z.array(
    z.object({
      where: z.string().describe("Slot name, 'caption' or 'image'."),
      problem: z.string(),
      rule: z.string().describe("Chunk ID of the rule it breaks, or 'render' for a layout defect."),
      severity: z.enum(["must_fix", "note"]),
      fix: z.string(),
    }),
  ),
});
export type Critique = z.infer<typeof CritiqueSchema>;
