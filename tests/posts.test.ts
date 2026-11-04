// The Make posts screen: notes pin to the right part of a post, a post page carries its copy
// safely, and a spike run packs into demo posts the app accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPostPage, pinTarget } from "../core/post-html.ts";
import { DemoPostsSchema } from "../core/demo.ts";
import { parseCall } from "../core/catalog.ts";

test("notes pin to the element they're about, and whole-post notes stay unpinned", () => {
  assert.equal(pinTarget("headline"), ".headline");
  assert.equal(pinTarget("Supporting line"), ".subhead");
  assert.equal(pinTarget("call to action"), ".cta");
  assert.equal(pinTarget("photo"), ".photo, .photo-half");
  assert.match(pinTarget("price stamp") ?? "", /\.stamp/);
  assert.equal(pinTarget("caption"), null);
  assert.equal(pinTarget("template"), null);
  assert.equal(pinTarget("angle"), null);
});

test("a post page escapes its copy and carries the look", () => {
  const html = buildPostPage({
    templateHtml: "<html><head>{{{head}}}</head><body><h1 class=\"headline\">{{headline}}</h1><div class=\"wordmark\">{{{wordmark}}}</div><img src=\"{{{photo_src}}}\"></body></html>",
    look: { tokensCss: ":root{--x:1}", wordmarkLines: ["Half Acre", "CLUB"], fontsHref: "/generated/fonts/fonts.css", base: { css: ".post{}" } },
    slots: { headline: "<script>alert(1)</script>" },
    photoSrc: "/generated/half-acre-club/uploads/a.jpg",
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<span>Half Acre</span><span>CLUB</span>"));
  assert.ok(html.includes('href="/generated/fonts/fonts.css"'));
});

test("PostPreview takes notes with reasons, a caption and a no-kit baseline", () => {
  const version = { format: "4:5", html: "<p>x</p>", alt: "A post", rationale: [{ decision: "headline", choice: "Hi.", reason: "Short.", chunks: ["voice-core"] }], caption: "Caption." };
  const r = parseCall({ component: "PostPreview", props: { ...version, baseline: { ...version, rationale: [{ decision: "headline", chunks: [] }] }, fileName: "half-acre-club-tip" } });
  assert.ok(r.ok, r.ok ? "" : r.error);
});

test("pack-demo turns a spike run into demo posts, skipping failed versions", () => {
  const brandFile = join("brands", "half-acre-club", "demo-posts.json");
  const saved = existsSync(brandFile) ? readFileSync(brandFile, "utf8") : null;
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  try {
    cpSync(join("tests", "fixtures", "run-sample.json"), join(dir, "run.json"));
    execFileSync(process.execPath, ["--import", "tsx", "spike/pack-demo.ts", dir], { stdio: "pipe" });
    const packed = DemoPostsSchema.parse(JSON.parse(readFileSync(brandFile, "utf8")));
    assert.equal(packed.posts.length, 2);
    const [announce, promo] = packed.posts;
    assert.equal(announce!.kit.notes.length, 6, "plan notes then draft notes");
    assert.equal(announce!.kit.critique?.verdict, "pass");
    assert.ok(announce!.nokit);
    assert.equal(promo!.nokit, null, "the failed no-kit post is left out");
  } finally {
    if (saved === null) rmSync(brandFile, { force: true });
    else writeFileSync(brandFile, saved);
  }
});
