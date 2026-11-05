"use client";

// Upload screen and Brand DNA reveal (spec, user flow steps 2 and 3). The browser only sends
// files and structured fields; the server writes every prompt. Extraction runs as many short
// calls (one per upload, then one per kit chunk) because the deployed function is cut off at
// about 30 seconds, and each answer is shown as soon as it lands.
import { useCallback, useEffect, useMemo, useState } from "react";
import { LIMITS, charCount } from "../../core/limits.ts";
import { EXTRACT_CHUNKS, type ChunkDraft, type Conflicts, type Evidence } from "../../core/extract.ts";
import type { Swatch } from "../../core/colors.ts";
import { call, pool, sendForm, type ApiError } from "../lib/api.ts";
import { LOGO_ACCEPT, isSvg, logoProblem, prepareImage } from "../lib/images.ts";
import { Turnstile } from "../lib/turnstile.tsx";
import Intake from "./intake.tsx";
import { BrandBoard } from "./brand-board.tsx";
import type { IntakeChunks } from "../../core/intake.ts";
import { businessNameOf } from "../../core/session-kit.ts";
import MakePosts from "./make-posts.tsx";

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

const messageOf = (e: unknown) => (e as Error).message ?? "Something went wrong.";

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
  const [chunks, setChunks] = useState<Record<string, ChunkRecord>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => setGeneration(d.generation ?? "unreachable"))
      .catch(() => setGeneration("unreachable"));
  }, []);

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
      const d = await call<{ evidence: Evidence }>("/api/extract/read", { sessionId: sid, uploadId: u.id });
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
      const rec = await call<ChunkRecord>("/api/extract/assemble", { sessionId: sid, target });
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
    await pool(rest, 3, (t) => draftOne(sid, t));
  }

  async function buildKit() {
    if (!sessionId) return;
    setError(null);
    const sid = sessionId;
    const added: Upload[] = [];
    const problems: string[] = [];
    setBusy("Uploading…");
    const send = async (fields: Record<string, string | Blob>) => {
      const d = await sendForm<{ upload: Upload }>("/api/uploads", { sessionId: sid, ...fields });
      added.push(d.upload);
      setUploads((u) => [...u, d.upload]);
    };
    // One file that won't go up (an odd format, a refused size) never stops the rest.
    const attempt = async (step: () => Promise<void>) => {
      try {
        await step();
      } catch (e) {
        problems.push(messageOf(e));
      }
    };
    for (const p of photos) {
      setBusy(`Shrinking and uploading ${p.name}…`);
      await attempt(async () => {
        const { file, colors } = await prepareImage(p, "image");
        await send({ kind: "image", file, colors: JSON.stringify(colors) });
      });
    }
    if (logo) {
      setBusy(`Preparing and uploading ${logo.name}…`);
      await attempt(async () => {
        const { file, colors } = await prepareImage(logo, "logo");
        await send({ kind: "logo", file, colors: JSON.stringify(colors) });
      });
    }
    setBusy("Uploading…");
    if (pdf) await attempt(() => send({ kind: "pdf", file: pdf }));
    if (url.trim()) await attempt(() => send({ kind: "url", url: url.trim() }));
    if (pasted.trim()) await attempt(() => send({ kind: "pasted", text: pasted }));
    if (note.trim()) await attempt(() => send({ kind: "note", text: note }));
    setBusy(null);
    if (problems.length) setError(`${problems.join(" ")}${added.length ? " Building from the rest." : ""}`);
    if (!added.length) return;
    await readAndDraft(sid, [...uploads, ...added]);
  }

  async function readAndDraft(sid: string, list: Upload[]) {
    setWorking(true);
    try {
      await readAndDraftSteps(sid, list);
    } finally {
      setWorking(false);
    }
  }

  async function readAndDraftSteps(sid: string, list: Upload[]) {
    const unread = list.filter((u) => reads[u.id]?.status !== "done");
    await pool(unread, 3, (u) => readOne(sid, u));
    // One more try for any read that failed (a slow page, a timeout), then draft from what was read.
    let kit = await call<Kit>("/api/kit", { sessionId: sid }).catch(() => null);
    if (!kit) return;
    const retry = list.filter((u) => kit!.extraction.reads[u.id]?.status === "failed" && kit!.extraction.reads[u.id]!.attempts < LIMITS.extractAttempts);
    if (retry.length) {
      await pool(retry, 3, (u) => readOne(sid, u));
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
    if (pdfs[0]) setPdf(pdfs[0]);
    const left = files.length - (logoLike ? 1 : 0) - images.length - Math.min(1, pdfs.length);
    if (design) setError(design);
    else if (left > 0) setError(`Specs takes photos, one logo (SVG, PNG, JPEG or WebP) and one PDF. ${left} ${left === 1 ? "file was" : "files were"} left out.`);
    else setError(null);
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
              <input id="pdf" className="visually-hidden" type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
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

          <button onClick={buildKit} disabled={nothingChosen || tooLong || !!busy}>
            Build my kit
          </button>
        </div>
      )}

      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {stalled && sessionId && (
        <div className="card resume">
          <p>Your uploads are here, but the kit stopped before it was finished.</p>
          <button onClick={() => readAndDraft(sessionId, uploads)}>Keep building</button>
        </div>
      )}

      {started && (
        <>
          <h2 className="reveal-title">
            {name ? `Here's ${name},` : "Here's your brand,"} <span>as your files describe it.</span>
          </h2>
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
          {sessionId && draftingDone && <Intake sessionId={sessionId} chunks={intakeChunks} onKitChanged={() => loadKit(sessionId).catch(() => {})} />}
          {sessionId && draftingDone && <MakePosts sessionId={sessionId} />}
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
