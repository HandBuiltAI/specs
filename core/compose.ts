// Brand-composed layouts (phase 6). The compose step designs a post's HTML and CSS from the kit's
// layout-system chunk; this file is the code that keeps it honest. It never trusts the model
// with copy, colors or fonts:
//   - copy: the model leaves slot elements empty (data-slot="headline"); code fills them with the
//     written slots, so the post can't say anything the write step and its checks didn't approve.
//   - colors and fonts: CSS may only reach them through the kit's tokens (var(--role-*),
//     var(--font-*)); any literal color, font name, url() or @import is refused.
//   - markup: a short list of tags and attributes, no inline styles, no scripts, no free text.
// LAYOUT_PROBE then checks the rendered page (overflow, overlap, contrast, text on photos).
// Pure: no file access, shared by the spike and (later) the app.
import { z } from "zod";
import { escapeHtml } from "./templates.ts";

export const ComposeSchema = z.object({
  html: z.string().describe("The post's inner HTML. Slot elements are empty and carry data-slot."),
  css: z.string().describe("All styles for the post. Colors and fonts only through the kit's CSS variables."),
  rationale: z.array(
    z.object({
      decision: z.string().describe("What was decided, e.g. 'layout', 'headline placement', 'photo crop'."),
      choice: z.string(),
      reason: z.string(),
      cites: z.array(z.string()),
    }),
  ),
});
export type Composition = z.infer<typeof ComposeSchema>;

export const TEXT_SLOTS = ["headline", "subhead", "cta", "badge", "quote", "attribution", "date", "details"] as const;
export type TextSlot = (typeof TEXT_SLOTS)[number];
const ALL_SLOTS = new Set<string>([...TEXT_SLOTS, "photo", "wordmark"]);

// Class names the "why this works" pins look for (core/post-html.ts pinTarget).
const SLOT_CLASSES: Record<string, string> = {
  headline: "headline", subhead: "subhead", cta: "cta", badge: "badge stamp", quote: "quote",
  attribution: "attribution", date: "date", details: "details", photo: "photo", wordmark: "wordmark",
};

const TAGS = new Set(["div", "span", "section", "header", "footer", "figure", "h1", "h2", "h3", "p", "blockquote", "small", "strong", "em", "b", "i", "hr", "img", "br"]);
const VOID = new Set(["img", "hr", "br"]);
const ATTR_OK = /^(class|data-slot|aria-hidden)$/;

// The 148 CSS named colors, minus transparent/currentcolor. A literal color would bypass the kit.
const NAMED_COLORS = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" "),
);
// Custom properties the kit owns; the composition may read them but never redefine them.
const RESERVED_VARS = /^--(role|color|font|weight|tracking|leading|min-size|variation|wordmark|radius|stamp-rotation|safe-margin|unit)\b/;

export type ComposeCheck = { ok: boolean; errors: string[] };

export function checkCss(css: string): string[] {
  const errors: string[] = [];
  if (css.length > 14000) errors.push("CSS is longer than 14,000 characters.");
  const lower = css.toLowerCase();
  for (const bad of ["url(", "@import", "@font-face", "@namespace", "expression(", "javascript:", "behavior:", "-moz-binding", "</", "<!--", "\\", "image-set("])
    if (lower.includes(bad)) errors.push(`CSS uses "${bad}", which isn't allowed.`);
  if (/position\s*:\s*fixed/.test(lower)) errors.push("CSS uses position: fixed.");
  if (/#[0-9a-f]{3,8}\b/.test(lower.replace(/[^{}]*\{/g, "{"))) errors.push("CSS has a literal hex color; use the kit's var(--role-*) or var(--color-*) instead.");
  if (/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/.test(lower)) errors.push("CSS has a literal color function (rgb, hsl...); use the kit's variables, or color-mix() with them.");
  for (const m of css.matchAll(/([-\w]+)\s*:\s*([^;{}]+)/g)) {
    const prop = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    const v = value.toLowerCase();
    if (prop.startsWith("--") && RESERVED_VARS.test(prop)) errors.push(`CSS redefines the kit's ${prop}.`);
    if (prop === "font-family" && !/^(var\(--font-[a-z-]+\)|inherit)$/.test(v)) errors.push(`font-family must be one of the kit's fonts, var(--font-*); got "${value}".`);
    if (prop === "font" ) errors.push('Use font-family and font-size separately, not the "font" shorthand.');
    if (prop === "content" && !/^(none|normal|""|''|counter\([-\w]+\)|"[^"a-z0-9]{0,3}"|'[^'a-z0-9]{0,3}')$/i.test(v))
      errors.push(`content may only be up to three symbols (no letters or digits); got ${value}. Copy comes from the slots.`);
    const words = v.replace(/var\([^)]*\)/g, " ").match(/[a-z]+/g) ?? [];
    const named = words.find((w) => NAMED_COLORS.has(w));
    if (named) errors.push(`CSS uses the named color "${named}" in ${prop}; use the kit's variables.`);
  }
  return [...new Set(errors)];
}

type Tag = { name: string; attrs: Record<string, string>; raw: string; index: number; closing: boolean; selfClosing: boolean };

function tokenize(html: string): { tags: Tag[]; errors: string[] } {
  const errors: string[] = [];
  const tags: Tag[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0;
  for (const m of html.matchAll(re)) {
    const between = html.slice(last, m.index);
    checkText(between, errors);
    last = m.index! + m[0].length;
    const name = m[2]!.toLowerCase();
    const attrs: Record<string, string> = {};
    const rawAttrs = m[3]!.replace(/\/\s*$/, "");
    const attrRe = /([a-zA-Z_:][-\w:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    for (const a of rawAttrs.matchAll(attrRe)) attrs[a[1]!.toLowerCase()] = a[3] ?? a[4] ?? a[5] ?? "";
    tags.push({ name, attrs, raw: m[0], index: m.index!, closing: m[1] === "/", selfClosing: /\/\s*>$/.test(m[0]) || VOID.has(name) });
  }
  checkText(html.slice(last), errors);
  if (/<!--|<!\[|<\?/.test(html)) errors.push("HTML may not contain comments or declarations.");
  return { tags, errors };
}

function checkText(text: string, errors: string[]) {
  const t = text.replace(/&nbsp;|&middot;|&times;|&rarr;|&mdash;|&ndash;|&bull;/g, "·").trim();
  if (!t) return;
  if (/[a-zA-Z0-9]/.test(t) || t.length > 3) errors.push(`HTML has text of its own ("${t.slice(0, 40)}"); all copy goes in data-slot elements, filled by code.`);
}

export function checkComposition(c: Pick<Composition, "html" | "css">, slots: Partial<Record<TextSlot, string | null>>, hasPhoto: boolean): ComposeCheck {
  const errors = [...checkCss(c.css)];
  if (c.html.length > 8000) errors.push("HTML is longer than 8,000 characters.");
  const { tags, errors: textErrors } = tokenize(c.html);
  errors.push(...textErrors);
  const seen: Record<string, number> = {};
  for (const t of tags) {
    if (!TAGS.has(t.name)) { errors.push(`<${t.name}> isn't allowed.`); continue; }
    if (t.closing) continue;
    for (const [k, v] of Object.entries(t.attrs)) {
      if (k === "alt") continue; // harmless on the photo; code replaces it with the photo's own alt text
      if (!ATTR_OK.test(k)) errors.push(`Attribute "${k}" isn't allowed (only class, data-slot, aria-hidden; no inline styles).`);
      if (k === "class" && !/^[-\w\s]*$/.test(v)) errors.push(`Class "${v}" has odd characters.`);
    }
    const slot = t.attrs["data-slot"];
    if (slot !== undefined) {
      if (!ALL_SLOTS.has(slot)) errors.push(`Unknown slot "${slot}".`);
      seen[slot] = (seen[slot] ?? 0) + 1;
      if (slot === "photo" && t.name !== "img") errors.push('The photo slot must be <img data-slot="photo">.');
      if (slot !== "photo" && t.name === "img") errors.push(`Only the photo slot may be an <img>.`);
    } else if (t.name === "img") errors.push("An <img> without data-slot=\"photo\" isn't allowed.");
  }
  // Slot elements must be empty: code fills them.
  for (const m of c.html.matchAll(/<([a-zA-Z0-9]+)(?=[\s>\/])[^>]*data-slot=["']?([\w-]+)["']?[^>]*>([\s\S]*?)<\/\1>/g))
    if (m[3]!.trim()) errors.push(`The ${m[2]} slot element must be empty; code fills it.`);
  for (const s of TEXT_SLOTS) {
    const want = slots[s] ? 1 : 0;
    const got = seen[s] ?? 0;
    if (want && got !== 1) errors.push(`The ${s} slot must appear exactly once (found ${got}).`);
    if (!want && got) errors.push(`The ${s} slot has no copy, so leave it out.`);
  }
  if (hasPhoto && seen.photo !== 1) errors.push(`The photo must appear exactly once (found ${seen.photo ?? 0}).`);
  if (!hasPhoto && seen.photo) errors.push("This post has no photo, so leave the photo slot out.");
  if ((seen.wordmark ?? 0) > 1) errors.push("The wordmark may appear at most once.");
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

/** Base styles every composed post gets after the model's CSS, so the canvas can't be resized. */
export const COMPOSE_BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:#888}
.post{position:relative!important;overflow:hidden!important;margin:0!important;background:var(--role-background);color:var(--role-text);font-family:var(--font-body);font-weight:var(--weight-body);line-height:var(--leading-body,1.35);-webkit-font-smoothing:antialiased}
.post--1x1{width:1080px!important;height:1080px!important}
.post--4x5{width:1080px!important;height:1350px!important}
.post img[data-slot="photo"]{display:block}
.post .wordmark span{display:block}
`;

/** Fills a checked composition with the written copy and builds the full page. */
export function buildComposedPage(opts: {
  composition: Pick<Composition, "html" | "css">;
  slots: Partial<Record<TextSlot, string | null>>;
  aspect: "1:1" | "4:5";
  tokensCss: string;
  fontsHref?: string;
  wordmarkLines: string[];
  photo?: { src: string; alt: string } | null;
}): string {
  const fillTag = (open: string, slot: string) => {
    const cls = SLOT_CLASSES[slot] ?? slot;
    const withClass = /\sclass=["']/.test(open)
      ? open.replace(/\sclass=(["'])([^"']*)\1/, (_, q: string, v: string) => ` class=${q}${v} ${cls}${q}`)
      : open.replace(/^<([a-zA-Z0-9]+)/, `<$1 class="${cls}"`);
    return withClass;
  };
  let html = opts.composition.html;
  html = html.replace(/<([a-zA-Z0-9]+)(?=[\s>\/])([^>]*data-slot=["']?([\w-]+)["']?[^>]*)>\s*<\/\1>/g, (_m, tag: string, attrs: string, slot: string) => {
    const open = fillTag(`<${tag}${attrs}>`, slot);
    if (slot === "wordmark") return `${open}${opts.wordmarkLines.map((l) => `<span>${escapeHtml(l)}</span>`).join("")}</${tag}>`;
    const text = opts.slots[slot as TextSlot];
    return `${open}${escapeHtml(text ?? "")}</${tag}>`;
  });
  html = html.replace(/<img([^>]*data-slot=["']?photo["']?[^>]*?)\/?>/g, (_m, raw: string) => {
    const attrs = raw.replace(/\salt=("[^"]*"|'[^']*'|[^\s>]*)/g, "");
    const open = fillTag(`<img${attrs}>`, "photo").replace(/>$/, "");
    return opts.photo ? `${open} src="${escapeHtml(opts.photo.src)}" alt="${escapeHtml(opts.photo.alt)}">` : "";
  });
  const head = [
    '<meta charset="utf-8">',
    opts.fontsHref ? `<link rel="stylesheet" href="${escapeHtml(opts.fontsHref)}">` : "",
    `<style>${opts.tokensCss}</style>`,
    `<style>${opts.composition.css}</style>`,
    `<style>${COMPOSE_BASE_CSS}</style>`,
  ].join("");
  const cls = opts.aspect === "4:5" ? "post post--4x5 composed" : "post post--1x1 composed";
  return `<!doctype html><html><head>${head}</head><body><main class="${cls}">${html}</main></body></html>`;
}

export const PROBE_CODES = ["off_canvas", "clipped", "not_visible", "small_type", "faded", "on_photo", "contrast", "overlap", "photo_missing", "photo_small"] as const;
export type ProbeCode = (typeof PROBE_CODES)[number];
/** One problem the probe found. `problem` is for people; `code` and `n` are what the browser sends back to the server. */
export type ProbeIssue = { slot: string; problem: string; code: ProbeCode; n?: number };

const SLOT_NAMES = [...TEXT_SLOTS, "photo", "wordmark"] as const;
/** A probe issue as the browser reports it: names and numbers only, never free text, so it can't carry a prompt. */
export const ProbeReportSchema = z.strictObject({
  slot: z.string().regex(new RegExp(`^(${SLOT_NAMES.join("|")})(\\+(${SLOT_NAMES.join("|")}))?$`)),
  code: z.enum(PROBE_CODES),
  n: z.number().finite().min(0).max(10000).optional(),
});

/** The sentence the compose step reads for a reported issue. */
export function probeText(i: { slot: string; code: ProbeCode; n?: number }): string {
  const n = i.n === undefined ? "" : String(Math.round(i.n * 10) / 10);
  const text: Record<ProbeCode, string> = {
    off_canvas: `runs off the canvas${n ? ` (by ${n}px)` : ""}`,
    clipped: "is clipped by its box",
    not_visible: "isn't visible",
    small_type: `type is ${n || "under 24"}px; 24px is the smallest that reads on a phone`,
    faded: "text is faded",
    on_photo: "sits straight on the photo; put it on a panel or move it",
    contrast: `contrast ${n ? `${n}:1 ` : ""}is too low`,
    overlap: "overlap",
    photo_missing: "did not load",
    photo_small: "too small or off the canvas",
  };
  return `${i.slot}: ${text[i.code]}`;
}

/**
 * Runs inside the rendered page (Playwright's page.evaluate) and returns layout problems a
 * person would see: text past the canvas or clipped in its box, text slots overlapping, type
 * too small for a phone, low contrast, or copy sitting straight on the photo.
 */
export const LAYOUT_PROBE = `(() => {
  const post = document.querySelector('.post');
  const P = post.getBoundingClientRect();
  const issues = [];
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const photo = document.querySelector('[data-slot="photo"]');
  const PR = photo ? photo.getBoundingClientRect() : null;
  const hit = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const texts = [...document.querySelectorAll('[data-slot]')].filter((e) => e.dataset.slot !== 'photo');
  // For overlap, use the text's width but the element's line boxes, so tall glyphs in tight
  // leading (stacked poster capitals) don't count as touching the next line.
  const lineBox = (el) => {
    const range = document.createRange(); range.selectNodeContents(el);
    const r = range.getBoundingClientRect(), e = el.getBoundingClientRect();
    const top = Math.max(r.top, e.top), bottom = Math.min(r.bottom, e.bottom);
    return { left: r.left, right: r.right, top, bottom, width: r.width, height: Math.max(1, bottom - top) };
  };
  // The nearest rotated or scaled box around a slot (or the slot itself). Two slots inside the
  // same tilted sign are compared unrotated, because a rotated bounding box is wider than the text.
  const TF = ['transform', 'rotate', 'scale', 'translate'];
  const frame = (el) => { for (let n = el; n && n !== post; n = n.parentElement) { const c = getComputedStyle(n); if (TF.some((p) => c[p] && c[p] !== 'none')) return n; } return null; };
  const boxes = [];
  for (const el of texts) {
    const slot = el.dataset.slot;
    const range = document.createRange(); range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (!r.width || !r.height) { issues.push({ slot, code: 'not_visible', problem: 'not visible' }); continue; }
    const lb = lineBox(el);
    boxes.push({ slot, el, r: lb });
    // Vertically, judge by the line boxes: a display face's font box sits well above its capitals.
    const off = [['left', P.left - r.left], ['top', P.top - lb.top], ['right', r.right - P.right], ['bottom', lb.bottom - P.bottom]].filter(([, d]) => d > 1);
    if (off.length) issues.push({ slot, code: 'off_canvas', n: Math.round(Math.max(...off.map(([, d]) => d))), problem: 'runs off the canvas (' + off.map(([s, d]) => Math.round(d) + 'px past the ' + s).join(', ') + ')' });
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible') issues.push({ slot, code: 'clipped', problem: 'clipped horizontally' });
    if (el.scrollHeight > el.clientHeight + 2 && cs.overflowY !== 'visible') issues.push({ slot, code: 'clipped', problem: 'clipped vertically' });
    const size = parseFloat(cs.fontSize);
    if (slot !== 'wordmark' && size < 24) issues.push({ slot, code: 'small_type', n: Math.round(size), problem: 'type is ' + Math.round(size) + 'px; 24px is the smallest that reads on a phone' });
    if (cs.opacity !== '1' || parseFloat(cs.opacity) < 1) issues.push({ slot, code: 'faded', problem: 'text is faded (opacity ' + cs.opacity + ')' });
    let bg = null, bgEl = el;
    for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a >= 0.85) { bg = c; bgEl = n; break; } if (n === post) break; }
    const fg = parse(cs.color);
    if (PR && [...range.getClientRects()].some((l) => hit(l, PR) > 0.04 * l.width * l.height) && (bgEl === post || !bg)) issues.push({ slot, code: 'on_photo', problem: 'sits straight on the photo; put it on a panel or move it' });
    else if (fg && bg) { const cr = ratio(fg, bg); const large = size >= 40 || (size >= 30 && parseInt(cs.fontWeight) >= 700); if (cr < (large ? 3 : 4.5)) issues.push({ slot, code: 'contrast', n: Math.round(cr * 10) / 10, problem: 'contrast ' + cr.toFixed(1) + ':1 is too low' }); }
  }
  const frames = [...new Set(boxes.map((b) => frame(b.el)).filter(Boolean))];
  const saved = frames.map((f) => f.getAttribute('style'));
  frames.forEach((f) => TF.forEach((p) => f.style.setProperty(p, 'none', 'important')));
  for (const b of boxes) b.flat = lineBox(b.el);
  frames.forEach((f, i) => { if (saved[i] === null) f.removeAttribute('style'); else f.setAttribute('style', saved[i]); });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    let a = boxes[i], b = boxes[j];
    const fa = frame(a.el);
    if (fa && fa === frame(b.el)) { a = { slot: a.slot, r: a.flat }; b = { slot: b.slot, r: b.flat }; }
    if (hit(a.r, b.r) > 0.1 * Math.min(a.r.width * a.r.height, b.r.width * b.r.height)) issues.push({ slot: a.slot + '+' + b.slot, code: 'overlap', problem: 'overlap' });
  }
  if (photo && (!photo.complete || !photo.naturalWidth)) issues.push({ slot: 'photo', code: 'photo_missing', problem: 'did not load' });
  if (PR && hit(PR, P) < 0.08 * P.width * P.height) issues.push({ slot: 'photo', code: 'photo_small', problem: 'too small or off the canvas' });
  return issues;
})()`;
