"use client";

// "Make it bolder" (spec, "Bolder posts"): once per visit, under a finished post. The server
// works in the background for a few minutes; this follows it. When the candidates are designed
// it renders each one here, checks it with the same probe as every post, and sends a small JPEG
// of each (and of the post as first made) to the critic. Then the owner sees the top two, the
// critic's pick marked, and chooses.
import { useEffect, useRef, useState } from "react";
import { call, type ApiError } from "../lib/api.ts";
import { renderPost } from "../lib/render-post.ts";
import { Working } from "../ui/working.tsx";

type Candidate = { label: string; name: string; idea: string; source: "direction" | "sketch"; html: string; css: string; usesPhoto: boolean; rationale: { decision: string; choice: string; reason: string; cites: string[] }[] };
type Job = {
  status: "building" | "rendering" | "judging" | "done" | "failed";
  stage: string;
  energy: number | null;
  sketch: "none" | "running" | "used" | "failed";
  candidates: Candidate[];
  renders: Record<string, { issues: number }>;
  ranking?: { order: string[]; winner: string; why: string; notes: Record<string, string>; factConflicts: string[] };
  error?: string;
};
export type BoldChoice = { label: string; page: string; candidate: Candidate | null };
type Option = { label: string; page: string; name: string; note: string; pick: boolean; candidate: Candidate | null };

const POLL_MS = 5000;
const STAGES: Record<Job["status"], string> = {
  building: "Finding bolder ideas and designing them…",
  rendering: "Checking each layout…",
  judging: "The critic is comparing them…",
  done: "",
  failed: "",
};

export function BoldVersion(props: {
  sessionId: string;
  postId: string;
  aspect: "1:1" | "4:5";
  /** The post as first made. */
  quickPage: string;
  /** Builds a full post page from a candidate's HTML and CSS, with this post's copy, photo and kit look. */
  pageFor: (c: Candidate) => string;
  /** False once this visit's bold version is used on another post. */
  available: boolean;
  onStart: () => void;
  onChoose: (c: BoldChoice) => void;
}) {
  const { sessionId, postId, aspect, quickPage, pageFor, available, onStart, onChoose } = props;
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const sent = useRef(false);
  const pages = useRef<Record<string, string>>({});

  // Follow the job until it's done. Browsers pause timers in a hidden tab (live, Nov 6: polling
  // stopped while the owner was away), so coming back to the tab checks at once.
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      stopped = true;
      try {
        // A check that hangs would stop the polling, so it gives up after 15 s.
        setJob(await call<Job>("/api/posts/bold/status", { sessionId, postId }, { timeoutMs: 15_000 }));
      } catch {
        // A dropped or timed-out poll just waits for the next one.
        setJob((j) => (j ? { ...j } : j));
      }
    };
    const t = setTimeout(() => void poll(), POLL_MS);
    const onShow = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      stopped = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [job, sessionId, postId]);

  // Candidates are designed: render, check and send each, then start the critic.
  useEffect(() => {
    if (job?.status !== "rendering" || sent.current) return;
    sent.current = true;
    void (async () => {
      try {
        const all: { label: string; page: string }[] = [{ label: "quick", page: quickPage }, ...job.candidates.map((c) => ({ label: c.label, page: pageFor(c) }))];
        for (const { label, page } of all) {
          const r = await renderPost(page, aspect, { jpeg: true });
          if (!r?.jpeg) continue;
          pages.current[label] = page;
          await call("/api/posts/bold/render", { sessionId, postId, label, jpeg: r.jpeg, issues: r.issues.map(({ slot, code, n }) => ({ slot, code, ...(n === undefined ? {} : { n }) })) });
        }
        setJob(await call<Job>("/api/posts/bold/judge", { sessionId, postId }));
      } catch (e) {
        setError((e as ApiError).message ?? "The bolder version stopped. The post stays as it is.");
      }
    })();
  }, [job, quickPage, pageFor, aspect, sessionId, postId]);

  // The critic is done: the top two, the critic's pick first.
  useEffect(() => {
    if (job?.status !== "done" || options) return;
    const r = job.ranking;
    if (!r) return;
    const top = r.order.filter((l) => l === "quick" || pages.current[l] || job.candidates.some((c) => c.label === l)).slice(0, 2);
    setOptions(
      top.map((l) => {
        const c = job.candidates.find((x) => x.label === l) ?? null;
        return {
          label: l,
          page: pages.current[l] ?? (c ? pageFor(c) : quickPage),
          name: l === "quick" ? "As first made" : c?.source === "sketch" ? "From a painted rough" : (c?.name ?? "Bolder"),
          note: r.notes[l] ?? "",
          pick: l === r.winner,
          candidate: c,
        };
      }),
    );
  }, [job, options, pageFor, quickPage]);

  async function start() {
    setError(null);
    try {
      const j = await call<Job>("/api/posts/bold/start", { sessionId, postId });
      setJob(j);
      onStart();
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "bold_cap") onStart();
      setError(err.message ?? "The bolder version couldn't start.");
    }
  }

  if (!job) {
    if (!available) return null;
    return (
      <div className="bold-offer">
        <button type="button" className="c-btn" onClick={() => void start()}>
          Make it bolder
        </button>
        <p className="muted small">One per visit. Specs tries a few louder ideas and the critic picks. It takes a few minutes; keep going and it'll show up here.</p>
        {error && <p className="error small">{error}</p>}
      </div>
    );
  }
  if (error || job.status === "failed") return <p className="error small">{error ?? "The bolder version stopped partway. The post stays as it is, and nothing more was charged."}</p>;
  if (job.status !== "done")
    return (
      <>
        <Working kind="making" lead={STAGES[job.status]} />
        <p className="muted small">Keep this tab open: the last step, checking each layout, runs here in your browser.</p>
      </>
    );
  if (!options?.length || (options.length === 1 && options[0]!.label === "quick")) return <p className="muted small">{job.ranking?.why ?? "No bolder version beat the original, so the post stays as it is."}</p>;

  return (
    <div className="bold-choice">
      <p className="eyebrow">Pick one</p>
      <div className="bold-options">
        {options.map((o) => (
          <figure key={o.label} className="bold-option" data-chosen={chosen === o.label || undefined}>
            <Thumb html={o.page} aspect={aspect} />
            <figcaption>
              <b>{o.name}</b>
              {o.pick && <span className="bold-pick">Critic's pick</span>}
              {o.note && <span className="muted small">{o.note}</span>}
              <button
                type="button"
                className="c-btn"
                aria-pressed={chosen === o.label}
                onClick={() => {
                  setChosen(o.label);
                  onChoose({ label: o.label, page: o.page, candidate: o.candidate });
                }}
              >
                {chosen === o.label ? "Using this one" : "Use this one"}
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
      {job.ranking?.why && <p className="muted small">Why the critic picked it: {job.ranking.why}</p>}
      {job.ranking?.factConflicts.length ? <p className="error small">Worth checking: {job.ranking.factConflicts.join(" ")}</p> : null}
    </div>
  );
}

/** A post page scaled into a small card, in a frame with scripts off. */
function Thumb({ html, aspect }: { html: string; aspect: "1:1" | "4:5" }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const h = aspect === "4:5" ? 1350 : 1080;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setScale(e.contentRect.width / 1080));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="bold-thumb" style={{ aspectRatio: `1080 / ${h}` }}>
      <iframe title="Post option" sandbox="allow-same-origin" srcDoc={html} style={{ width: 1080, height: h, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
    </div>
  );
}
