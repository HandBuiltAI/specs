// Builds a finished post page from a template and a look, and maps "why this works" notes to
// the part of the post they're about. Pure: no file access, so the spike, the server and the
// browser all share it.
import { escapeHtml, fill } from "./templates.ts";
import type { Slots } from "./schemas.ts";

/** What a post needs besides its copy: the brand's tokens (or the neutral baseline's) and fonts. */
export type PostLook = {
  tokensCss: string;
  /** Wordmark lines: the brand's lockup, or just the business name for the no-kit baseline. */
  wordmarkLines: string[];
  /** A stylesheet with the brand's @font-face rules, or none for system fonts. */
  fontsHref?: string;
  /** base.css: inlined text, or a link to it. */
  base: { css: string } | { href: string };
};

export function buildPostPage(opts: {
  templateHtml: string;
  look: PostLook;
  slots: Partial<Record<keyof Slots, string | null | undefined>>;
  photoSrc?: string | null;
}): string {
  const { look } = opts;
  const head = [
    look.fontsHref ? `<link rel="stylesheet" href="${escapeHtml(look.fontsHref)}">` : "",
    `<style>${look.tokensCss}</style>`,
    "css" in look.base ? `<style>${look.base.css}</style>` : `<link rel="stylesheet" href="${escapeHtml(look.base.href)}">`,
  ].join("");
  const wordmark = look.wordmarkLines.map((l) => `<span>${escapeHtml(l)}</span>`).join("");
  const slots = Object.fromEntries(Object.entries(opts.slots).map(([k, v]) => [k, v ?? undefined]));
  return fill(opts.templateHtml, { ...slots, head, wordmark, photo_src: opts.photoSrc ?? "" });
}

/**
 * Which element in a post a rationale note is about, from the note's free-text "decision"
 * ("headline", "supporting line", "call to action"...). Null means the note is about the post
 * as a whole (template, angle) or something off the canvas (caption), so it gets no pin.
 */
export function pinTarget(decision: string): string | null {
  const d = decision.toLowerCase();
  const rules: [RegExp, string][] = [
    [/caption|hashtag/, ""],
    [/head ?line|title/, ".headline"],
    [/sub ?head|supporting|second line|subline/, ".subhead"],
    [/call to action|\bcta\b|button/, ".cta"],
    [/quote/, ".quote"],
    [/attribution|byline|credit/, ".attribution"],
    [/date|time|when/, ".date"],
    [/details|where|place|location/, ".details"],
    [/badge|stamp|price|tape|label|note|accent/, ".stamp, .tape, .note, .hand"],
    [/photo|image|picture|shot/, ".photo, .photo-half"],
    [/wordmark|logo|lockup|sign-?off/, ".wordmark"],
  ];
  for (const [re, sel] of rules) if (re.test(d)) return sel || null;
  return null;
}
