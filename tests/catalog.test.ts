// The A2UI catalog is the guardrail on what the intake agent can show. These tests check that
// the example intake is valid, and that anything outside the catalog is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPONENT_NAMES, catalogAnswers, catalogProps, parseAnswer, parseCall } from "../core/catalog.ts";
import { SAMPLE_CALLS } from "../core/catalog-samples.ts";

test("the catalog has exactly the ten components in the spec", () => {
  assert.deepEqual([...COMPONENT_NAMES].sort(), [
    "BriefForm", "ChoiceChips", "FontPairCard", "KitProgress", "LineCompare",
    "PhotoPicker", "PostPreview", "SourceCard", "SwatchPicker", "ToneSlider",
  ]);
  assert.deepEqual(Object.keys(catalogAnswers).sort(), Object.keys(catalogProps).sort());
});

test("every example call passes its schema, and every component has one", () => {
  for (const call of SAMPLE_CALLS) {
    const r = parseCall(call);
    assert.ok(r.ok, r.ok ? "" : r.error);
  }
  assert.deepEqual(new Set(SAMPLE_CALLS.map((c) => c.component)), new Set(COMPONENT_NAMES));
});

test("components outside the catalog are refused", () => {
  const r = parseCall({ component: "RawHtml", props: { html: "<script>alert(1)</script>" } });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /not in the catalog/);
});

test("bad props are refused with a readable reason", () => {
  const bad = parseCall({ component: "SwatchPicker", props: { title: "Pick", options: [{ id: "a", label: "A", colors: ["red", "#fff"] }] } });
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.error, /hex|at least|>=|too small/i);
  assert.equal(parseCall({ component: "ToneSlider", props: { title: "x", left: { label: "a", sample: "b" }, right: { label: "c", sample: "d" }, value: 140 } }).ok, false);
  assert.equal(parseCall("SwatchPicker").ok, false);
});

test("defaults fill in so the agent can send less", () => {
  const r = parseCall({ component: "ChoiceChips", props: { title: "Who?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } });
  assert.ok(r.ok && r.call.component === "ChoiceChips" && r.call.props.multiple === false);
});

test("answers are checked against each component's answer schema", () => {
  assert.deepEqual(parseAnswer("LineCompare", { pick: "b" }), { pick: "b" });
  assert.deepEqual(parseAnswer("SourceCard", { action: "edit", value: "Box 01" }), { action: "edit", value: "Box 01" });
  assert.throws(() => parseAnswer("LineCompare", { pick: "c" }));
  assert.throws(() => parseAnswer("ToneSlider", { value: -1 }));
  assert.throws(() => parseAnswer("KitProgress", {}), /does not send answers/);
});
