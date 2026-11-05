"use client";

// Make posts (spec, user flow step 5) for the visitor's own kit. For each brief the browser asks
// the server to plan, write and lay out the post, one request at a time so none nears the
// function's time limit. It checks each composed layout here, in a hidden frame, with the same
// probe the spike uses; problems go back as codes for one fix, and after that the post uses
// its template. The without-kit version is written alongside for the toggle.
import { useCallback, useEffect, useState } from "react";
import { LIMITS, POST_INTENTS, charCount, type PostIntent } from "../../core/limits.ts";
import { buildComposedPage, LAYOUT_PROBE, TEXT_SLOTS, type Composition, type ProbeIssue, type TextSlot } from "../../core/compose.ts";
import { buildPostPage, wordmarkHtml, type PostLook } from "../../core/post-html.ts";
import { escapeHtml, findTemplate, parseTemplates, type TemplateId } from "../../core/templates.ts";
import type { PropsOf } from "../../core/catalog.ts";
import { call, callAgainIfDropped, isDropped, type ApiError } from "../lib/api.ts";
import { PostPreview } from "../ui/catalog/PostPreview.tsx";
import { logoDataUrl } from "../lib/logo.ts";
import { KitDownload } from "../ui/KitDownload.tsx";
import { Working } from "../ui/working.tsx";

type Note = { decision: string; choice: string; reason: string; cites: string[] };
type Kit = {
  businessName: string;
  files: Record<string, string>;
  tokensCss: string;
  wordmarkLines: string[];
  fontsHref: string;
  templates: Record<TemplateId, string>;
  templatesManifest: string;
  baseCss: string;
  neutralTokensCss: string;
  photos: { file: string; uploadId?: string }[];
  logoUploadId: string | null;
};
type Slots = Record<string, string | null>;
type Post = {
  id: string;
  /** Stays the same when the server's id replaces the temporary one, so the card isn't remounted. */
  uid: string;
  intent: PostIntent;
  goal: string;
  stage: string | null;
  error?: string;
  preview?: PropsOf<"PostPreview">;
  layoutNote?: string;
  /** The kit look the post was drawn with, so a kit change can restyle it in place. */
  look?: Look;
  restyled?: number;
};

const INTENT_LABEL: Record<PostIntent, string> = { promo: "Promo", announcement: "Announcement", event: "Event", testimonial: "Testimonial", tip: "Tip" };
const LAYOUT_NOTE = /template|layout|composition|photo|image|crop/i;
const RETRY_NOTE = /^(fix|fixes|fix from|previous|retry)/i;
const messageOf = (e: unknown) => (isDropped(e) ? "The connection dropped before this post came back. Try making it again." : e instanceof Error ? e.message : "Something went wrong.");

/** What a post borrows from the kit as it's drawn: colors and fonts, and the sign-off (logo or name). */
type Look = { tokensCss: string; fontsHref?: string; wordmarkLines: string[]; logoSrc: string | null };
const sameLook = (a: Look, b: Look) => a.tokensCss === b.tokensCss && a.fontsHref === b.fontsHref && a.logoSrc === b.logoSrc && a.wordmarkLines.join("\n") === b.wordmarkLines.join("\n");

/** Swaps a post's kit colors, fonts and sign-off for new ones. Layout and copy stay; no model call. */
function restyle(html: string, from: Look, to: Look): string {
  let out = html.replace(`<style>${from.tokensCss}</style>`, () => `<style>${to.tokensCss}</style>`);
  const [oldSign, newSign] = [wordmarkHtml(from.wordmarkLines, from.logoSrc), wordmarkHtml(to.wordmarkLines, to.logoSrc)];
  if (oldSign !== newSign) out = out.split(oldSign).join(newSign);
  const link = (h?: string) => (h ? `<link rel="stylesheet" href="${escapeHtml(h)}">` : "");
  if (from.fontsHref !== to.fontsHref && from.fontsHref && to.fontsHref) out = out.replace(link(from.fontsHref), () => link(to.fontsHref));
  return out;
}

export default function MakePosts({ sessionId, kitVersion = 0 }: { sessionId: string; kitVersion?: number }) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [kitError, setKitError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<string | null>(null);
  const [intent, setIntent] = useState<PostIntent>("promo");
  const [goal, setGoal] = useState("");
  const [details, setDetails] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [left, setLeft] = useState<number>(LIMITS.postsPerSession);
  const [busy, setBusy] = useState(false);
  // The post the page is following: scrolled to when it starts, flagged with a pill when it's ready off screen.
  const [follow, setFollow] = useState<string | null>(null);
  const [readyOffscreen, setReadyOffscreen] = useState<string | null>(null);
  const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const postEl = (id: string) => document.querySelector<HTMLElement>(`[data-post-id="${CSS.escape(id)}"]`);
  const goTo = (id: string) => postEl(id)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });

  const loadKit = useCallback(async () => {
    setKitError(null);
    try {
      const k = await call<Kit>("/api/kit/files", { sessionId });
      setKit(k);
      // Photos go into each post as data URLs, so the PNG export carries them too.
      const urls: Record<string, string> = {};
      for (const p of k.photos) {
        if (!p.uploadId) continue;
        const res = await fetch("/api/uploads/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, uploadId: p.uploadId }) });
        if (res.ok) urls[p.file] = await dataUrl(await res.blob());
      }
      setPhotos(urls);
      if (k.logoUploadId) setLogo(await logoDataUrl(sessionId, k.logoUploadId));
    } catch (e) {
      setKitError(messageOf(e));
    }
  }, [sessionId]);

  useEffect(() => {
    void loadKit();
  }, [loadKit]);

  // The kit changed (a chat change, an answer): reload it, and restyle the posts already made
  // with its new colors and fonts, so "make it neon pink" shows on the post you're looking at.
  const [seenVersion, setSeenVersion] = useState(kitVersion);
  useEffect(() => {
    if (kitVersion === seenVersion) return;
    setSeenVersion(kitVersion);
    void loadKit();
  }, [kitVersion, seenVersion, loadKit]);
  useEffect(() => {
    if (!kit) return;
    const to: Look = { tokensCss: kit.tokensCss, fontsHref: kit.fontsHref, wordmarkLines: kit.wordmarkLines, logoSrc: logo };
    setPosts((ps) =>
      ps.map((p) => {
        if (!p.look || !p.preview || p.stage || sameLook(p.look, to)) return p;
        const html = restyle(p.preview.html, p.look, to);
        return { ...p, look: to, restyled: (p.restyled ?? 0) + 1, layoutNote: p.look.tokensCss === to.tokensCss && to.logoSrc && p.look.logoSrc !== to.logoSrc ? "Now signed with your logo." : "Restyled with your kit's new look.", preview: { ...p.preview, html } };
      }),
    );
  }, [kit, logo]);

  useEffect(() => {
    if (!follow) return;
    const t = setTimeout(() => goTo(follow), 120);
    return () => clearTimeout(t);
  }, [follow]);

  // When the followed post finishes and it's out of view, a pill says so and takes you there.
  const followed = posts.find((p) => p.id === follow);
  const followedDone = !!followed && !followed.stage && !!(followed.preview || followed.error);
  useEffect(() => {
    if (!followedDone || !follow) return;
    const el = postEl(follow);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom < 80 || r.top > window.innerHeight - 120) setReadyOffscreen(follow);
    setFollow(null);
  }, [followedDone, follow]);
  useEffect(() => {
    if (!readyOffscreen) return;
    const el = postEl(readyOffscreen);
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setReadyOffscreen(null), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [readyOffscreen]);

  const patch = (id: string, change: Partial<Post>) => setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, ...change } : p)));

  async function make() {
    if (!kit) return;
    setBusy(true);
    const tempId = crypto.randomUUID();
    const brief = { goal: goal.trim(), details: details.trim() };
    setPosts((ps) => [{ id: tempId, uid: tempId, intent, goal: brief.goal, stage: "Planning the post…" }, ...ps]);
    // The new post lands below the form: bring it into view, so the wait is watched, not guessed at.
    setFollow(tempId);
    let id = tempId;
    try {
      const planned = await call<{ postId: string; plan: { template: TemplateId; photo: string | null; angle: string; rationale: Note[] }; postsLeft: number }>("/api/posts", {
        sessionId,
        brand: "session",
        intent,
        brief,
      });
      id = planned.postId;
      setPosts((ps) => ps.map((p) => (p.id === tempId ? { ...p, id } : p)));
      setFollow((f) => (f === tempId ? id : f));
      setLeft(planned.postsLeft);
      setGoal("");
      setDetails("");
      patch(id, { stage: "Writing the copy…" });
      // Writing a post twice returns the first answer, so a dropped connection is simply tried again.
      const written = await callAgainIfDropped<{ template: TemplateId; photo: string | null; slots: Slots; rationale: Note[] }>("/api/posts/write", { sessionId, postId: id });

      // The template version first, so there's a post on screen while the layout is designed.
      const templates = parseTemplates(kit.templatesManifest);
      const t = findTemplate(templates, written.template);
      const look: PostLook = { tokensCss: kit.tokensCss, wordmarkLines: kit.wordmarkLines, logoSrc: logo, fontsHref: kit.fontsHref, base: { css: kit.baseCss } };
      const photoSrc = written.photo ? (photos[written.photo] ?? null) : null;
      const chunkIds = new Set(Object.keys(kit.files).map((f) => f.replace(/\.(md|ya?ml|json|css)$/, "")));
      const notes = (ns: Note[]) => ns.map((n) => ({ decision: n.decision.slice(0, 160) || "decision", choice: n.choice, reason: n.reason, chunks: n.cites.filter((c) => chunkIds.has(c)).slice(0, 6) }));
      const planNotes = planned.plan.rationale.filter((n) => LAYOUT_NOTE.test(n.decision));
      const alt = `${kit.businessName}: ${written.slots.headline ?? written.slots.quote ?? t.name}`.slice(0, 200);
      const fileName = `${kit.businessName}-${intent}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80);
      const base = {
        format: t.aspect,
        html: buildPostPage({ templateHtml: kit.templates[t.id as TemplateId], look, slots: written.slots, photoSrc }),
        alt,
        rationale: notes([...planNotes, ...written.rationale]).slice(0, 16),
        caption: written.slots.caption?.slice(0, 2200) || undefined,
        fileName,
      };
      patch(id, { stage: "Designing the layout from your kit…", preview: base, look: { tokensCss: kit.tokensCss, fontsHref: kit.fontsHref, wordmarkLines: kit.wordmarkLines, logoSrc: logo } });

      // The without-kit version, in parallel; the toggle appears when it lands.
      void call<{ template: TemplateId | null; photo: string | null; slots: Slots | null; rationale: Note[] }>("/api/posts/baseline", { sessionId, postId: id })
        .then((b) => {
          if (!b.template || !b.slots) return;
          const bt = findTemplate(templates, b.template);
          const plain: PostLook = { tokensCss: kit.neutralTokensCss, wordmarkLines: [kit.businessName], base: { css: kit.baseCss } };
          const baseline = {
            format: bt.aspect,
            html: buildPostPage({ templateHtml: kit.templates[bt.id as TemplateId], look: plain, slots: b.slots, photoSrc: b.photo ? (photos[b.photo] ?? null) : null }),
            alt: `Without the kit: ${b.slots.headline ?? b.slots.quote ?? bt.name}`.slice(0, 200),
            rationale: notes(b.rationale).slice(0, 16),
            caption: b.slots.caption?.slice(0, 2200) || undefined,
          };
          setPosts((ps) => ps.map((p) => (p.id === id && p.preview ? { ...p, preview: { ...p.preview, baseline } } : p)));
        })
        .catch(() => {});

      const composed = await composeWithChecks(sessionId, id, {
        slots: written.slots,
        aspect: t.aspect,
        tokensCss: kit.tokensCss,
        fontsHref: kit.fontsHref,
        wordmarkLines: kit.wordmarkLines,
        logoSrc: logo,
        photo: photoSrc ? { src: photoSrc, alt } : null,
        onStage: (stage) => patch(id, { stage }),
      });
      if (composed.page) {
        const copyNotes = written.rationale.filter((n) => !LAYOUT_NOTE.test(n.decision));
        const layoutNotes = composed.composition!.rationale.filter((n) => !RETRY_NOTE.test(n.decision.trim()));
        setPosts((ps) =>
          ps.map((p) =>
            p.id === id && p.preview ? { ...p, stage: null, layoutNote: "Layout designed from your kit.", preview: { ...p.preview, html: composed.page!, rationale: notes([...layoutNotes, ...copyNotes]).slice(0, 16) } } : p,
          ),
        );
      } else {
        patch(id, { stage: null, layoutNote: composed.why });
      }
    } catch (e) {
      patch(id, { stage: null, error: messageOf(e) });
    } finally {
      setBusy(false);
    }
  }

  const tooLong = charCount(goal) > LIMITS.messageChars || charCount(details) > LIMITS.messageChars;

  return (
    <section className="make-posts">
      <h2>
        Make posts. <span>From your kit, with their reasons.</span>
      </h2>
      {kitError && (
        <p className="error">
          {kitError}{" "}
          <button type="button" className="link" onClick={() => void loadKit()}>
            Try again
          </button>
        </p>
      )}
      {kit && (
        <>
          <div className="card posts-kit">
            <div>
              <p className="eyebrow">Your brand kit</p>
              <p>
                {Object.keys(kit.files).length} files, ready to drop into any AI tool or hand to a freelancer. Posts below are made
                from it.
              </p>
            </div>
            <KitDownload slug={kit.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "brand"} name={kit.businessName} files={kit.files} />
          </div>

          <form
            className="card make-brief"
            onSubmit={(e) => {
              e.preventDefault();
              void make();
            }}
          >
            <div className="c-seg" role="radiogroup" aria-label="What kind of post">
              {POST_INTENTS.map((i) => (
                <button key={i} type="button" role="radio" aria-checked={intent === i} onClick={() => setIntent(i)}>
                  {INTENT_LABEL[i]}
                </button>
              ))}
            </div>
            <label htmlFor="make-goal">What should this post do?</label>
            <input id="make-goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Get people to try the new seasonal menu" />
            <label htmlFor="make-details">Details it needs</label>
            <textarea id="make-details" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="The offer, the date, the quote. Only what's true." />
            <div className="c-row-between">
              <span className="muted small">
                {left} of {LIMITS.postsPerSession} posts left this session
              </span>
              <button type="submit" aria-busy={busy} disabled={busy || !goal.trim() || tooLong || left <= 0}>
                {busy ? "Making…" : "Make a post"}
              </button>
            </div>
          </form>

          {readyOffscreen && (
            <button type="button" className="ready-pill" onClick={() => goTo(readyOffscreen)}>
              <span className="working-dot" aria-hidden="true" />
              Your post is ready ↓
            </button>
          )}

          <div className="posts-grid">
            {posts.map((p) => (
              <article key={p.uid} data-post-id={p.id} className="posts-item" data-restyled={p.restyled ? p.restyled % 2 : undefined} data-drafting={p.preview ? String(!!p.stage) : undefined}>
                <header>
                  <span className="eyebrow">{INTENT_LABEL[p.intent]}</span>
                  <p className="posts-goal">{p.goal}</p>
                  {p.stage && <Working kind="making" lead={p.stage} />}
                  {!p.stage && p.layoutNote && <p className="muted small">{p.layoutNote}</p>}
                  {p.error && <p className="error small">{p.error}</p>}
                </header>
                {p.preview ? <PostPreview {...p.preview} /> : !p.error && <PostPreview format="1:1" html="<p></p>" alt="" rationale={[]} status="loading" />}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ---------- composing, with the browser-side check ----------

type ComposeAnswer = { ok: boolean; errors: string[]; composition: Composition | null; aspect: "1:1" | "4:5"; attemptsLeft: number };

async function composeWithChecks(
  sessionId: string,
  postId: string,
  o: {
    slots: Slots;
    aspect: "1:1" | "4:5";
    tokensCss: string;
    fontsHref: string;
    wordmarkLines: string[];
    logoSrc: string | null;
    photo: { src: string; alt: string } | null;
    onStage: (s: string) => void;
  },
): Promise<{ page: string | null; composition: Composition | null; why: string }> {
  const slots = Object.fromEntries(TEXT_SLOTS.map((s) => [s, o.slots[s] ?? null])) as Record<TextSlot, string | null>;
  let issues: ProbeIssue[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let answer: ComposeAnswer;
    try {
      answer = await call<ComposeAnswer>("/api/posts/compose", { sessionId, postId, ...(issues.length ? { issues: issues.map(({ slot, code, n }) => ({ slot, code, ...(n === undefined ? {} : { n }) })) } : {}) });
    } catch (e) {
      const code = (e as ApiError).code;
      if (code === "no_layout") return { page: null, composition: null, why: "Your kit has no layout chunk yet, so this post uses a standard layout." };
      return { page: null, composition: null, why: "The custom layout didn't come through, so this post uses a standard layout." };
    }
    if (answer.ok && answer.composition) {
      o.onStage("Checking the layout…");
      const page = buildComposedPage({ composition: answer.composition, slots, aspect: o.aspect, tokensCss: o.tokensCss, fontsHref: o.fontsHref, wordmarkLines: o.wordmarkLines, logoSrc: o.logoSrc, photo: o.photo });
      const found = await probe(page, o.aspect);
      if (found === null) break; // Couldn't check it, so don't show it.
      issues = found;
      if (!issues.length) return { page, composition: answer.composition, why: "" };
    } else {
      issues = [];
    }
    if (answer.attemptsLeft <= 0) break;
    o.onStage("Fixing the layout…");
  }
  return { page: null, composition: null, why: "The custom layout didn't pass its checks (text fit, contrast, nothing on the photo), so this post uses a standard layout." };
}

/** Renders a composed post in a hidden, script-free frame and runs the layout probe on it from here. */
async function probe(html: string, aspect: "1:1" | "4:5"): Promise<ProbeIssue[] | null> {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:1080px;height:${aspect === "4:5" ? 1350 : 1080}px;border:0;visibility:hidden`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument!;
    const win = frame.contentWindow!;
    await doc.fonts?.ready;
    await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))))));
    // The probe is written to run inside the page; here it runs from this window against the frame's document.
    const run = new Function("document", "getComputedStyle", `return ${LAYOUT_PROBE}`) as (d: Document, g: typeof getComputedStyle) => ProbeIssue[];
    return run(doc, win.getComputedStyle.bind(win));
  } catch {
    return null;
  } finally {
    frame.remove();
  }
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
