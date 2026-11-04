"use client";

// "Fill the gaps" (spec, user flow step 4). After the kit is drafted, the agent asks about one
// gap at a time with one catalog component and one sentence. The owner answers with the
// component, types an answer instead, or skips. The server checks completeness in code and
// writes every answer into the kit; this screen only shows the conversation.
import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS, charCount } from "../../core/limits.ts";
import type { ChunkProgress } from "../../core/intake.ts";
import type { ComponentName } from "../../core/catalog.ts";
import { call } from "../lib/api.ts";
import { KitProgress } from "../ui/catalog/index.ts";
import { RenderCall } from "../ui/render.tsx";
import { Skeleton, ToastProvider, useToast } from "../ui/primitives.tsx";

type Call = { component: ComponentName; props: Record<string, unknown> };
type Turn = { id: string; about: string; say: string; call: Call; answer?: string; skipped?: boolean };
type View = { done: boolean; gapsLeft: number; turnsLeft: number; capped?: boolean; progress: ChunkProgress[]; turns: Turn[]; pending: string | null };
type Reply = { answer: unknown } | { text: string } | { skip: true };

const messageOf = (e: unknown) => (e as Error).message ?? "Something went wrong.";

export default function Intake(props: { sessionId: string; onKitChanged: () => void }) {
  return (
    <ToastProvider>
      <IntakeInner {...props} />
    </ToastProvider>
  );
}

function IntakeInner({ sessionId, onKitChanged }: { sessionId: string; onKitChanged: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const toast = useToast();
  const bottom = useRef<HTMLDivElement>(null);

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

  // Start: show where things stand, then ask the first question if one is needed.
  useEffect(() => {
    let live = true;
    (async () => {
      const v = await call<View>("/api/intake", { sessionId, peek: true }).catch((e) => (setError(messageOf(e)), null));
      if (!live || !v) return;
      setView(v);
      if (!v.done && !v.pending && !v.capped) await send({});
    })();
    return () => {
      live = false;
    };
  }, [sessionId, send]);

  const pending = view?.turns.find((t) => t.id === view.pending) ?? null;

  // PhotoPicker names photos by upload; fetch them once from this session.
  useEffect(() => {
    if (pending?.call.component !== "PhotoPicker") return;
    const photos = (pending.call.props.photos as { src: string }[]) ?? [];
    for (const p of photos) {
      const uploadId = p.src.startsWith("upload:") ? p.src.slice(7) : null;
      if (!uploadId || photoUrls[p.src]) continue;
      fetch("/api/uploads/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, uploadId }) })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => b && setPhotoUrls((u) => ({ ...u, [p.src]: URL.createObjectURL(b) })))
        .catch(() => {});
    }
  }, [pending, sessionId, photoUrls]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [view?.turns.length, asking]);

  async function reply(r: Reply, saved: string) {
    if (!pending) return;
    const v = await send({ reply: { turnId: pending.id, ...r } });
    if (v) {
      toast(saved);
      setTyped("");
      onKitChanged();
    }
  }

  if (!view) {
    return (
      <section className="intake">
        <h2>
          Fill the gaps. <span>A few quick questions.</span>
        </h2>
        {error ? <p className="error">{error}</p> : <Skeleton lines={2} />}
      </section>
    );
  }

  const answered = view.turns.filter((t) => t.id !== view.pending);
  const pendingCall = pending && withPhotos(pending.call, photoUrls);

  return (
    <section className="intake">
      <h2>
        Fill the gaps. <span>{view.done ? "Done." : `${view.gapsLeft} left.`}</span>
      </h2>
      <p className="muted">
        Claude asks about what&rsquo;s missing or where your uploads disagree, one thing at a time. Every answer goes
        into your kit, marked as yours.
      </p>

      <div className="intake-grid">
        <aside className="intake-side">
          <KitProgress chunks={view.progress} />
        </aside>

        <div className="intake-thread">
          {answered.map((t) => (
            <div key={t.id} className="intake-done">
              <p className="intake-say">{t.say}</p>
              <p className="intake-answer">{t.skipped ? <span className="muted">Skipped</span> : t.answer}</p>
              <span className="eyebrow">{t.call.component}</span>
            </div>
          ))}

          {pending && pendingCall && (
            <div className="intake-now">
              <p className="intake-say now">{pending.say}</p>
              <RenderCall
                key={pending.id}
                call={pendingCall}
                status={asking ? "loading" : error ? "error" : "ready"}
                errorText={error ?? undefined}
                onAnswer={(_, answer) => reply({ answer }, "Saved to your kit")}
              />
              <form
                className="intake-type"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typed.trim() && charCount(typed) <= LIMITS.messageChars) reply({ text: typed.trim() }, "Saved to your kit");
                }}
              >
                <label htmlFor="intake-typed" className="eyebrow">
                  Or answer in your own words
                </label>
                <div className="intake-type-row">
                  <input id="intake-typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type an answer…" disabled={asking} autoComplete="off" />
                  <button type="submit" disabled={asking || !typed.trim() || charCount(typed) > LIMITS.messageChars}>
                    Send
                  </button>
                </div>
                <div className="intake-type-foot">
                  <button type="button" className="quiet" disabled={asking} onClick={() => reply({ skip: true }, "Skipped")}>
                    Skip this one
                  </button>
                  <span className="counter">
                    {charCount(typed)}/{LIMITS.messageChars}
                  </span>
                </div>
              </form>
            </div>
          )}

          {!pending && asking && (
            <div className="c-card">
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

          {view.done && (
            <div className="intake-complete">
              <span className="eyebrow">Kit complete</span>
              <p>Every chunk has what it needs, and nothing is waiting on you. Your answers are marked as yours in the kit above.</p>
            </div>
          )}

          {!view.done && view.capped && !pending && (
            <div className="intake-complete">
              <span className="eyebrow">That&rsquo;s all the questions for this session</span>
              <p>
                {view.gapsLeft} {view.gapsLeft === 1 ? "thing is" : "things are"} still open. You can fill them in by editing
                the kit above.
              </p>
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>
    </section>
  );
}

/** Swaps "upload:<id>" photo sources for the fetched images. */
function withPhotos(c: Call, urls: Record<string, string>): Call {
  if (c.component !== "PhotoPicker") return c;
  const photos = (c.props.photos as { src: string }[]).map((p) => ({ ...p, src: urls[p.src] ?? "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }));
  return { ...c, props: { ...c.props, photos } };
}
