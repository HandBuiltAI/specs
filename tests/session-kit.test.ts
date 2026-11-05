// A visitor's kit: drafted chunks become the files the post pipeline reads, with tokens built in code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kitFromChunks, curatedFont, contrast, businessNameOf } from "../core/session-kit.ts";
import { selectChunks, parseChunks } from "../core/kit.ts";
import type { IntakeChunks } from "../core/intake.ts";

const src = [{ upload: "flyer.pdf", location: "page 1" }];
import type { IntakeItem } from "../core/intake.ts";
const item = (label: string, value: string): IntakeItem => ({ label, value, why: null, sources: src, confidence: "high" });
const draft = (items: IntakeItem[]) => ({ summary: "s", confidence: "high" as const, items, missing: [] });

const chunks: IntakeChunks = {
  "positioning-core": { draft: draft([item("what_it_is", "A pizza window"), item("fact: business_name", "Night Slice")]) },
  "voice-core": { draft: draft([item("tone", "Loud")]) },
  "visual-system": {
    draft: draft([
      item("color: background", "#111111 night black"),
      item("color: body_text", "#222222 (too dark on black)"),
      item("color: accent", "#F5C518 sign yellow"),
      item("type: heading", "Tall condensed poster capitals, like Anton"),
      item("type: body", "Inter"),
    ]),
  },
};

test("colors come from the roles, and unreadable body text is fixed", () => {
  const kit = kitFromChunks(chunks, { name: "Night Slice" });
  assert.equal(kit.colors.background, "#111111");
  assert.equal(kit.colors.accent, "#F5C518");
  assert.ok(contrast(kit.colors.text, kit.colors.background) >= 4.5);
  assert.match(kit.notes.join(" "), /too faint/);
  assert.match(kit.tokensCss, /--role-background: var\(--color-background\)/);
});

test("a second strong brand color the roles left out is kept as accent 2", () => {
  const neon: IntakeChunks = {
    ...chunks,
    "visual-system": { draft: draft([...chunks["visual-system"]!.draft.items, item("color: heading", "#F5C518 sign yellow"), item("color: neon", "#FF2E88 neon pink, the SLICE sign")]) },
  };
  const kit = kitFromChunks(neon, { name: "Night Slice" });
  assert.equal(kit.colors.accent2, "#FF2E88");
  assert.match(kit.tokensCss, /--color-accent-2: #FF2E88;/);
  assert.match(kit.tokensCss, /--role-accent-2: var\(--color-accent-2\);/);
  // No second hue, no accent 2.
  assert.equal(kitFromChunks(chunks, { name: "Night Slice" }).colors.accent2, null);
});

test("fonts: curated names pass through, others get a stand-in by style", () => {
  assert.deepEqual(curatedFont("Inter, 400", "Lora"), { font: "Inter", standIn: false });
  assert.equal(curatedFont("Tall condensed poster capitals", "Inter").font, "Archivo Black");
  assert.equal(curatedFont("a classic garamond", "Inter").font, "Lora");
  const kit = kitFromChunks(chunks, { name: "Night Slice" });
  assert.equal(kit.fonts.heading, "Archivo Black");
  assert.equal(kit.fonts.body, "Inter");
});

test("body text never gets a handwriting face", () => {
  const hand: IntakeChunks = { ...chunks, "visual-system": { draft: draft([...chunks["visual-system"]!.draft.items, item("type: body", "Hand-painted marker lettering, like the menu board")]) } };
  const kit = kitFromChunks(hand, { name: "Night Slice" });
  assert.equal(kit.fonts.body, "Inter");
  assert.match(kit.notes.join(" "), /handwriting face/);
});

test("an owner's palette answer outranks the draft's roles", () => {
  const withPalette: IntakeChunks = {
    ...chunks,
    "visual-system": { draft: draft([...chunks["visual-system"]!.draft.items, item("palette", "Palette: Day (#F4F1EA, #111111, #FF2E88)")]) },
  };
  const kit = kitFromChunks(withPalette, { name: "Night Slice" });
  assert.equal(kit.colors.background, "#F4F1EA");
  assert.equal(kit.colors.text, "#111111");
  assert.equal(kit.colors.accent, "#FF2E88");
});

test("the files load through the same selection the demo kits use", () => {
  const kit = kitFromChunks(chunks, { name: "Night Slice" });
  const picked = selectChunks(kit.files, "post_generate", "tip");
  assert.deepEqual(picked.chunks.map((c) => c.id).sort(), ["art-direction", "social-rules", "terminology", "visual-system", "voice-core"]);
  assert.ok(parseChunks(kit.files).has("positioning-core"));
});

test("the business name comes from the facts list", () => {
  assert.equal(businessNameOf(chunks), "Night Slice");
  assert.equal(businessNameOf({}), null);
});

test("a palette can name the headline color, and posts are held to it", () => {
  const withHeading: IntakeChunks = {
    ...chunks,
    "visual-system": { draft: draft([...chunks["visual-system"]!.draft.items, item("palette", "Palette: Pink titles (#14110F, #FFFFFF, #FFDB04); headings #FF189B")]) },
  };
  const kit = kitFromChunks(withHeading, { name: "Night Slice" });
  assert.equal(kit.colors.heading, "#FF189B");
  assert.equal(kit.colors.text, "#FFFFFF");
  assert.notEqual(kit.colors.accent2, "#FF189B", "the headline pick isn't read as a palette color");
  assert.match(kit.tokensCss, /\[data-slot="headline"\] \{ color: var\(--color-heading\) !important; \}/);
  assert.doesNotMatch(kitFromChunks(chunks, { name: "Night Slice" }).tokensCss, /!important/);
});

test("a logo size answer sets the logo height for every post", () => {
  const sized: IntakeChunks = {
    ...chunks,
    "visual-system": { draft: draft([...chunks["visual-system"]!.draft.items, item("owner: logo size", "Logo size: 130% of the standard size")]) },
  };
  assert.match(kitFromChunks(sized, { name: "Night Slice" }).tokensCss, /--logo-height: 4\.16em;/);
  assert.doesNotMatch(kitFromChunks(chunks, { name: "Night Slice" }).tokensCss, /--logo-height/);
});
