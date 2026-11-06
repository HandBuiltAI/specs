// Bolder posts spike (Nov 6): schemas for the directions and art-critique steps, and "echoes",
// the one markup addition the bold designer gets. An echo is an empty element with
// data-echo="<slot>" that code fills with that slot's exact words, as decorative texture (a giant
// "$3" behind the price). It can't add words: it only repeats copy that's already approved.
// Everything else goes through core/compose.ts unchanged.
import { z } from "zod";
import { checkComposition, type ComposeCheck, type ProbeIssue, type TextSlot } from "../../core/compose.ts";
import { escapeHtml } from "../../core/templates.ts";

export const DirectionsSchema = z.object({
  photo_notes: z.string().describe("What the photo shows that matters for layout, including anything in it that states a fact (prices, signs, hours)."),
  fact_conflicts: z.array(z.string()).describe("Conflicts between the copy and the kit's facts. Empty if none."),
  directions: z.array(
    z.object({
      label: z.string().describe("A, B or C."),
      name: z.string().describe("Two to five words."),
      idea: z.string().describe("The idea in one sentence."),
      hero: z.string().describe("The one thing that dominates, and how big."),
      composition: z.string().describe("Where everything goes, top to bottom, in two to four sentences."),
      treatments: z.array(z.string()).describe("Toolkit treatments by name."),
      uses_photo: z.boolean(),
      photo_treatment: z.string().describe("Crop, grade or shape; what's cropped out and why. 'none' when the photo isn't used."),
      logo: z.string().describe("The logo's size and place."),
      breaks: z.string().describe("The one rule or habit it breaks on purpose."),
      energy_fit: z.string().describe("Why this is right for the brand's energy level."),
    }),
  ),
});
export type Directions = z.infer<typeof DirectionsSchema>;
export type Direction = Directions["directions"][number];

export const ArtCritiqueSchema = z.object({
  candidates: z.array(
    z.object({
      label: z.string(),
      idea: z.number().describe("1 to 5"),
      stop: z.number().describe("1 to 5"),
      brand: z.number().describe("1 to 5"),
      legible: z.number().describe("1 to 5"),
      honesty: z.array(z.string()).describe("Facts the picture states that the copy doesn't, or that contradict it. Empty if none."),
      notes: z.string().describe("One or two sentences."),
    }),
  ),
  winner: z.string().describe("The winning candidate's label."),
  why: z.string(),
  revision: z.array(z.string()).describe("At most four concrete CSS-level fixes for the winner. Empty if it's ready."),
  fact_conflicts: z.array(z.string()).describe("Conflicts between the copy and the kit's facts. Empty if none."),
});
export type ArtCritique = z.infer<typeof ArtCritiqueSchema>;

const ECHO_RE = /<([a-zA-Z0-9]+)(\s[^>]*?)?\sdata-echo=["']?([\w-]+)["']?([^>]*)>([\s\S]*?)<\/\1>/g;

/** Checks a bold composition: the usual checks, plus the echo rules. */
export function checkBold(c: { html: string; css: string }, slots: Partial<Record<TextSlot, string | null>>, hasPhoto: boolean): ComposeCheck {
  const errors: string[] = [];
  const echoes = [...c.html.matchAll(ECHO_RE)];
  if (echoes.length > 2) errors.push(`At most two echoes (found ${echoes.length}).`);
  for (const m of echoes) {
    const slot = m[3]!;
    if (!slots[slot as TextSlot]) errors.push(`The echo of "${slot}" repeats a slot with no copy.`);
    if (m[5]!.trim()) errors.push(`The echo of "${slot}" must be empty; code fills it.`);
    if (/data-slot=/.test(m[0].slice(0, m[0].indexOf(">")))) errors.push("An element can't be both a slot and an echo.");
  }
  if (/data-echo=/.test(c.html.replace(ECHO_RE, ""))) errors.push("Every data-echo element needs a closing tag and nothing inside it.");
  const base = checkComposition({ html: c.html.replace(/\sdata-echo=["']?[\w-]+["']?/g, ""), css: c.css }, slots, hasPhoto);
  const all = [...errors, ...base.errors];
  return { ok: all.length === 0, errors: [...new Set(all)] };
}

/** Fills each echo with its slot's words (decorative, hidden from screen readers). */
export function fillEchoes(html: string, slots: Partial<Record<TextSlot, string | null>>): string {
  return html.replace(ECHO_RE, (_m, tag: string, pre = "", slot: string, post: string) => {
    const attrs = `${pre}${post}`.replace(/\saria-hidden=["']?[\w-]*["']?/g, "");
    const withClass = /\sclass=["']/.test(attrs) ? attrs.replace(/\sclass=(["'])([^"']*)\1/, (_x, q: string, v: string) => ` class=${q}${v} echo${q}`) : `${attrs} class="echo"`;
    return `<${tag}${withClass} data-echo="${slot}" aria-hidden="true">${escapeHtml(slots[slot as TextSlot] ?? "")}</${tag}>`;
  });
}

/**
 * The probe treats the sign-off like text. With a real logo image (its own colors, its own
 * glow) the text contrast and "on the photo" checks don't apply; the critic judges it by eye.
 */
export function relevantIssues(issues: ProbeIssue[], hasLogo: boolean): ProbeIssue[] {
  if (!hasLogo) return issues;
  return issues.filter((i) => !(i.slot === "wordmark" && (i.code === "on_photo" || i.code === "contrast")));
}
