"use client";

// "Fill the gaps" (spec, user flow step 4), reworked Nov 5 after the first live run. Code has
// already sorted the gaps (core/triage.ts): what the uploads settle is listed with an Undo, and
// only the calls that change a post are asked, one at a time, each with one catalog component
// and one sentence. Beside each call is the kit's first post, live: an answer changes it on the
// spot. Typing is the fallback under each call, not the main way to answer.
import { Working } from "../ui/working.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS, charCount } from "../../core/limits.ts";
import type { IntakeChunks } from "../../core/intake.ts";
import type { ComponentName } from "../../core/catalog.ts";
import { boardFrom, previewSlots } from "../../core/preview.ts";
import { buildPostPage } from "../../core/post-html.ts";
import { call, sendForm } from "../lib/api.ts";
import { LOGO_ACCEPT, logoProblem, prepareImage } from "../lib/images.ts";
import { logoDataUrl } from "../lib/logo.ts";
import { RenderCall } from "../ui/render.tsx";
import { ChatPanel, suggestionsFor } from "./chat-panel.tsx";
import { Skeleton, ToastProvider, useToast } from "../ui/primitives.tsx";

type Call = { component: ComponentName; props: Record<string, unknown> };
type Turn = { id: string; about: string; say: string; call: Call | null; answer?: string; skipped?: boolean; asked?: string };
type Settled = { gap: string; mode: "conflict" | "kept"; about: string; text: string; why: string };
type View = { done: boolean; gapsLeft: number; callsLeft: number; turnsLeft: number; capped?: boolean; settled: Settled[]; turns: Turn[]; pending: string | null; changesLeft?: number; needLogo?: boolean };
type Reply = { answer: unknown } | { text: string } | { skip: true };
type KitFiles = { tokensCss: string; wordmarkLines: string[]; fontsHref: string; templates: Record<string, string>; baseCss: string; photos: { file: string; uploadId?: string }[]; logoUploadId: string | null };

const messageOf = (e: unknown) => (e as Error).message ?? "Something went wrong.";

export default function Intake(props: { sessionId: string; chunks: IntakeChunks; onKitChanged: () => Promise<void> | void }) {
  return (
    <ToastProvider>
      <IntakeInner {...props} />
    </ToastProvider>
  );
}

function IntakeInner({ sessionId, chunks, onKitChanged }: { sessionId: string; chunks: IntakeChunks; onKitChanged: () => Promise<void> | void }) {
  const [view, setView] = useState<View | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [typing, setTyping] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [kit, setKit] = useState<KitFiles | null>(null);
  const [asked, setAsked] = useState("");
  const [sentAsk, setSentAsk] = useState<string | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // Open beside the page on a wide screen; on a phone it waits as a tab until it's asked for.
  useEffect(() => {
    if (window.matchMedia("(min-width: 1100px)").matches) setChatOpen(true);
  }, []);
  const toast = useToast();
  const requested = useRef(new Set<string>());

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      setAsking(true);
      setError(null);
      try {
        const v = await call<View>("/api/intake", { sessionId, ...body });
        setView(v);
        return v;
      } catch (e) {
        setError(messageOf(e));
        // The reply may have been saved even if the next question failed, so show where things stand.
        const v = await call<View>("/api/intake", { sessionId, peek: true }).catch(() => null);
        if (v) setView(v);
        return null;
      } finally {
        setAsking(false);
      }
    },
    [sessionId],
  );

  // The kit's tokens and photos for the live post. Fetched again after each answer, since a
  // palette or font answer changes the tokens.
  const loadKit = useCallback(async () => {
    const k = await call<KitFiles>("/api/kit/files", { sessionId }).catch(() => null);
    if (!k) return;
    setKit(k);
    for (const p of k.photos) {
      if (!p.uploadId || requested.current.has(p.uploadId)) continue;
      requested.current.add(p.uploadId);
      void fetchImage(sessionId, p.uploadId).then((d) => d && setPhotoUrls((x) => ({ ...x, [`file:${p.file}`]: d.data, [`upload:${p.uploadId}`]: d.blob })));
    }
    if (k.logoUploadId && !requested.current.has(k.logoUploadId)) {
      requested.current.add(k.logoUploadId);
      void logoDataUrl(sessionId, k.logoUploadId).then((d) => d && setPhotoUrls((x) => ({ ...x, logo: d })));
    }
  }, [sessionId]);

  // Start: triage runs on the first request (free), then the first call is asked if one is needed.
  useEffect(() => {
    let live = true;
    (async () => {
      const v = await call<View>("/api/intake", { sessionId, peek: true }).catch((e) => (setError(messageOf(e)), null));
      if (!live || !v) return;
      setView(v);
      await onKitChanged();
      void loadKit();
      if (!v.done && !v.pending && !v.capped) await send({});
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, send, loadKit]);

  const pending = view?.turns.find((t) => t.id === view.pending) ?? null;

  // PhotoPicker names photos by upload; fetch any not loaded yet.
  useEffect(() => {
    if (pending?.call?.component !== "PhotoPicker") return;
    for (const p of (pending.call!.props.photos as { src: string }[]) ?? []) {
      const uploadId = p.src.startsWith("upload:") ? p.src.slice(7) : null;
      if (!uploadId || photoUrls[p.src]) continue;
      void fetchImage(sessionId, uploadId).then((d) => d && setPhotoUrls((u) => ({ ...u, [p.src]: d.blob })));
    }
  }, [pending, sessionId, photoUrls]);

  async function after(v: View | null, saved: string, undo?: () => void) {
    if (!v) return;
    toast(saved, undo);
    setTyped("");
    setTyping(false);
    await onKitChanged();
    void loadKit();
  }

  async function reply(r: Reply, saved: string) {
    if (!pending) return;
    await after(await send({ reply: { turnId: pending.id, ...r } }), saved);
  }

  /** The owner asks about the kit, or for a change, in their own words; Specs answers, or brings the card that makes it. */
  async function ask(text: string) {
    text = text.trim();
    if (!text || charCount(text) > LIMITS.messageChars || chatBusy) return;
    setSentAsk(text);
    setAsked("");
    setChatBusy(true);
    setChatError(null);
    setTyping(false);
    try {
      const v = await call<View>("/api/intake", { sessionId, ask: text });
      setView(v);
      // Answered in words: the planned call that stepped aside comes straight back.
      if (!v.pending && !v.done && !v.capped) void send({});
    } catch (e) {
      setChatError(messageOf(e));
      setAsked(text);
    } finally {
      setSentAsk(null);
      setChatBusy(false);
    }
  }

  async function addLogo(f: File | null) {
    if (!f) return;
    const problem = logoProblem(f);
    if (problem) return setError(problem);
    setAsking(true);
    setError(null);
    try {
      const { file, colors } = await prepareImage(f, "logo");
      await sendForm("/api/uploads", { sessionId, kind: "logo", file, colors: JSON.stringify(colors) });
      toast("Logo added. Every post signs with it now.");
      await loadKit();
      await onKitChanged();
      setView((v) => (v ? { ...v, needLogo: false } : v));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setAsking(false);
    }
  }

  async function undo(s: Settled) {
    await after(await send({ undo: s.gap }), "Moved to your calls");
  }

  if (!view) {
    return (
      <section className="intake">
        <h2>
          A few calls <span>only you can make.</span>
        </h2>
        {error ? <p className="error">{error}</p> : <Skeleton lines={2} />}
      </section>
    );
  }

  const planned = view.turns.filter((t) => !t.asked && (t.answer !== undefined || t.skipped));
  const made = planned.length;
  const chats = view.turns.filter((t) => t.asked);
  const isRequest = !!pending?.asked;

  /** One call: a planned one in the main column, or the card a change request brought, in the chat. */
  function callCard(t: Turn, c: Call, inChat: boolean) {
    return (
      <div className={`card call-card${inChat ? " in-chat" : ""}`} key={t.id}>
        {!inChat && (
          <div className="call-head">
            <span className="eyebrow">
              Call {Math.min(made + 1, total)} of {total}
            </span>
            <span className="dots" aria-hidden="true">
              {Array.from({ length: total }, (_, i) => (
                <i key={i} className={i < made ? "on" : i === made ? "now" : ""} />
              ))}
            </span>
          </div>
        )}
        {!inChat && <p className="intake-say now">{t.say}</p>}
        <RenderCall key={t.id} call={c} status={asking ? "loading" : error ? "error" : "ready"} errorText={error ?? undefined} onAnswer={(_, answer) => reply({ answer }, "Saved to your kit")} />
        <div className="call-else">
          {!typing ? (
            <div className="row">
              <button type="button" className="quiet" disabled={asking} onClick={() => setTyping(true)}>
                Something else…
              </button>
              <button type="button" className="quiet" disabled={asking} onClick={() => reply({ skip: true }, inChat ? "Left as it was" : "Skipped")}>
                {inChat ? "Never mind" : "Skip this one"}
              </button>
            </div>
          ) : (
            <form
              className="intake-type"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim() && charCount(typed) <= LIMITS.messageChars) reply({ text: typed.trim() }, "Saved to your kit");
              }}
            >
              <div className="intake-type-row">
                <input aria-label="Answer in your own words" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Tell me in your words" disabled={asking} autoComplete="off" autoFocus />
                <button type="submit" disabled={asking || !typed.trim() || charCount(typed) > LIMITS.messageChars}>
                  Use this
                </button>
              </div>
              <div className="intake-type-foot">
                <button type="button" className="quiet" onClick={() => setTyping(false)}>
                  Back to the choices
                </button>
                <span className="counter">
                  {charCount(typed)}/{LIMITS.messageChars}
                </span>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }
  const total = made + view.callsLeft;
  const pendingCall = pending?.call ? withPhotos(pending.call, photoUrls) : null;

  return (
    <section className="intake">
      <h2>
        {view.done ? (
          <>
            Your kit is ready. <span>Nothing is waiting on you.</span>
          </>
        ) : (
          <>
            {numberWord(view.callsLeft)} {view.callsLeft === 1 ? "call" : "calls"} <span>only you can make.</span>
          </>
        )}
      </h2>
      {!view.done && (
        <p className="muted lede">
          Each one changes the post beside it. Your files stay exactly as they are: you&rsquo;re telling the kit what&rsquo;s true now.
        </p>
      )}

      {view.settled.length > 0 && (
        <div className="card settled">
          <p className="eyebrow">Settled for you</p>
          {view.settled.map((s) => (
            <div className="settle" key={s.gap}>
              <div>
                <b>
                  {s.mode === "conflict" ? `${s.about}: ${s.text}` : `${s.about.replace(/_/g, " ")}: kept as drafted`}
                </b>
                <p>{s.why}</p>
              </div>
              <button className="c-btn ghost" disabled={asking || !!pending} title={pending ? "Answer the call on screen first" : undefined} onClick={() => undo(s)}>
                Undo
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="calls-grid">
        <div className="calls-main">
          {pending && pendingCall && !isRequest && callCard(pending, pendingCall, false)}

          {(isRequest || chatBusy) && !view.done && (
            <div className="card call-aside">
              <p className="muted">Your change is in the chat. Your next call comes back right after.</p>
            </div>
          )}

          {!pending && asking && !chatBusy && (
            <div className="card">
              <Working kind="asking" className="working-over" />
              <Skeleton lines={3} block={80} />
            </div>
          )}

          {!pending && !asking && error && !view.done && (
            <div className="c-card">
              <p className="c-error" role="alert">
                <b aria-hidden="true">!</b>
                <span>{error}</span>
              </p>
              <div>
                <button className="c-btn" onClick={() => send({})}>
                  Ask again
                </button>
              </div>
            </div>
          )}

          {view.done && !isRequest && (
            <div className="intake-complete">
              <Burst colors={boardFrom(chunks).palette?.map((c) => c.hex) ?? []} />
              <span className="eyebrow">Kit ready</span>
              <p>
                {made} {made === 1 ? "call" : "calls"} made, {view.settled.length} settled for you, nothing left open. Something still off? Tell
                Specs in the chat.
              </p>
              {!chatOpen && (
                <button type="button" className="c-btn" onClick={() => setChatOpen(true)}>
                  Open the chat
                </button>
              )}
            </div>
          )}

          {!view.done && view.capped && !pending && (
            <div className="intake-complete">
              <span className="eyebrow">That&rsquo;s all the calls for this session</span>
              <p>The rest stays as drafted. You can change anything in the kit below.</p>
            </div>
          )}

          {planned.length > 0 && (
            <details className="made">
              <summary>Your answers so far</summary>
              {planned.map((t) => (
                <div key={t.id} className="intake-done">
                  <p className="intake-say">{t.say}</p>
                  <p className="intake-answer">{t.skipped ? <span className="muted">Skipped</span> : t.answer}</p>
                </div>
              ))}
            </details>
          )}
        </div>

        <aside className="live">
          <LivePost chunks={chunks} kit={kit} photoUrls={photoUrls} />
        </aside>
      </div>
      <ChatPanel
        open={chatOpen}
        onOpen={setChatOpen}
        chats={chats}
        pending={isRequest ? pending : null}
        sent={sentAsk}
        busy={chatBusy}
        error={chatError}
        suggestions={suggestionsFor(chunks, kit)}
        changesLeft={view.changesLeft ?? 1}
        needLogo={!!view.needLogo && !kit?.logoUploadId}
        hasLogo={!!kit?.logoUploadId}
        draft={asked}
        onDraft={setAsked}
        onAsk={ask}
        onAddLogo={addLogo}
        renderCard={(t) => { const turn = t as Turn; return turn.call ? callCard(turn, withPhotos(turn.call, photoUrls), true) : null; }}
      />
    </section>
  );
}

/** The kit's first post, rebuilt from the kit as it stands. No model call: the copy is the kit's own words. */
function LivePost({ chunks, kit, photoUrls }: { chunks: IntakeChunks; kit: KitFiles | null; photoUrls: Record<string, string> }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [changed, setChanged] = useState(false);
  const last = useRef<string>("");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setScale(e.contentRect.width / 1080));
    ro.observe(el);
    return () => ro.disconnect();
  }, [kit]);

  const slots = kit ? previewSlots(chunks, kit.photos.map((p) => p.file)) : null;
  const photoSrc = slots?.photo ? (photoUrls[`file:${slots.photo}`] ?? "") : "";
  const html =
    kit && slots && kit.templates["photo-led"]
      ? buildPostPage({
          templateHtml: kit.templates["photo-led"],
          look: { tokensCss: kit.tokensCss, wordmarkLines: kit.wordmarkLines, logoSrc: photoUrls.logo ?? null, fontsHref: kit.fontsHref, base: { css: kit.baseCss } },
          slots: { headline: slots.headline, subhead: slots.subhead, badge: slots.badge },
          photoSrc,
        })
      : null;

  // Flag the post when an answer changes it.
  const sig = slots ? `${slots.headline}|${slots.subhead}|${slots.badge}|${slots.photo}|${kit?.tokensCss.length}` : "";
  useEffect(() => {
    if (!sig) return;
    if (last.current && last.current !== sig) {
      setChanged(true);
      const t = setTimeout(() => setChanged(false), 1600);
      last.current = sig;
      return () => clearTimeout(t);
    }
    last.current = sig;
  }, [sig]);

  return (
    <>
      <div className="live-head">
        <span className="eyebrow">Your first post, live</span>
        <span className={`changed ${changed ? "show" : ""}`}>● changed</span>
      </div>
      <div ref={box} className={`live-post ${changed ? "flash" : ""}`} style={{ aspectRatio: "4 / 5" }}>
        {html ? (
          <iframe title="Live post preview" sandbox="" srcDoc={html} style={{ width: 1080, height: 1350, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
        ) : (
          <Skeleton lines={2} block={220} />
        )}
      </div>
      <p className="muted small">The kit&rsquo;s own words in one of its layouts. Answers change it as you go; real posts are planned and written for each brief.</p>
    </>
  );
}

/** Swaps "upload:<id>" photo sources for the fetched images. */
function withPhotos(c: Call, urls: Record<string, string>): Call {
  if (c.component !== "PhotoPicker") return c;
  const photos = (c.props.photos as { src: string }[]).map((p) => ({ ...p, src: urls[p.src] ?? "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }));
  return { ...c, props: { ...c.props, photos } };
}

/** A photo as a short object URL (for the catalog's PhotoPicker) and a data URL (for the sandboxed live post). */
async function fetchImage(sessionId: string, uploadId: string): Promise<{ blob: string; data: string } | null> {
  try {
    const res = await fetch("/api/uploads/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, uploadId }) });
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    return { blob: URL.createObjectURL(blob), data };
  } catch {
    return null;
  }
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const numberWord = (n: number) => WORDS[n] ?? String(n);

/**
 * A one-time burst of the brand's own colors when the kit is finished: small paint chips flung
 * out from the card. Positions are fixed (no randomness), so server and browser agree.
 */
function Burst({ colors }: { colors: string[] }) {
  if (!colors.length) return null;
  const n = 18;
  return (
    <span className="burst" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const angle = (i / n) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
        const dist = 120 + ((i * 37) % 90);
        const style = {
          "--c": colors[i % colors.length],
          "--x": `${Math.round(Math.cos(angle) * dist)}px`,
          "--y": `${Math.round(Math.sin(angle) * dist * 0.7 - 30)}px`,
          "--r": `${((i * 73) % 360) - 180}deg`,
          "--d": `${(i % 5) * 30}ms`,
        } as React.CSSProperties;
        return <i key={i} style={style} />;
      })}
    </span>
  );
}
