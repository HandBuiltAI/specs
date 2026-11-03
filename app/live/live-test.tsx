"use client";

// Exercises the API the way the real screens will: bot check, session, then plan and write.
// It only ever sends structured fields; the server writes every prompt.
import { useEffect, useRef, useState } from "react";
import { LIMITS, POST_INTENTS, charCount, type PostIntent } from "../../core/limits.ts";

type ApiError = { code: string; message: string };
type Rationale = { decision: string; choice: string; reason: string; cites: string[] }[];
type Post = {
  postId: string;
  intent: PostIntent;
  brief: { goal: string; details: string };
  template: string;
  photo: string | null;
  angle: string;
  planRationale: Rationale;
  slots?: Record<string, string | null>;
  rationale?: Rationale;
  regenerationOf?: string;
};

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string };
  }
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? `HTTP ${res.status}`), { code: data.error?.code });
  return data as T;
}

const STATE_TEXT: Record<string, string> = {
  open: "Open",
  off: "Switched off (kill switch)",
  closed_for_today: "Closed for today (spending cap reached)",
  not_configured: "Not set up yet (missing environment variables)",
};

export default function LiveTest({ siteKey }: { siteKey: string }) {
  const [generation, setGeneration] = useState<string>("checking");
  const [token, setToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [left, setLeft] = useState<{ posts: number; regenerations: number }>({ posts: LIMITS.postsPerSession, regenerations: LIMITS.regenerationsPerSession });
  const [intent, setIntent] = useState<PostIntent>("promo");
  const [goal, setGoal] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const widget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((d) => setGeneration(d.generation)).catch(() => setGeneration("unreachable"));
  }, []);

  useEffect(() => {
    if (!siteKey || sessionId) return;
    const render = () => {
      if (widget.current && window.turnstile && !widget.current.hasChildNodes()) {
        window.turnstile.render(widget.current, { sitekey: siteKey, callback: setToken, "expired-callback": () => setToken(null) });
      }
    };
    if (window.turnstile) return render();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [siteKey, sessionId]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError({ code: (e as { code?: string }).code ?? "network", message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const start = () =>
    run("Starting a session…", async () => {
      const d = await call<{ sessionId: string }>("/api/session", { turnstileToken: token });
      setSessionId(d.sessionId);
    });

  const make = (from?: Post) =>
    run(from ? "Regenerating: planning…" : "Planning the post…", async () => {
      const req = from ? { intent: from.intent, brief: from.brief } : { intent, brief: { goal, details } };
      const planned = await call<{ postId: string; plan: { template: string; photo: string | null; angle: string; rationale: Rationale }; postsLeft: number; regenerationsLeft: number }>(
        "/api/posts",
        { sessionId, brand: "half-acre-club", intent: req.intent, brief: req.brief, ...(from ? { regenerationOf: from.postId } : {}) },
      );
      setLeft({ posts: planned.postsLeft, regenerations: planned.regenerationsLeft });
      const post: Post = {
        postId: planned.postId,
        intent: req.intent,
        brief: req.brief,
        template: planned.plan.template,
        photo: planned.plan.photo,
        angle: planned.plan.angle,
        planRationale: planned.plan.rationale,
        regenerationOf: from?.postId,
      };
      setPosts((ps) => [post, ...ps]);
      setBusy("Writing the copy…");
      const written = await call<{ slots: Record<string, string | null>; rationale: Rationale }>("/api/posts/write", { sessionId, postId: planned.postId });
      setPosts((ps) => ps.map((p) => (p.postId === planned.postId ? { ...p, slots: written.slots, rationale: written.rationale } : p)));
    });

  const tooLong = charCount(goal) > LIMITS.messageChars || charCount(details) > LIMITS.messageChars;

  return (
    <>
      <div className="card">
        <dl>
          <dt>Live generation</dt>
          <dd>{STATE_TEXT[generation] ?? generation}</dd>
          <dt>Session</dt>
          <dd>{sessionId ? "Started" : "Not started"}</dd>
          {sessionId && (
            <>
              <dt>Left this session</dt>
              <dd>
                {left.posts} posts, {left.regenerations} regeneration
              </dd>
            </>
          )}
        </dl>
      </div>

      {!sessionId && (
        <>
          <h2>1. Bot check, then start</h2>
          {siteKey ? <div ref={widget} /> : <p className="error">NEXT_PUBLIC_TURNSTILE_SITE_KEY isn&rsquo;t set, so the bot check can&rsquo;t load.</p>}
          <button disabled={!token || !!busy} onClick={start}>
            Start a live session
          </button>
        </>
      )}

      {sessionId && (
        <>
          <h2>2. Brief</h2>
          <label htmlFor="intent">Post intent</label>
          <select id="intent" value={intent} onChange={(e) => setIntent(e.target.value as PostIntent)}>
            {POST_INTENTS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
          <label htmlFor="goal">Goal</label>
          <input id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Get renters to try the first box" />
          <div className="counter">
            {charCount(goal)} / {LIMITS.messageChars}
          </div>
          <label htmlFor="details">Details</label>
          <textarea id="details" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Anything the post needs: the offer, the date, the quote." />
          <div className="counter">
            {charCount(details)} / {LIMITS.messageChars}
          </div>
          <button disabled={!!busy || !goal.trim() || tooLong || left.posts <= 0} onClick={() => make()}>
            Make a post
          </button>
        </>
      )}

      {busy && <p className="muted">{busy}</p>}
      {error && (
        <p className="error">
          {error.message} <code>({error.code})</code>
        </p>
      )}

      {posts.map((p) => (
        <div className="card" key={p.postId}>
          <dl>
            <dt>Intent</dt>
            <dd>
              {p.intent}
              {p.regenerationOf ? " (regenerated)" : ""}
            </dd>
            <dt>Template</dt>
            <dd>{p.template}</dd>
            <dt>Photo</dt>
            <dd>{p.photo ?? "none"}</dd>
            <dt>Angle</dt>
            <dd>{p.angle}</dd>
            {p.slots &&
              Object.entries(p.slots)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <Slot key={k} name={k} value={v!} />
                ))}
          </dl>
          {p.rationale && (
            <>
              <h2>Why this works</h2>
              <ul className="rationale">
                {[...p.planRationale, ...p.rationale].map((r, i) => (
                  <li key={i}>
                    <strong>{r.decision}:</strong> {r.reason} {r.cites.length > 0 && <span className="muted">({r.cites.join(", ")})</span>}
                  </li>
                ))}
              </ul>
              <button disabled={!!busy || left.regenerations <= 0 || !!p.regenerationOf} onClick={() => make(p)}>
                Regenerate
              </button>
            </>
          )}
        </div>
      ))}
    </>
  );
}

function Slot({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  );
}
