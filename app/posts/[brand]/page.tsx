import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CONTENT, DEMO_BRAND_IDS, type DemoBrandId } from "../../../server/generated/content.ts";
import { buildPostPage, type PostLook } from "../../../core/post-html.ts";
import { findTemplate, parseTemplates } from "../../../core/templates.ts";
import type { DemoPost, Note } from "../../../core/demo.ts";
import type { PropsOf } from "../../../core/catalog.ts";
import PostsBoard, { type BoardPost } from "./board.tsx";

// Demo brands are precomputed: this page makes no API calls, so it costs nothing to visit.
export const dynamicParams = false;
export function generateStaticParams() {
  return DEMO_BRAND_IDS.map((brand) => ({ brand }));
}

const isDemo = (b: string): b is DemoBrandId => (DEMO_BRAND_IDS as readonly string[]).includes(b);

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand } = await params;
  return { title: isDemo(brand) ? `${CONTENT.brands[brand].businessName} posts · Specs` : "Posts · Specs" };
}

const templates = parseTemplates(CONTENT.templatesManifest);
const INTENT_LABEL: Record<DemoPost["intent"], string> = {
  promo: "Promo",
  announcement: "Announcement",
  event: "Event",
  testimonial: "Testimonial",
  tip: "Tip",
};

export default async function PostsPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  if (!isDemo(brand)) notFound();
  const b = CONTENT.brands[brand];
  // Cite only chunks that exist in this kit, so a note never points at a rule you can't open.
  const chunkIds = new Set(Object.keys(b.kit).map((f) => f.replace(/\.(md|ya?ml|json|css)$/, "")));
  const base = { css: CONTENT.baseCss };
  const kitLook: PostLook = { tokensCss: b.kit["tokens.css"] ?? CONTENT.neutralTokensCss, wordmarkLines: b.wordmark, fontsHref: "/generated/fonts/fonts.css", base };
  const plainLook: PostLook = { tokensCss: CONTENT.neutralTokensCss, wordmarkLines: [b.businessName], base };

  const notes = (ns: Note[]) =>
    ns.map((n) => ({ decision: n.decision.slice(0, 160) || "decision", choice: n.choice, reason: n.reason, chunks: n.cites.filter((c) => chunkIds.has(c)).slice(0, 6) }));

  const version = (v: NonNullable<DemoPost["nokit"]>, look: PostLook, label: string) => {
    const t = findTemplate(templates, v.template);
    return {
      format: t.aspect,
      html: buildPostPage({ templateHtml: CONTENT.templates[v.template], look, slots: v.slots, photoSrc: v.photo ? `/generated/${brand}/${v.photo}` : null }),
      alt: `${label}: ${v.slots.headline ?? v.slots.quote ?? t.name}`.slice(0, 200),
      rationale: notes(v.notes).slice(0, 16),
      caption: v.slots.caption?.slice(0, 2200) || undefined,
    } satisfies Omit<PropsOf<"PostPreview">, "baseline" | "fileName">;
  };

  const posts: BoardPost[] = (b.demoPosts?.posts ?? []).map((p) => ({
    id: p.briefId,
    intent: INTENT_LABEL[p.intent],
    goal: p.goal,
    critique: p.kit.critique?.summary ?? null,
    preview: {
      ...version(p.kit, kitLook, "With the kit"),
      baseline: p.nokit ? version(p.nokit, plainLook, "Without the kit") : undefined,
      fileName: `${brand}-${p.briefId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80),
    },
  }));

  return (
    <main className="wide posts">
      <p className="eyebrow">Demo brand · fictional</p>
      <h1>
        {b.businessName} <span>posts, with their reasons.</span>
      </h1>
      <p className="muted posts-lede">
        {b.businessLine} Each post was art-directed from the brand kit. Tap <b>Why this works</b> to see which rule shaped each
        choice, and flip to <b>Without kit</b> to see the same brief made with no kit at all.
      </p>
      <PostsBoard brand={brand} businessName={b.businessName} kit={b.kit} posts={posts} costUsd={b.demoPosts?.costUsd ?? null} />
    </main>
  );
}
