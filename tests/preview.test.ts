// The build screen's mood board and live post, built from the kit in the browser at no cost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardFrom, previewSlots } from "../core/preview.ts";
import type { IntakeChunks } from "../core/intake.ts";

const S = (upload: string) => ({ upload, location: "" });
const it = (label: string, value: string, upload = "notes.md", confidence: "high" | "medium" | "needs-review" = "high") => ({ label, value, why: null, sources: [S(upload)], confidence });
const draft = (items: ReturnType<typeof it>[]) => ({ draft: { summary: "", confidence: "high" as const, items, missing: [] } });

const kit = (): IntakeChunks => ({
  "positioning-core": draft([it("what_it_is", "Stoneware cups, plates and bowls, made in batches."), it("fact: business_name", "Hollis Ware"), it("fact: cup price", "Cups are $36", "website.md")]),
  "voice-examples": draft([it("approved_line", "Batch 07. Forty pieces.")]),
  "voice-core": draft([it("tone", "Plain, like the tags.")]),
  "visual-system": draft([it("color: background", "#F4F1EC"), it("color: body_text", "#2B2A28"), it("color: accent", "#B5734B"), it("type: heading", "Lora"), it("type: body", "Inter")]),
  guardrails: draft([it("never_say", "artisan, one of a kind")]),
  "art-direction": draft([it("photo_rule", "North light.")]),
});

test("the board shows the brand at a glance, and waits for chunks not yet drafted", () => {
  const b = boardFrom(kit());
  assert.equal(b.name, "Hollis Ware");
  assert.deepEqual(b.palette!.map((c) => c.hex).slice(0, 2), ["#F4F1EC", "#2B2A28"]);
  assert.equal(b.fonts!.heading, "Lora");
  assert.equal(b.voice!.line, "Batch 07. Forty pieces.");
  assert.deepEqual(b.never, ["artisan", "one of a kind"]);
  assert.ok(b.facts!.some((f) => f.value === "Cups are $36"));
  const empty = boardFrom({});
  assert.equal(empty.palette, null);
  assert.equal(empty.voice, null);
});

test("the live post uses the kit's own words, and an answer changes it", () => {
  const files = ["plates.jpg", "tag.jpg"];
  const before = previewSlots(kit(), files);
  assert.deepEqual(before, { headline: "Batch 07. Forty pieces.", subhead: "Stoneware cups, plates and bowls, made in batches.", badge: "$36", photo: "plates.jpg" });

  const k = kit();
  k["positioning-core"]!.draft.items.push(it("resolved: Cup price", "$38", "owner"));
  k["voice-core"]!.draft.items.push(it("tone", 'Tone: 20. Closest sample: "Forty pieces, made to be used."', "owner"));
  k["art-direction"]!.draft.items.push(it("hero_photos", "Hero photos: Cup with its tag (files: tag.jpg)", "owner"));
  const after = previewSlots(k, files);
  assert.equal(after.badge, "$38");
  assert.equal(after.headline, "Forty pieces, made to be used.");
  assert.equal(after.photo, "tag.jpg");

  // A photo kept out of posts is never the lead.
  const out = kit();
  out["art-direction"]!.draft.items.push(it("hero_photos", "Leave out: plates (files: plates.jpg)", "owner"));
  assert.equal(previewSlots(out, files).photo, "tag.jpg");
});
