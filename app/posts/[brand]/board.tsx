"use client";

// The Make posts board for a demo brand: each precomputed post with its overlay and toggle,
// and the brand kit export.
import type { PropsOf } from "../../../core/catalog.ts";
import { PostPreview } from "../../ui/catalog/PostPreview.tsx";
import { KitDownload } from "../../ui/KitDownload.tsx";
import { useState } from "react";

type Rationale = PropsOf<"PostPreview">["rationale"];
export type BoardPost = {
  id: string;
  intent: string;
  goal: string;
  critique: string | null;
  preview: PropsOf<"PostPreview">;
  /** The bold pass's top two, made ahead of time; "quick" is the post as first made. */
  bold?: { why: string; options: { label: string; name: string; pick: boolean; note: string; html: string; rationale: Rationale }[] };
};

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
              {p.bold ? <BoldPost post={p} /> : <PostPreview {...p.preview} />}
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

/** A demo post with its bold pass: "As first made" and the bolder versions, the critic's pick marked. */
function BoldPost({ post }: { post: BoardPost }) {
  const bold = post.bold!;
  const tabs = [{ label: "quick", name: "As first made", pick: false, note: "" }, ...bold.options.filter((o) => o.label !== "quick")];
  const quickPick = bold.options.find((o) => o.label === "quick")?.pick ?? false;
  // Open on the critic's pick: the demo shows what the bold pass adds, and "As first made" is one tap away.
  const [on, setOn] = useState(bold.options.find((x) => x.pick)?.label ?? "quick");
  const o = bold.options.find((x) => x.label === on);
  const preview = on === "quick" || !o ? post.preview : { ...post.preview, html: o.html, rationale: o.rationale, baseline: undefined, fileName: `${post.preview.fileName ?? "post"}-bolder` };
  const note = on === "quick" ? (quickPick ? "The critic still picked this one." : "") : (o?.note ?? "");
  return (
    <>
      <div className="c-seg" role="radiogroup" aria-label="Which version">
        {tabs.map((t) => (
          <button key={t.label} type="button" role="radio" aria-checked={on === t.label} onClick={() => setOn(t.label)}>
            {t.label === "quick" ? "As first made" : t.name}
            {(t.label === "quick" ? quickPick : t.pick) ? " ★" : ""}
          </button>
        ))}
      </div>
      {note && <p className="muted small bold-note">{(on === "quick" ? quickPick : o?.pick) ? <span className="bold-pick">Critic's pick </span> : null}{note}</p>}
      <PostPreview key={on} {...preview} />
    </>
  );
}
