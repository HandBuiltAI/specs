"use client";

// Upload screen and Brand DNA reveal (spec, user flow steps 2 and 3). The browser only sends
// files and structured fields; the server writes every prompt. Extraction runs as many short
// calls (one per upload, then one per kit chunk) because the deployed function is cut off at
// about 30 seconds, and each answer is shown as soon as it lands.
import { Working } from "../ui/working.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LIMITS, charCount } from "../../core/limits.ts";
import { EXTRACT_CHUNKS, type ChunkDraft, type Conflicts, type Evidence } from "../../core/extract.ts";
import type { Swatch } from "../../core/colors.ts";
import { call, callPatiently, isDropped, pool, sendForm, type ApiError } from "../lib/api.ts";
import { LOGO_ACCEPT, isSvg, logoProblem, prepareImage } from "../lib/images.ts";
import { Turnstile } from "../lib/turnstile.tsx";
import Intake from "./intake.tsx";
import { BrandBoard } from "./brand-board.tsx";
import type { IntakeChunks } from "../../core/intake.ts";
import { businessNameOf } from "../../core/session-kit.ts";
import MakePosts from "./make-posts.tsx";
import { ReadingFinds } from "./reading-finds.tsx";

type UploadKindApi = "image" | "logo" | "pdf" | "url" | "pasted" | "note";
type Upload = { id: string; kind: UploadKindApi; label: string; colors?: Swatch[]; pages?: number };
type CallState = { status: "running" | "done" | "failed"; attempts: number };
type Item = ChunkDraft["items"][number] & { edited?: boolean };
type ChunkRecord =
  | { target: (typeof EXTRACT_CHUNKS)[number]["id"]; draft: ChunkDraft & { items: Item[] }; warnings: string[] }
  | { target: "conflicts"; conflicts: Conflicts["conflicts"]; warnings: string[] };
type Kit = {
  uploads: Upload[];
  extraction: { locked: boolean; reads: Record<string, CallState>; targets: Record<string, CallState> };
  evidence: { uploadId: string; upload: string; evidence: Evidence }[];
  chunks: ChunkRecord[];
};

const SESSION_KEY = "specs.sessionId";
const HEX = /#[0-9a-f]{6}\b/gi;
const KIND_NAME: Record<UploadKindApi, string> = { image: "Photo", logo: "Logo", pdf: "PDF", url: "Website", pasted: "Website text", note: "Note" };

const STATE_TEXT: Record<string, string> = {
  open: "Open",
  off: "Switched off right now. The demo brands still work.",
  closed_for_today: "Closed for today: the daily spending cap is reached.",
  not_configured: "Not set up on this server yet.",
  unreachable: "Couldn't check: the server didn't answer.",
};

/** Reads running at once. Each is one Claude call on one upload, so they don't wait on each other. */
const READ_AT_ONCE = 6;
const messageOf = (e: unknown) => (e as Error).message ?? "Something went wrong.";
const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

/**
 * A PDF over the cap is refused here, before it goes up: Netlify drops a request that big before
 * our server sees it, and the browser only says "Load failed".
 */
function pdfProblem(file: File): string | null {
  if (file.size <= LIMITS.pdfBytes) return null;
  return `${file.name} is ${mb(file.size)}, and Specs takes a PDF of up to ${mb(LIMITS.pdfBytes)}. Save a smaller copy (in Preview: File, Export, Quartz Filter, Reduce File Size) or leave it out.`;
}

/** Why one upload didn't go up, in words, naming the file. */
function uploadProblem(name: string, e: unknown): string {
  const code = (e as ApiError).code;
  if (isDropped(e) || code === "http_400" || code === "http_413") {
    return `${name} didn't upload: the connection dropped, which usually means the file is too large.`;
  }
  return `${name} didn't upload: ${messageOf(e)}`;
}

export default function BuildKit({ siteKey }: { siteKey: string }) {
  const [generation, setGeneration] = useState("checking");
  const [token, setToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The form.
  const [photos, setPhotos] = useState<File[]>([]);
  const [logo, setLogo] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);

  // What the server knows.
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [reads, setReads] = useState<Record<string, CallState>>({});
  const [targets, setTargets] = useState<Record<string, CallState>>({});
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [chunks, setChunks] = useState<Record<string, ChunkRecord>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => setGeneration(d.generation ?? "unreachable"))
      .catch(() => setGeneration("unreachable"));
  }, []);

  // Bumped when an answer or a chat change edits the kit, so posts already made pick it up.
  const [kitVersion, setKitVersion] = useState(0);
  const loadKit = useCallback(async (sid: string) => {
    const kit = await call<Kit>("/api/kit", { sessionId: sid });
    setUploads(kit.uploads);
    setReads(kit.extraction.reads);
    setTargets(kit.extraction.targets);
    setEvidence(Object.fromEntries(kit.evidence.map((e) => [e.uploadId, e.evidence])));
    setChunks(Object.fromEntries(kit.chunks.map((c) => [c.target, c])));
  }, []);

  // Pick up a session after a reload; sessions last a day on the server.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(SESSION_KEY);
    } catch {}
    if (!saved) return;
    loadKit(saved)
      .then(() => setSessionId(saved))
      .catch(() => {
        try {
          sessionStorage.removeItem(SESSION_KEY);
        } catch {}
      });
  }, [loadKit]);

  const onToken = useCallback((t: string | null) => setToken(t), []);

  /** This tab keeps its kit across reloads; starting over forgets it here and begins again. */
  function startOver() {
    if (!window.confirm("Start a new kit? This one stays saved until it expires, but this tab will forget it.")) return;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    window.location.reload();
  }

  async function start() {
    setError(null);
    setBusy("Starting a session…");
    try {
      const d = await call<{ sessionId: string }>("/api/session", { turnstileToken: token });
      setSessionId(d.sessionId);
      try {
        sessionStorage.setItem(SESSION_KEY, d.sessionId);
      } catch {}
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  // ---------- the extraction calls ----------

  const markRead = (id: string, s: CallState["status"]) => setReads((r) => ({ ...r, [id]: { status: s, attempts: (r[id]?.attempts ?? 0) + (s === "running" ? 1 : 0) } }));
  const markTarget = (t: string, s: CallState["status"]) => setTargets((r) => ({ ...r, [t]: { status: s, attempts: (r[t]?.attempts ?? 0) + (s === "running" ? 1 : 0) } }));

  async function readOne(sid: string, u: Upload) {
    markRead(u.id, "running");
    setFailures((f) => ({ ...f, [u.id]: "" }));
    try {
      const d = await callPatiently<{ evidence: Evidence }>("/api/extract/read", { sessionId: sid, uploadId: u.id });
      setEvidence((e) => ({ ...e, [u.id]: d.evidence }));
      markRead(u.id, "done");
    } catch (e) {
      markRead(u.id, "failed");
      setFailures((f) => ({ ...f, [u.id]: messageOf(e) }));
    }
  }

  async function draftOne(sid: string, target: string) {
    markTarget(target, "running");
    setFailures((f) => ({ ...f, [target]: "" }));
    try {
      const rec = await callPatiently<ChunkRecord>("/api/extract/assemble", { sessionId: sid, target });
      setChunks((c) => ({ ...c, [target]: rec }));
      markTarget(target, "done");
    } catch (e) {
      markTarget(target, "failed");
      setFailures((f) => ({ ...f, [target]: messageOf(e) }));
    }
  }

  async function draftAll(sid: string, skipDone: Record<string, CallState>) {
    const todo = [...EXTRACT_CHUNKS.map((c) => c.id as string), "conflicts"].filter((t) => skipDone[t]?.status !== "done");
    if (!todo.length) return;
    // The first call writes the evidence into the prompt cache; the rest read it at a tenth of the price.
    const [first, ...rest] = todo;
    await draftOne(sid, first!);
    await pool(rest, 4, (t) => draftOne(sid, t));
  }

  async function buildKit() {
    if (!sessionId) return;
    setError(null);
    const sid = sessionId;
    const added: Upload[] = [];
    const problems: string[] = [];
    const tried = new Set<string>();
    setWorking(true);
    setBusy("Uploading…");
    // Each upload is read the moment it lands, a few at a time, while the rest are still going up.
    const reading: Promise<void>[] = [];
    let slots = READ_AT_ONCE;
    const waiting: (() => void)[] = [];
    const readSoon = (u: Upload) => {
      tried.add(u.id);
      reading.push(
        (async () => {
          if (slots === 0) await new Promise<void>((go) => waiting.push(go));
          slots--;
          try {
            await readOne(sid, u);
          } finally {
            slots++;
            waiting.shift()?.();
          }
        })(),
      );
    };
    const send = async (fields: Record<string, string | Blob>, thumb?: Blob) => {
      const d = await sendForm<{ upload: Upload }>("/api/uploads", { sessionId: sid, ...fields });
      added.push(d.upload);
      if (thumb) setThumbs((t) => ({ ...t, [d.upload.id]: URL.createObjectURL(thumb) }));
      setUploads((u) => [...u, d.upload]);
      readSoon(d.upload);
    };
    // One file that won't go up (an odd format, a refused size) never stops the rest.
    const attempt = async (name: string, step: () => Promise<void>) => {
      try {
        await step();
      } catch (e) {
        problems.push(uploadProblem(name, e));
      }
    };
    try {
      // Words first: they go up instantly, so reading starts while photos are still being shrunk.
      if (note.trim()) await attempt("Your note", () => send({ kind: "note", text: note }));
      if (pasted.trim()) await attempt("The pasted website text", () => send({ kind: "pasted", text: pasted }));
      if (url.trim()) await attempt("The website link", () => send({ kind: "url", url: url.trim() }));
      if (pdf) {
        await attempt(pdf.name, async () => {
          const tooBig = pdfProblem(pdf);
          if (tooBig) throw new Error(tooBig);
          await send({ kind: "pdf", file: pdf });
        });
      }
      // A logo dropped in with the photos ("tss-logo.png") is still the logo, when the logo slot is empty.
      const logoFile = logo ?? photos.find((p) => /logo/i.test(p.name)) ?? null;
      if (logoFile) {
        setBusy(`Preparing and uploading ${logoFile.name}…`);
        await attempt(logoFile.name, async () => {
          const { file, colors } = await prepareImage(logoFile, "logo");
          await send({ kind: "logo", file, colors: JSON.stringify(colors) }, file);
        });
      }
      for (const p of photos.filter((p) => p !== logoFile)) {
        setBusy(`Shrinking and uploading ${p.name}…`);
        await attempt(p.name, async () => {
          const { file, colors } = await prepareImage(p, "image");
          await send({ kind: "image", file, colors: JSON.stringify(colors) }, file);
        });
      }
      setBusy(null);
      if (problems.length) {
        const rest = added.length ? ` Specs is building your kit from the other ${added.length === 1 ? "upload" : `${added.length} uploads`}.` : " Nothing went up, so there's nothing to build from yet.";
        setError(`${problems.join(" ")}${rest}`);
      }
      await Promise.all(reading);
      if (added.length) await readAndDraftSteps(sid, [...uploads, ...added], tried);
    } finally {
      setBusy(null);
      setWorking(false);
    }
  }

  async function readAndDraft(sid: string, list: Upload[]) {
    setWorking(true);
    try {
      await readAndDraftSteps(sid, list, new Set());
    } finally {
      setWorking(false);
    }
  }

  async function readAndDraftSteps(sid: string, list: Upload[], tried: Set<string>) {
    const unread = list.filter((u) => !tried.has(u.id) && reads[u.id]?.status !== "done");
    await pool(unread, READ_AT_ONCE, (u) => readOne(sid, u));
    // One more try for any read that failed (a slow page, a timeout), then draft from what was read.
    let kit = await call<Kit>("/api/kit", { sessionId: sid }).catch(() => null);
    if (!kit) return;
    const retry = list.filter((u) => kit!.extraction.reads[u.id]?.status === "failed" && kit!.extraction.reads[u.id]!.attempts < LIMITS.extractAttempts);
    if (retry.length) {
      await pool(retry, READ_AT_ONCE, (u) => readOne(sid, u));
      kit = await call<Kit>("/api/kit", { sessionId: sid }).catch(() => null);
      if (!kit) return;
    }
    setReads(kit.extraction.reads);
    if (!Object.values(kit.extraction.reads).some((r) => r.status === "done")) {
      setError("None of the uploads could be read, so there's nothing to build from yet.");
      return;
    }
    await draftAll(sid, kit.extraction.targets);
  }

  async function edit(chunk: string, item: number, value: string | null) {
    if (!sessionId) return;
    try {
      const rec = await call<ChunkRecord>("/api/kit/edit", { sessionId, chunk, item, value });
      setChunks((c) => ({ ...c, [chunk]: rec }));
    } catch (e) {
      setError(messageOf(e));
    }
  }

  // ---------- view ----------

  const started = uploads.length > 0;
  const nothingChosen = !photos.length && !logo && !pdf && !url.trim() && !pasted.trim() && !note.trim();
  const tooLong = charCount(note) > LIMITS.messageChars || charCount(pasted) > LIMITS.pastedChars;
  // The gaps step starts once every chunk has finished drafting (or used up its tries).
  const targetIds = [...EXTRACT_CHUNKS.map((c) => c.id as string), "conflicts"];
  const draftingDone =
    targetIds.some((t) => targets[t]?.status === "done") &&
    targetIds.every((t) => targets[t]?.status === "done" || (targets[t]?.status === "failed" && targets[t]!.attempts >= LIMITS.extractAttempts));
  // Uploads that were never read, or drafting that stopped (a reload, a closed tab): offer to carry on.
  const anyRunning = Object.values(reads).some((r) => r?.status === "running") || Object.values(targets).some((t) => t?.status === "running");
  const stalled = started && !busy && !working && !anyRunning && !draftingDone && (uploads.some((u) => !reads[u.id]) || Object.values(reads).some((r) => r?.status === "done"));
  const labelOf = useMemo(() => Object.fromEntries(uploads.map((u) => [u.id, u.label])), [uploads]);
  const intakeChunks = useMemo<IntakeChunks>(() => {
    const out: IntakeChunks = {};
    for (const rec of Object.values(chunks)) {
      if (rec.target === "conflicts") out.conflicts = { conflicts: rec.conflicts };
      else out[rec.target] = { draft: rec.draft };
    }
    return out;
  }, [chunks]);
  const name = businessNameOf(intakeChunks);

  /** Dropped files go where they belong: images to photos, a PDF to the PDF slot. */
  function onDrop(files: File[]) {
    // An SVG, or an image named like a logo, goes to the logo slot; other images are photos.
    const logoLike = files.find((f) => isSvg(f) || (/^image\//.test(f.type) && /logo|wordmark|lockup/i.test(f.name)));
    const images = files.filter((f) => f !== logoLike && /^image\/(jpeg|png|webp|gif|avif|heic|heif)$/.test(f.type));
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const design = files.map(logoProblem).find((p) => p && !/\.pdf/i.test(p));
    if (logoLike) setLogo(logoLike);
    if (images.length) setPhotos((p) => [...p, ...images].slice(0, LIMITS.imageCount));
    const pdfTooBig = pdfs[0] ? pdfProblem(pdfs[0]) : null;
    if (pdfs[0] && !pdfTooBig) setPdf(pdfs[0]);
    const left = files.length - (logoLike ? 1 : 0) - images.length - Math.min(1, pdfs.length);
    if (design) setError(design);
    else if (pdfTooBig) setError(pdfTooBig);
    else if (left > 0) setError(`Specs takes photos, one logo (SVG, PNG, JPEG or WebP) and one PDF. ${left} ${left === 1 ? "file was" : "files were"} left out.`);
    else setError(null);
  }

  function pickPdf(f: File | null) {
    const problem = f && pdfProblem(f);
    if (problem) {
      setError(problem);
      return;
    }
    setPdf(f);
    setError(null);
  }

  function pickLogo(f: File | null) {
    const problem = f && logoProblem(f);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setLogo(f);
  }

  return (
    <>
      {!sessionId && (
        <div className="card">
          <dl>
            <dt>Live extraction</dt>
            <dd>{STATE_TEXT[generation] ?? "Checking…"}</dd>
          </dl>
          {generation === "open" && (
            <>
              <p className="muted" style={{ marginTop: "1rem" }}>
                A quick check that you&rsquo;re a person, then you can upload.
              </p>
              <Turnstile siteKey={siteKey} onToken={onToken} />
              <button onClick={start} disabled={!token || !!busy}>
                Start
              </button>
            </>
          )}
        </div>
      )}

      {sessionId && !started && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your materials</h2>
          <p className="muted">Whatever you have. Messy is fine: that&rsquo;s the point.</p>

          <div
            className={`dropzone ${dragging ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onDrop([...e.dataTransfer.files]);
            }}
          >
            <p className="dropzone-title">Drop photos, a logo and a PDF here</p>
            <p className="muted small">
              Up to {LIMITS.imageCount} photos, one logo (SVG or PNG is best) and one PDF of up to {LIMITS.pdfPages} pages. Images are shrunk in your browser before upload.
            </p>
            <div className="dropzone-pick">
              <label htmlFor="photos" className="c-btn ghost">
                Choose photos
              </label>
              <input id="photos" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif" multiple onChange={(e) => setPhotos((p) => [...p, ...(e.target.files ?? [])].slice(0, LIMITS.imageCount))} />
              <label htmlFor="logo" className="c-btn ghost">
                Choose a logo
              </label>
              <input id="logo" className="visually-hidden" type="file" accept={LOGO_ACCEPT} onChange={(e) => pickLogo(e.target.files?.[0] ?? null)} />
              <label htmlFor="pdf" className="c-btn ghost">
                Choose a PDF
              </label>
              <input id="pdf" className="visually-hidden" type="file" accept="application/pdf" onChange={(e) => pickPdf(e.target.files?.[0] ?? null)} />
            </div>
            {(photos.length > 0 || pdf || logo) && (
              <ul className="dropped">
                {logo && (
                  <li>
                    <span>
                      {logo.name} <span className="muted small">logo</span>
                    </span>
                    <button type="button" className="quiet" aria-label={`Remove ${logo.name}`} onClick={() => setLogo(null)}>
                      Remove
                    </button>
                  </li>
                )}
                {photos.map((p, i) => (
                  <li key={`${p.name}-${i}`}>
                    <span>{p.name}</span>
                    <button type="button" className="quiet" aria-label={`Remove ${p.name}`} onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </li>
                ))}
                {pdf && (
                  <li>
                    <span>{pdf.name}</span>
                    <button type="button" className="quiet" aria-label={`Remove ${pdf.name}`} onClick={() => setPdf(null)}>
                      Remove
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>


          <label htmlFor="url">Website</label>
          <input id="url" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          <p className="counter">We read the homepage and up to two more pages.</p>

          <label htmlFor="pasted">Or paste text from your site</label>
          <textarea id="pasted" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Your About page, a menu, a product description…" />
          <p className="counter">
            {charCount(pasted)} / {LIMITS.pastedChars}
          </p>

          <label htmlFor="note">Anything else?</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="We're a family bakery, 30 years in Calumet." />
          <p className="counter">
            {charCount(note)} / {LIMITS.messageChars}
          </p>

          <button onClick={buildKit} aria-busy={!!busy} disabled={nothingChosen || tooLong || !!busy}>
            Build my kit
          </button>
        </div>
      )}

      {busy && <Working kind="reading" lead={busy} />}
      {error && <p className="error">{error}</p>}
      {stalled && sessionId && (
        <div className="card resume">
          <p>Your uploads are here, but the kit stopped before it was finished.</p>
          {Object.values(failures).find(Boolean) && <p className="muted small">Why: {Object.values(failures).find(Boolean)}</p>}
          <button onClick={() => readAndDraft(sessionId, uploads)}>Keep building</button>
        </div>
      )}

      {started && (
        <>
          <div className="reveal-head">
            <h2 className="reveal-title">
              {name ? `Here's ${name},` : "Here's your brand,"} <span>as your files describe it.</span>
            </h2>
            <button type="button" className="c-btn ghost" onClick={startOver} disabled={working}>
              Start a new kit
            </button>
          </div>
          {!draftingDone && (
            <ReadingFinds
              uploads={uploads}
              reads={reads}
              evidence={evidence}
              thumbs={thumbs}
              drafting={targetIds.filter((t) => targets[t]?.status === "done").length}
              draftTotal={targetIds.length}
            />
          )}
          <div className="reveal">
          <aside className="card reveal-files">
          <p className="eyebrow">Your materials</p>
          <div className="uploads">
            {uploads.map((u) => (
              <div className="upload-row" key={u.id}>
                <div>
                  <strong>{u.label}</strong> <span className="muted">· {KIND_NAME[u.kind]}</span>
                  {u.colors && u.colors.length > 0 && (
                    <div className="swatches" title="Colors sampled from the pixels">
                      {u.colors.map((c) => (
                        <span key={c.hex} className="swatch" style={{ background: c.hex }} title={`${c.hex} · ${Math.round(c.share * 100)}%`} />
                      ))}
                    </div>
                  )}
                  {evidence[u.id] && <p className="muted small">{evidence[u.id]!.summary}</p>}
                  {failures[u.id] && <p className="error small">{failures[u.id]}</p>}
                </div>
                <span className={`status ${reads[u.id]?.status ?? "waiting"}`}>{statusText(reads[u.id])}</span>
              </div>
            ))}
          </div>
          </aside>
          <BrandBoard chunks={intakeChunks} targets={targets} />
          </div>
          <details className="card kit-details">
          <summary>See every kit item and where it came from</summary>
          <p className="muted">Each item shows the upload it came from. Edit or delete anything that&rsquo;s wrong.</p>
          {[...EXTRACT_CHUNKS, { id: "conflicts" as const, title: "Where your uploads disagree" }].map((c) => (
            <ChunkCard
              key={c.id}
              title={c.title}
              state={targets[c.id]}
              record={chunks[c.id]}
              failure={failures[c.id]}
              onRetry={sessionId ? () => draftOne(sessionId, c.id) : undefined}
              onEdit={(i, v) => edit(c.id, i, v)}
            />
          ))}
          <p className="muted small">Uploads cited: {Object.values(labelOf).join(", ")}</p>
          </details>
          {sessionId && draftingDone && (
            <Intake
              sessionId={sessionId}
              chunks={intakeChunks} onKitChanged={() => {
                setKitVersion((v) => v + 1);
                return loadKit(sessionId).catch(() => {});
              }}
            />
          )}
          {sessionId && draftingDone && <MakePosts sessionId={sessionId} kitVersion={kitVersion} />}
        </>
      )}
    </>
  );
}

function statusText(s?: CallState) {
  if (!s) return "Waiting";
  if (s.status === "running") return "Reading…";
  if (s.status === "done") return "Read";
  return s.attempts >= LIMITS.extractAttempts ? "Couldn't read" : "Failed";
}

function ChunkCard(props: {
  title: string;
  state?: CallState;
  record?: ChunkRecord;
  failure?: string;
  onRetry?: () => void;
  onEdit: (item: number, value: string | null) => void;
}) {
  const { title, state, record, failure, onRetry, onEdit } = props;
  const canRetry = state?.status === "failed" && state.attempts < LIMITS.extractAttempts && onRetry;
  return (
    <section className={`card chunk ${record ? "landed" : ""}`}>
      <header className="chunk-head">
        <h3>{title}</h3>
        {record && record.target !== "conflicts" && <span className={`confidence ${record.draft.confidence}`}>{record.draft.confidence}</span>}
        {!record && <span className={`status ${state?.status ?? "waiting"}`}>{state?.status === "running" ? "Drafting…" : state?.status === "failed" ? "Failed" : "Waiting"}</span>}
      </header>
      {failure && <p className="error small">{failure}</p>}
      {canRetry && <button onClick={onRetry}>Try again</button>}
      {record?.target === "conflicts" &&
        (record.conflicts.length ? (
          <ul className="items">
            {record.conflicts.map((c, i) => (
              <li key={i}>
                <strong>{c.about}</strong>
                <ul>
                  {c.sides.map((s, j) => (
                    <li key={j}>
                      {s.says} <SourceTag upload={s.source.upload} location={s.source.location} />
                    </li>
                  ))}
                </ul>
                <p className="muted small">{c.suggestion}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None found.</p>
        ))}
      {record && record.target !== "conflicts" && (
        <>
          <p className="muted small">{record.draft.summary}</p>
          <ul className="items">
            {record.draft.items.map((item, i) => (
              <ItemRow key={`${i}-${item.label}-${item.value}`} item={item} onSave={(v) => onEdit(i, v)} onDelete={() => onEdit(i, null)} />
            ))}
          </ul>
          {record.draft.missing.length > 0 && (
            <p className="small">
              <strong>Not in your uploads:</strong> {record.draft.missing.join("; ")}
            </p>
          )}
          {record.warnings.map((w) => (
            <p key={w} className="small muted">
              ⚠ {w}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

function ItemRow({ item, onSave, onDelete }: { item: Item; onSave: (v: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.value);
  const hexes = item.value.match(HEX) ?? [];
  return (
    <li className="item">
      <div className="item-label">
        {item.label}
        {item.confidence !== "high" && !item.edited && <span className={`confidence ${item.confidence}`}>{item.confidence}</span>}
        {item.edited && <span className="confidence high">edited</span>}
      </div>
      {editing ? (
        <>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
          <p className="counter">
            {charCount(draft)} / {LIMITS.messageChars}
          </p>
          <div className="row">
            <button onClick={() => (onSave(draft), setEditing(false))} disabled={!draft.trim() || charCount(draft) > LIMITS.messageChars}>
              Save
            </button>
            <button className="quiet" onClick={() => (setDraft(item.value), setEditing(false))}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="item-value">
          {hexes.map((h) => (
            <span key={h} className="swatch" style={{ background: h }} />
          ))}
          {item.value}
        </div>
      )}
      {item.why && <div className="small muted">Why: {item.why}</div>}
      <div className="sources">
        {item.edited ? <span className="source">you</span> : item.sources.map((s, j) => <SourceTag key={j} upload={s.upload} location={s.location} />)}
      </div>
      {!editing && (
        <div className="row">
          <button className="quiet" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="quiet" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function SourceTag({ upload, location }: { upload: string; location: string }) {
  return (
    <span className="source" title={location}>
      {upload} · {location}
    </span>
  );
}
