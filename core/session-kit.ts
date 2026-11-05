// A visitor's kit, from drafted chunks to the files the post pipeline reads: one Markdown file
// per chunk (renderChunk), plus the pieces code builds: tokens.css, a readme and the retrieval
// rules. Pure: no file access, so the server, the spike and the tests share it.
//
// Colors and fonts come only from the kit. Colors: the visual-system items by role, or the
// owner's palette answer. Fonts: the named font if it's in the curated free set (so posts render
// exactly), otherwise the closest curated face by style, noted in the readme. Text colors that
// fail contrast fall back to near-black or white, because a post you can't read helps no one.
import { CURATED_FONTS } from "./catalog.ts";
import { EXTRACT_CHUNKS, renderChunk, type ExtractChunkId } from "./extract.ts";
import type { IntakeChunks, IntakeItem } from "./intake.ts";

export type SessionKit = {
  files: Record<string, string>;
  tokensCss: string;
  wordmarkLines: string[];
  /** accent2: a second brand color the others left out (a neon next to a sign yellow), or null. */
  colors: { background: string; text: string; heading: string; accent: string; label: string; accent2: string | null };
  fonts: { heading: string; body: string; wordmark: string; hand: string };
  /** Plain notes on what code decided (font stand-ins, contrast fixes), shown in the readme. */
  notes: string[];
};

// ---------- color ----------

const HEX = /#[0-9a-f]{6}\b/gi;
const hexes = (s: string) => (s.match(HEX) ?? []).map((h) => h.toUpperCase());
const channel = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const saturation = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return Math.max(r, g, b) - Math.min(r, g, b);
};
const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
};
const INK = "#141414";
const WHITE = "#FFFFFF";
const bestInk = (bg: string) => (contrast(INK, bg) >= contrast(WHITE, bg) ? INK : WHITE);

// The latest item wins: intake appends or edits, so an owner's answer comes after the draft's guess.
const lastItem = (items: IntakeItem[], ...prefixes: string[]) =>
  [...items].reverse().find((i) => prefixes.some((p) => i.label.toLowerCase().trim().startsWith(p)));

function pickColors(items: IntakeItem[], notes: string[]) {
  const role = (p: string) => hexes(lastItem(items, p)?.value ?? "")[0];
  const palette = hexes(lastItem(items, "palette")?.value ?? "");
  const any = [...new Set(items.filter((i) => i.label.toLowerCase().startsWith("color")).flatMap((i) => hexes(i.value)))];
  const pool = palette.length ? palette : any;

  // An owner's palette answer outranks the draft's role guesses.
  let background = (palette.length ? palette[0] : role("color: background")) ?? pool[0] ?? "#F5F3EF";
  let text = (palette.length ? undefined : role("color: body_text")) ?? [...pool].filter((h) => h !== background).sort((a, b) => contrast(b, background) - contrast(a, background))[0] ?? bestInk(background);
  const heading0 = (palette.length ? undefined : role("color: heading")) ?? text;
  const accent0 =
    (palette.length ? undefined : role("color: accent")) ??
    [...pool].filter((h) => h !== background && h !== text).sort((a, b) => saturation(b) - saturation(a))[0] ??
    text;

  if (contrast(text, background) < 4.5) {
    const fixed = bestInk(background);
    notes.push(`Body text ${text} on ${background} is too faint to read (${contrast(text, background).toFixed(1)}:1), so posts use ${fixed} for body text.`);
    text = fixed;
  }
  const heading = contrast(heading0, background) >= 3 ? heading0 : text;
  if (heading !== heading0) notes.push(`Heading color ${heading0} is too faint on ${background}, so headings use the body text color.`);
  const accent = accent0;
  const label = contrast(background, accent) >= contrast(text, accent) ? background : text;
  // Keep a second strong color when the brand has one the roles didn't use, so a layout can reach
  // it: a colorful hue clearly different from the heading and accent, readable on the background.
  const used = [background, text, heading, accent];
  const accent2 =
    [...pool]
      .filter((h) => !used.includes(h) && saturation(h) >= 0.35 && used.filter((u) => saturation(u) >= 0.35).every((u) => hueGap(h, u) >= 40) && contrast(h, background) >= 3)
      .sort((a, b) => saturation(b) - saturation(a))[0] ?? null;
  return { background, text, heading, accent, label, accent2 };
}

// ---------- fonts ----------

const SCRIPT_FONTS = new Set<string>(["Caveat"]);

type Curated = (typeof CURATED_FONTS)[number];
const STYLE_STAND_INS: [RegExp, Curated][] = [
  [/script|hand|brush|marker|written/i, "Caveat"],
  [/condensed|poster|impact|black|heavy|display sans|block/i, "Archivo Black"],
  [/didone|high.contrast|fashion|editorial serif/i, "Playfair Display"],
  [/old.?style|garamond|book|classic serif|humanist serif/i, "Lora"],
  [/serif|slab|soft serif/i, "Fraunces"],
  [/geometric|grotesk|grotesque/i, "Space Grotesk"],
  [/mono|typewriter/i, "IBM Plex Sans"],
];

/** The curated font for a font name or description, and whether it's a stand-in. */
export function curatedFont(raw: string | undefined, fallback: Curated): { font: Curated; standIn: boolean } {
  if (!raw) return { font: fallback, standIn: false };
  const named = [...CURATED_FONTS].sort((a, b) => b.length - a.length).find((f) => raw.toLowerCase().includes(f.toLowerCase()));
  if (named) return { font: named, standIn: false };
  const styled = STYLE_STAND_INS.find(([re]) => re.test(raw.replace(/sans.?serif/gi, "sans")))?.[1];
  return { font: styled ?? fallback, standIn: true };
}

function pickFonts(items: IntakeItem[], notes: string[]) {
  const pair = lastItem(items, "fonts")?.value.match(/Fonts:\s*(.+?) for headings, (.+?) for body/i);
  const heading = curatedFont(pair?.[1] ?? lastItem(items, "type: heading")?.value, "Fraunces");
  let body = curatedFont(pair?.[2] ?? lastItem(items, "type: body")?.value, "Inter");
  // A handwriting face is for a word or two, never for sentences people must read on a phone.
  if (SCRIPT_FONTS.has(body.font)) {
    notes.push(`Body text: ${body.font} is a handwriting face, so posts set body text in Inter and keep ${body.font} for hand-written notes.`);
    body = { font: "Inter", standIn: false };
  }
  const wordmark = curatedFont(lastItem(items, "type: wordmark")?.value, heading.font);
  const handItem = items.find((i) => /script|hand|marker/i.test(`${i.label} ${i.value}`) && i.label.toLowerCase().startsWith("type"));
  const hand = handItem ? curatedFont(handItem.value, "Caveat").font : body.font;
  for (const [role, r, item] of [["Headings", heading, pair?.[1] ?? lastItem(items, "type: heading")?.value], ["Body text", body, pair?.[2] ?? lastItem(items, "type: body")?.value]] as const) {
    if (r.standIn && item) notes.push(`${role}: "${item.slice(0, 60)}" isn't in the free font set, so posts use ${r.font} as a stand-in.`);
  }
  return { heading: heading.font, body: body.font, wordmark: wordmark.font, hand };
}

// ---------- files ----------

const DISPLAY_FONTS = new Set<string>(["Archivo Black", "DM Serif Display", "Playfair Display", "Instrument Serif", "Syne"]);

export function buildTokensCss(colors: SessionKit["colors"], fonts: SessionKit["fonts"]): string {
  const font = (f: string) => `"${f}", system-ui, sans-serif`;
  const headingWeight = DISPLAY_FONTS.has(fonts.heading) ? 400 : 700;
  const lines = [
    `  --color-background: ${colors.background};`,
    `  --color-text: ${colors.text};`,
    `  --color-heading: ${colors.heading};`,
    `  --color-accent: ${colors.accent};`,
    `  --color-label: ${colors.label};`,
    ...(colors.accent2 ? [`  --color-accent-2: ${colors.accent2};`] : []),
    `  --font-wordmark: ${font(fonts.wordmark)};`,
    `  --weight-wordmark: ${DISPLAY_FONTS.has(fonts.wordmark) || SCRIPT_FONTS.has(fonts.wordmark) ? 400 : 700};`,
    `  --tracking-wordmark: 0;`,
    `  --wordmark-line2-tracking: 0.3em;`,
    `  --wordmark-line2-scale: 0.45;`,
    `  --font-heading: ${font(fonts.heading)};`,
    `  --weight-heading: ${headingWeight};`,
    `  --tracking-heading: -0.01em;`,
    `  --min-size-heading: 56px;`,
    `  --font-body: ${font(fonts.body)};`,
    `  --weight-body: 400;`,
    `  --leading-body: 1.4;`,
    `  --min-size-body: 30px;`,
    `  --font-hand: ${font(fonts.hand)};`,
    `  --weight-hand: 400;`,
    `  --min-size-hand: 40px;`,
    `  --radius: 0px;`,
    `  --stamp-rotation: -3deg;`,
    `  --safe-margin: 80px;`,
    `  --unit: 8px;`,
    `  --role-background: var(--color-background);`,
    `  --role-text: var(--color-text);`,
    `  --role-heading: var(--color-heading);`,
    `  --role-accent: var(--color-accent);`,
    `  --role-wordmark: var(--color-heading);`,
    `  --role-label: var(--color-label);`,
    ...(colors.accent2 ? [`  --role-accent-2: var(--color-accent-2);`] : []),
  ];
  return `/* Built by Specs from this kit's visual-system chunk. */\n:root {\n${lines.join("\n")}\n}\n`;
}

const RETRIEVAL_RULES = `# Which chunks load for each job. Built by Specs for a kit drafted from uploads.
version: 1
profiles:
  post_generate:
    always: [voice-core, visual-system, art-direction, social-rules, terminology]
    if_relevant:
      - chunk: positioning-core
        when: The post states a fact (offer, price, date, place).
      - chunk: voice-examples
        when: Always useful for headlines; drop first if over budget.
      - chunk: audience
        when: The brief is about winning new customers (promo, announcement).
      - chunk: guardrails
        when: Promo, testimonial, tip, or any post that makes a claim.
    budget: 3000
  post_critique:
    always: [voice-core, art-direction, guardrails, social-rules]
    if_relevant:
      - chunk: terminology
        when: The copy names the brand's own things.
      - chunk: positioning-core
        when: The copy states a fact that needs checking.
    budget: 2000
`;

/** The kit a session's posts are made from, built from its drafted (and intake-answered) chunks. */
export function kitFromChunks(chunks: IntakeChunks, business: { name: string }): SessionKit {
  const notes: string[] = [];
  const visual = chunks["visual-system"]?.draft.items ?? [];
  const colors = pickColors(visual, notes);
  const fonts = pickFonts(visual, notes);
  const files: Record<string, string> = {};
  const ids: ExtractChunkId[] = [];
  for (const { id } of EXTRACT_CHUNKS) {
    const draft = chunks[id]?.draft;
    if (!draft) continue;
    files[`${id}.md`] = renderChunk(id, draft);
    ids.push(id);
  }
  // The pipeline's profile always loads these; an empty chunk beats a crash when one wasn't drafted.
  for (const id of ["voice-core", "visual-system", "art-direction", "social-rules", "terminology"] as const) {
    if (!files[`${id}.md`]) files[`${id}.md`] = `---\nchunk_id: ${id}\nconfidence: needs-review\nsummary: >-\n  Not drafted; nothing in the uploads covered it.\n---\n`;
  }
  const tokensCss = buildTokensCss(colors, fonts);
  files["tokens.css"] = tokensCss;
  files["_retrieval-rules.yaml"] = RETRIEVAL_RULES;
  files["readme.md"] = [
    "---",
    "chunk_id: readme",
    "confidence: medium",
    "summary: >-",
    `  The brand kit for ${business.name.replace(/\n/g, " ")}, drafted by Specs from the owner's uploads and answers.`,
    "---",
    "",
    `# ${business.name} brand kit`,
    "",
    "Drafted by Specs from the owner's uploads, then checked with the owner. Each chunk is one idea; every item says which upload it came from.",
    "",
    "## Chunks",
    "",
    ...ids.map((id) => `- \`${id}.md\`: ${EXTRACT_CHUNKS.find((c) => c.id === id)!.title}`),
    "- `tokens.css`: colors and fonts as CSS variables, built from visual-system",
    "",
    "## Colors and fonts in posts",
    "",
    `Background ${colors.background}, body text ${colors.text}, headings ${colors.heading}, accent ${colors.accent}${colors.accent2 ? `, second accent ${colors.accent2}` : ""}. Headings in ${fonts.heading}, body in ${fonts.body}.`,
    ...(notes.length ? ["", ...notes.map((n) => `- ${n}`)] : []),
    "",
  ].join("\n");
  return { files, tokensCss, wordmarkLines: [business.name], colors, fonts, notes };
}

/** The business's name, from the positioning facts list, or null when no upload gave it. */
export function businessNameOf(chunks: IntakeChunks): string | null {
  const item = lastItem(chunks["positioning-core"]?.draft.items ?? [], "fact: business_name", "fact: business name", "fact: name", "business_name", "name");
  const name = item?.value.split(/\n/)[0]?.replace(/^["“]|["”]$/g, "").trim();
  return name ? name.slice(0, 60) : null;
}

const SINGLE_WEIGHT = new Set(["Archivo Black", "DM Serif Display", "Instrument Serif"]);

/** The Google Fonts stylesheet for a kit's curated fonts, for rendering its posts in the browser. */
export function googleFontsHref(fonts: string[]): string {
  const families = [...new Set(fonts)].filter((f) => (CURATED_FONTS as readonly string[]).includes(f)).sort();
  const spec = (f: string) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}${SINGLE_WEIGHT.has(f) ? "" : ":wght@400;700"}`;
  return `https://fonts.googleapis.com/css2?${families.map(spec).join("&")}&display=swap`;
}
