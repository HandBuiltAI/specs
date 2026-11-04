// Brand-composed layouts: code, not the model, owns the copy, colors and fonts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkComposition, checkCss, buildComposedPage } from "../core/compose.ts";

const slots = { headline: "FOLD IT.", subhead: "Lengthwise, so the tip doesn't flop.", cta: null, badge: "ONE HAND.", quote: null, attribution: null, date: null, details: null };
const good = {
  html: '<section class="wall"><h1 data-slot="headline"></h1><p data-slot="subhead"></p><div class="sign"><span data-slot="badge"></span></div></section><footer data-slot="wordmark"></footer><i aria-hidden="true">→</i>',
  css: ".wall{position:absolute;inset:var(--safe-margin)} h1{font-family:var(--font-heading);color:var(--role-heading);font-size:220px} .sign{background:var(--role-text);color:var(--role-background);transform:rotate(var(--stamp-rotation));box-shadow:0 0 30px color-mix(in srgb, var(--role-accent) 60%, transparent)}",
};

test("a composition that follows the rules passes", () => {
  const r = checkComposition(good, slots, false);
  assert.deepEqual(r.errors, []);
});

test("literal colors, font names, urls and redefined tokens are refused", () => {
  assert.ok(checkCss("h1{color:#ff0000}").some((e) => /hex/.test(e)));
  assert.ok(checkCss("h1{color:rgb(1,2,3)}").some((e) => /color function/.test(e)));
  assert.ok(checkCss("h1{background:hotpink}").some((e) => /named color/.test(e)));
  assert.ok(checkCss("h1{font-family:Arial}").some((e) => /font-family/.test(e)));
  assert.ok(checkCss("h1{background:url(x.png)}").some((e) => /url/.test(e)));
  assert.ok(checkCss(":root{--role-heading:var(--color-neon)}").some((e) => /redefines/.test(e)));
  assert.ok(checkCss('h1::after{content:"SALE"}').some((e) => /content/.test(e)));
  assert.deepEqual(checkCss('#x .y{color:var(--role-text)} h1::before{content:"“"}'), []);
});

test("the model can't add copy, inline styles, scripts or missing slots", () => {
  const extraText = { ...good, html: good.html.replace("</section>", "<p>50% OFF</p></section>") };
  assert.ok(checkComposition(extraText, slots, false).errors.some((e) => /text of its own/.test(e)));
  const filled = { ...good, html: good.html.replace('<h1 data-slot="headline"></h1>', '<h1 data-slot="headline">FOLD IT NOW</h1>') };
  assert.ok(checkComposition(filled, slots, false).errors.some((e) => /must be empty/.test(e)));
  const styled = { ...good, html: good.html.replace('class="wall"', 'class="wall" style="color:red"') };
  assert.ok(checkComposition(styled, slots, false).errors.some((e) => /style/.test(e)));
  const script = { ...good, html: good.html + "<script></script>" };
  assert.ok(checkComposition(script, slots, false).errors.some((e) => /script/.test(e)));
  const noBadge = { ...good, html: good.html.replace('<span data-slot="badge"></span>', "") };
  assert.ok(checkComposition(noBadge, slots, false).errors.some((e) => /badge slot must appear/.test(e)));
  assert.ok(checkComposition(good, slots, true).errors.some((e) => /photo must appear/.test(e)));
});

test("code fills the copy, escaped, with the classes the pins look for", () => {
  const page = buildComposedPage({ composition: good, slots: { ...slots, headline: "<b>FOLD</b> IT." }, aspect: "1:1", tokensCss: ":root{}", wordmarkLines: ["THIRD SHIFT", "SLICE"] });
  assert.match(page, /<h1 class="headline" data-slot="headline">&lt;b&gt;FOLD&lt;\/b&gt; IT\.<\/h1>/);
  assert.match(page, /class="badge stamp" data-slot="badge">ONE HAND\./);
  assert.match(page, /<footer class="wordmark" data-slot="wordmark"><span>THIRD SHIFT<\/span><span>SLICE<\/span><\/footer>/);
  assert.match(page, /<main class="post post--1x1 composed">/);
});
