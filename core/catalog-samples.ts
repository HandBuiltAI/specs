// Example props for every catalog component, written as an intake for the fictional Half Acre
// Club demo brand. The /catalog page renders them, and tests check they pass the catalog schemas.
// Lines come from the hand-built kit (voice-examples, about-us); the second option in each choice
// is a made-up alternative so there is something to choose between.
import type { CatalogCall } from "./catalog.ts";

const POST_HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,700,100,1;1,9..144,900,100,1&family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<style>
html,body{margin:0;width:1080px;height:1350px;background:#F2E8D5;color:#322B23;font-family:"Atkinson Hyperlegible",sans-serif}
.p{position:absolute;inset:0;padding:96px;display:flex;flex-direction:column;justify-content:space-between}
.stamp{width:150px;height:150px;border-radius:50%;border:5px solid #BD4937;color:#BD4937;display:grid;place-items:center;font:700 30px/1 "Atkinson Hyperlegible";letter-spacing:.12em;transform:rotate(-8deg)}
h1{font-family:Fraunces,serif;font-weight:700;color:#687853;font-size:150px;line-height:.95;letter-spacing:-.02em;margin:0}
p{font-size:44px;line-height:1.3;max-width:780px;margin:36px 0 0}
.wm{font-family:Fraunces,serif;font-style:italic;font-weight:900;font-size:56px;line-height:1}
.wm span{display:block;font-style:normal;font-weight:700;font-size:26px;letter-spacing:.32em;margin-top:6px}
</style></head><body><div class="p">
<div class="stamp">BOX 01</div>
<div><h1>Box 01: pea shoots.</h1><p>Ten days from soil to first cut. Ships the first week of the month.</p></div>
<div class="wm">Half Acre<span>CLUB</span></div>
</div></body></html>`;

export const SAMPLE_CALLS: CatalogCall[] = [
  {
    component: "KitProgress",
    props: {
      chunks: [
        { id: "positioning-core", status: "complete" },
        { id: "brand-about", status: "needs-review" },
        { id: "voice-core", status: "complete" },
        { id: "voice-examples", status: "complete" },
        { id: "terminology", status: "complete" },
        { id: "audience-renters", status: "complete" },
        { id: "visual-system", status: "needs-review" },
        { id: "art-direction", status: "complete" },
        { id: "social-rules", status: "complete" },
        { id: "guardrails", status: "missing" },
      ],
    },
  },
  {
    component: "SwatchPicker",
    props: {
      title: "Which palette is",
      titleMuted: "really yours?",
      options: [
        { id: "pdf", label: "From your notes PDF", note: "4 named swatches", colors: ["#F2E8D5", "#322B23", "#687853", "#BD4937"], sources: [{ upload: "rough-notes.pdf", location: "page 2" }] },
        { id: "photos", label: "Sampled from photos", note: "warmer, lighter", colors: ["#E9DCC7", "#3B3127", "#7C8A62", "#C9653F"], sources: [{ upload: "3 photos" }] },
      ],
    },
  },
  {
    component: "ToneSlider",
    props: {
      title: "How should Half Acre",
      titleMuted: "sound?",
      left: { label: "Plain-spoken", sample: "Box 01 is pea shoots. Ten days from soil to first cut." },
      right: { label: "Playful", sample: "Tiny salad, big ego. Ten days to glory." },
      middle: "Pea shoots. Ten days. One windowsill. You've got this.",
      value: 50,
    },
  },
  {
    component: "SourceCard",
    props: {
      chunk: "brand-about",
      label: "First box",
      fact: "Your first box is Box 01: pea shoots.",
      sources: [{ upload: "about-us.md" }, { upload: "rough-notes.pdf", location: "page 1" }],
      conflict: { text: "Your box photo shows a label that says BOX No. 014.", sources: [{ upload: "photo-01-box-opened.jpg" }] },
    },
  },
  {
    component: "ChoiceChips",
    props: {
      title: "Who is this",
      titleMuted: "mostly for?",
      options: [
        { id: "renters", label: "Renters, no yard" },
        { id: "parents", label: "Parents and kids" },
        { id: "gifts", label: "Gift buyers" },
        { id: "growers", label: "Experienced growers" },
      ],
    },
  },
  {
    component: "LineCompare",
    props: {
      title: "Which sounds",
      titleMuted: "more like you?",
      a: { text: "Elevate your meals with fresh, nutrient-dense greens." },
      b: { text: "Cut a handful. Put it on toast.", source: { upload: "rough-notes.pdf", location: "page 1" } },
    },
  },
  {
    component: "FontPairCard",
    props: {
      title: "We found two type pairs.",
      titleMuted: "Which one?",
      options: [
        { id: "fraunces", display: "Fraunces", body: "Atkinson Hyperlegible", note: "wordmark · notes PDF", sample: "One small thing to grow." },
        { id: "dmserif", display: "DM Serif Display", body: "Work Sans", note: "made-up alternative", sample: "One small thing to grow." },
      ],
    },
  },
  {
    component: "PhotoPicker",
    props: {
      title: "Pick up to two",
      titleMuted: "hero photos.",
      mode: "choose",
      max: 2,
      photos: [
        { id: "p1", src: "/demo/half-acre/photo-01-box-opened.jpg", alt: "The box opened on a kitchen counter", note: "box label conflict" },
        { id: "p2", src: "/demo/half-acre/photo-02-day-six-sill.jpg", alt: "Pea shoots on a windowsill, day six" },
        { id: "p3", src: "/demo/half-acre/photo-03-first-cut.jpg", alt: "The first cut of pea shoots" },
      ],
    },
  },
  {
    component: "BriefForm",
    props: {
      title: "Tell us about",
      titleMuted: "the announcement.",
      intent: "announcement",
      fields: [
        { id: "what", label: "What are you announcing?", kind: "text", required: true, maxChars: 80, placeholder: "Box 01 ships" },
        { id: "when", label: "When does it happen?", kind: "date", required: false },
        { id: "details", label: "Anything people need to know", kind: "textarea", required: false, maxChars: 240 },
      ],
    },
  },
  {
    component: "PostPreview",
    props: {
      format: "4:5",
      html: POST_HTML,
      alt: "Cream post with the green headline 'Box 01: pea shoots.' and a red BOX 01 stamp",
      rationale: [
        { decision: "Cream fills most of the post, so it reads as paper first.", chunks: ["visual-system"] },
        { decision: "The headline uses the sample announcement line, word for word.", chunks: ["voice-examples"] },
        { decision: "Red only on the stamp: the one thing to notice.", chunks: ["visual-system", "art-direction"] },
        { decision: "No price or date in the post; the brief didn't give one.", chunks: ["guardrails"] },
      ],
    },
  },
];
