"use client";

// The Specs chat, docked on the right of the build page once the kit is drafted. Ask about
// anything on the left ("why these colors?") or say what's off ("where's the pink?"): Specs
// answers in a sentence, or brings the one card that makes the change, right in the chat.
// Closes to a tab; on a phone it's a sheet that slides up.
import { useEffect, useRef, type ReactNode } from "react";
import { LIMITS, charCount } from "../../core/limits.ts";
import { LOGO_ACCEPT } from "../lib/images.ts";
import { Working } from "../ui/working.tsx";
import type { IntakeChunks } from "../../core/intake.ts";

type Turn = { id: string; about: string; say: string; call: unknown; answer?: string; skipped?: boolean; asked?: string };

/** Starters built from the kit as it stands. */
export function suggestionsFor(chunks: IntakeChunks, kit: { logoUploadId: string | null; photos: unknown[] } | null): string[] {
  const out: string[] = [];
  if (kit && !kit.logoUploadId) out.push("There's no logo on my posts");
  out.push("Why did you pick these colors?");
  out.push("Make it sound more like us");
  if ((kit?.photos.length ?? 0) >= 2) out.push("Lead with a different photo");
  if (chunks["positioning-core"]) out.push("A price or our hours changed");
  return out.slice(0, 4);
}

export function ChatPanel(props: {
  open: boolean;
  onOpen: (open: boolean) => void;
  chats: Turn[];
  pending: Turn | null;
  sent: string | null;
  busy: boolean;
  error: string | null;
  suggestions: string[];
  changesLeft: number;
  needLogo: boolean;
  draft: string;
  onDraft: (s: string) => void;
  onAsk: (text: string) => void;
  onAddLogo: (f: File | null) => void;
  renderCard: (t: Turn) => ReactNode;
}) {
  const { open, onOpen, chats, pending, sent, busy, error, suggestions, changesLeft, needLogo, draft, onDraft, onAsk, onAddLogo, renderCard } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const out = changesLeft === 0;

  // Page content makes room for the panel on a wide screen.
  useEffect(() => {
    document.body.classList.toggle("chat-open", open);
    return () => document.body.classList.remove("chat-open");
  }, [open]);

  // New messages glide into view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [chats.length, pending?.id, sent, busy, error]);

  if (!open) {
    return (
      <button type="button" className="chat-tab" onClick={() => onOpen(true)}>
        <span className="chat-dot" aria-hidden="true" />
        Ask Specs
      </button>
    );
  }

  const last = chats.at(-1);
  return (
    <aside className="chat-panel" aria-label="Chat with Specs">
      <header className="chat-head">
        <div>
          <b>Specs</b>
          <span>Your kit&rsquo;s art director</span>
        </div>
        <button type="button" className="chat-close" aria-label="Close the chat" onClick={() => onOpen(false)}>
          ×
        </button>
      </header>

      <div className="chat-scroll" ref={scroller} aria-live="polite">
        <p className="chat-specs">
          Ask about anything on the left, or tell me what&rsquo;s off. I&rsquo;ll answer, or bring the card that changes it, and the live post updates when you pick.
        </p>
        {chats.map((t) => (
          <div key={t.id} className="chat-turn">
            <p className="chat-me">{t.asked}</p>
            <div className="chat-specs">
              <p>{t.say}</p>
              {t === last && needLogo && (
                <>
                  <label htmlFor="chat-logo" className="c-btn">
                    Add your logo
                  </label>
                  <input id="chat-logo" className="visually-hidden" type="file" accept={LOGO_ACCEPT} onChange={(e) => onAddLogo(e.target.files?.[0] ?? null)} disabled={busy} />
                </>
              )}
            </div>
            {pending?.id === t.id && renderCard(t)}
            {t.call != null && pending?.id !== t.id && <p className="chat-done">{t.skipped ? "Left as it was" : `✓ ${t.answer ?? ""}`}</p>}
          </div>
        ))}
        {sent && (
          <div className="chat-turn">
            <p className="chat-me">{sent}</p>
            <p className="chat-typing" aria-label="Specs is answering">
              <i />
              <i />
              <i />
            </p>
            <Working kind="chat" className="chat-working" />
          </div>
        )}
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className="chat-foot">
        {!chats.length && !sent && !out && (
          <div className="chat-suggest">
            <span className="eyebrow">Ask me things like</span>
            {suggestions.map((s) => (
              <button type="button" key={s} disabled={busy} onClick={() => onAsk(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          className="chat-row"
          onSubmit={(e) => {
            e.preventDefault();
            onAsk(draft);
            input.current?.focus();
          }}
        >
          <input
            ref={input}
            aria-label="Ask Specs"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder={out ? "This session has used its changes" : pending ? "Or ask something else" : "Ask Specs, or say what's off"}
            disabled={busy || out}
            autoComplete="off"
          />
          <button type="submit" className="chat-send" aria-label="Send" disabled={busy || out || !draft.trim() || charCount(draft) > LIMITS.messageChars}>
            →
          </button>
        </form>
        {out && <p className="chat-note">You can still edit anything in the kit on the left.</p>}
      </footer>
    </aside>
  );
}
