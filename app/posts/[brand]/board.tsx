"use client";

// The Make posts board for a demo brand: each precomputed post with its overlay and toggle,
// and the brand kit export.
import { useState } from "react";
import type { PropsOf } from "../../../core/catalog.ts";
import { PostPreview } from "../../ui/catalog/PostPreview.tsx";
import { downloadKitZip } from "../../lib/kit-zip.ts";

export type BoardPost = { id: string; intent: string; goal: string; critique: string | null; preview: PropsOf<"PostPreview"> };

export default function PostsBoard(props: { brand: string; businessName: string; kit: Record<string, string>; posts: BoardPost[]; costUsd: number | null }) {
  const { brand, businessName, kit, posts, costUsd } = props;
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState(false);

  async function exportKit() {
    setZipping(true);
    setZipError(false);
    try {
      await downloadKitZip(brand, businessName, kit);
    } catch {
      setZipError(true);
    } finally {
      setZipping(false);
    }
  }

  return (
    <>
      <section className="card posts-kit">
        <div>
          <p className="eyebrow">Brand kit</p>
          <p>
            {Object.keys(kit).length} files: voice, audience, visual system, art direction, rules and guardrails. Drop the
            folder into any AI tool, or hand it to a freelancer.
          </p>
          {zipError && (
            <p className="c-error" role="alert">
              <b aria-hidden="true">!</b>
              <span>The zip didn&rsquo;t build. Try again.</span>
            </p>
          )}
        </div>
        <button type="button" className="c-btn" onClick={exportKit} disabled={zipping}>
          {zipping ? "Zipping…" : "Download kit (.zip)"}
        </button>
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
