"use client";

// The Make posts board for a demo brand: each precomputed post with its overlay and toggle,
// and the brand kit export.
import type { PropsOf } from "../../../core/catalog.ts";
import { PostPreview } from "../../ui/catalog/PostPreview.tsx";
import { KitDownload } from "../../ui/KitDownload.tsx";

export type BoardPost = { id: string; intent: string; goal: string; critique: string | null; preview: PropsOf<"PostPreview"> };

export default function PostsBoard(props: { brand: string; businessName: string; kit: Record<string, string>; posts: BoardPost[]; costUsd: number | null }) {
  const { brand, businessName, kit, posts, costUsd } = props;
  return (
    <>
      <section className="card posts-kit">
        <div>
          <p className="eyebrow">Brand kit</p>
          <p>
            {Object.keys(kit).length} files: voice, audience, visual system, art direction, rules and guardrails. Drop the
            folder into any AI tool, or hand it to a freelancer.
          </p>
        </div>
        <KitDownload slug={brand} name={businessName} files={kit} />
      </section>

      {posts.length === 0 ? (
        <p className="card muted">This brand&rsquo;s demo posts haven&rsquo;t been made yet.</p>
      ) : (
        <div className="posts-grid">
          {posts.map((p) => (
            <article key={p.id} className="posts-item">
              <header>
                <span className="eyebrow">{p.intent}</span>
                <p className="posts-goal">{p.goal}</p>
              </header>
              <PostPreview {...p.preview} />
            </article>
          ))}
        </div>
      )}
      <p className="muted small">
        These posts were made ahead of time{costUsd ? ` (about $${costUsd.toFixed(2)} in API calls, once)` : ""}, so this page
        costs nothing to visit. The brand and every fact in it are fictional.
      </p>
    </>
  );
}
