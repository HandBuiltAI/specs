"use client";

// A generated post, scaled to fit the card. "Why this works" pins each decision to the part of
// the post it shaped, with the kit chunks behind it; the toggle swaps in the same brief made with
// no kit; the post downloads as a 1080px PNG. The post runs in a frame with scripts off; the
// frame shares our origin only so we can measure what to pin and copy it to a PNG.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PropsOf } from "../../../core/catalog.ts";
import { pinTarget } from "../../../core/post-html.ts";
import { Shell, Skeleton, type Status } from "../primitives.tsx";

type Props = PropsOf<"PostPreview"> & { status?: Status; errorText?: string };
type Version = Pick<Props, "format" | "html" | "alt" | "rationale" | "caption">;
type Box = { x: number; y: number; w: number; h: number };
/** Measured in the post's own 1080px space. Null: the note is about the whole post or the caption. */
type Pin = Box | null;

export function PostPreview(props: Props) {
  const { status, errorText, baseline, fileName } = props;
  const [variant, setVariant] = useState<"kit" | "baseline">("kit");
  const v: Version = variant === "baseline" && baseline ? baseline : props;
  const [why, setWhy] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ i: number; at: number } | null>(null);
  const notes = useRef<HTMLOListElement>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.3);
  const h = v.format === "4:5" ? 1350 : 1080;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setScale(e.contentRect.width / 1080));
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  // Reset the overlay when the post changes.
  useEffect(() => {
    setPins([]);
    setHot(null);
  }, [v.html]);

  const measure = useCallback(async () => {
    const doc = frame.current?.contentDocument;
    const post = doc?.querySelector<HTMLElement>(".post");
    if (!doc || !post) return;
    await doc.fonts?.ready;
    const origin = post.getBoundingClientRect();
    setPins(
      v.rationale.map((r) => {
        const sel = pinTarget(r.decision);
        if (!sel) return null;
        const el = [...doc.querySelectorAll<HTMLElement>(sel)].find((e) => e.getBoundingClientRect().width > 0 && (e.tagName === "IMG" || e.textContent?.trim() !== ""));
        if (!el) return null;
        const r2 = el.getBoundingClientRect();
        return { x: r2.left - origin.left, y: r2.top - origin.top, w: r2.width, h: r2.height };
      }),
    );
  }, [v.rationale]);

  // The frame can finish loading before React attaches onLoad, so measure again when the overlay opens.
  useEffect(() => {
    if (why) void measure();
  }, [why, measure]);

  const download = useCallback(async () => {
    const post = frame.current?.contentDocument?.querySelector<HTMLElement>(".post");
    if (!post) return;
    setBusy(true);
    setSaveError(null);
    try {
      const { toPng } = await import("html-to-image");
      const fontEmbedCSS = await embeddedFontCss(frame.current!.contentDocument!);
      const url = await toPng(post, { width: 1080, height: h, pixelRatio: 1, cacheBust: false, fontEmbedCSS });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName ?? "post"}${variant === "baseline" ? "-no-kit" : ""}.png`;
      a.click();
    } catch {
      setSaveError("The PNG didn't save. Try again, or take a screenshot.");
    } finally {
      setBusy(false);
    }
  }, [fileName, variant, h]);

  // A pin and its note point at each other: tap one and the page glides to the other.
  const jump = useCallback((i: number, to: "note" | "post") => {
    const target = to === "note" ? notes.current?.children[i] : box.current;
    if (!(target instanceof HTMLElement)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: to === "note" ? "center" : "start" });
    setHot(i);
    setFlash({ i, at: Date.now() });
  }, []);

  // Number pins in note order; notes on the same element share its outline.
  const outlines = new Map<string, { box: Box; n: number[] }>();
  pins.forEach((p, i) => {
    if (!p) return;
    const k = `${Math.round(p.x)}:${Math.round(p.y)}:${Math.round(p.w)}`;
    const o = outlines.get(k) ?? { box: p, n: [] };
    o.n.push(i);
    outlines.set(k, o);
  });

  return (
    <Shell name="PostPreview" writesTo={null} status={status} errorText={errorText ?? saveError ?? undefined} skeleton={<Skeleton block={300} lines={1} />}>
      {baseline && (
        <div className="c-seg" role="radiogroup" aria-label="Which version">
          <button type="button" role="radio" aria-checked={variant === "kit"} onClick={() => setVariant("kit")}>
            With kit
          </button>
          <button type="button" role="radio" aria-checked={variant === "baseline"} onClick={() => setVariant("baseline")}>
            Without kit
          </button>
        </div>
      )}
      <div className="c-post" ref={box} style={{ aspectRatio: `1080 / ${h}` }} data-why={why}>
        <iframe
          ref={frame}
          title={v.alt}
          srcDoc={v.html}
          sandbox="allow-same-origin"
          onLoad={measure}
          style={{ width: 1080, height: h, transform: `scale(${scale})` }}
          tabIndex={-1}
        />
        {why && (
          <div className="c-pins">
            {[...outlines.values()].map(({ box: b, n }) => (
              <div
                key={n[0]}
                className="c-pin-box"
                data-hot={n.includes(hot ?? -1)}
                style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale }}
              />
            ))}
            {[...outlines.values()].map(({ box: b, n }, k) => {
              // The numbers sit just outside their outline, to the left when there's room, else above
              // it, else on its corner; always inside the post so none is cut off or covers the copy.
              const w = n.length * 25 - 3;
              const [x, y, bw] = [b.x * scale, b.y * scale, b.w * scale];
              const fitsLeft = x >= w + 6;
              const fitsAbove = y >= 28;
              const rawLeft = fitsLeft ? x - w - 4 : fitsAbove ? x : x - 11;
              const rawTop = fitsLeft ? y - 2 : fitsAbove ? y - 26 : y - 11;
              const left = Math.min(Math.max(rawLeft, 4), Math.max(4, Math.min(x + bw, 1080 * scale) - w - 4));
              const top = Math.min(Math.max(rawTop, 4), h * scale - 26);
              return (
                <span key={n[0]} className="c-pin-tags" style={{ left, top, ["--k" as string]: k }}>
                  {n.map((i) => (
                    <button
                      type="button"
                      key={i}
                      className="c-pin"
                      aria-label={`Note ${i + 1}: ${v.rationale[i]?.decision ?? ""}`}
                      data-hot={hot === i}
                      onMouseEnter={() => setHot(i)}
                      onMouseLeave={() => setHot(null)}
                      onFocus={() => setHot(i)}
                      onBlur={() => setHot(null)}
                      onClick={() => jump(i, "note")}
                    >
                      {i + 1}
                    </button>
                  ))}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div className="c-row-between">
        <span className="c-mono-dim">
          {v.format} · {variant === "baseline" ? "no kit" : "with kit"}
        </span>
        <span className="c-row">
          <button type="button" className="c-btn ghost" onClick={download} disabled={busy}>
            {busy ? "Saving…" : "PNG"}
          </button>
          <button type="button" className="c-btn" aria-pressed={why} onClick={() => setWhy((w) => !w)} disabled={!v.rationale.length}>
            {why ? "Hide why" : "Why this works"}
          </button>
        </span>
      </div>
      {why && (
        <ol className="c-why-list" ref={notes}>
          {v.rationale.map((r, i) => (
            <li
              key={flash?.i === i ? `${i}-${flash.at}` : i}
              data-hot={hot === i}
              data-flash={flash?.i === i}
              data-pinned={!!pins[i]}
              onMouseEnter={() => setHot(i)}
              onMouseLeave={() => setHot(null)}
            >
              {pins[i] ? (
                <button type="button" className="c-pin" aria-label={`Show note ${i + 1} on the post`} onClick={() => jump(i, "post")}>
                  {i + 1}
                </button>
              ) : (
                <b className="c-pin">{i + 1}</b>
              )}
              <div>
                <span className="c-why-k">{r.decision}</span>
                {r.choice && <p className="c-why-choice">{r.choice}</p>}
                {r.reason && <p className="c-why-reason">{r.reason}</p>}
                <span className="c-why-chunks">
                  {r.chunks.length ? r.chunks.map((c) => <span key={c}>{c}</span>) : <em>no kit rule cited</em>}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {v.caption && (
        <details className="c-caption">
          <summary>Caption</summary>
          <p>{v.caption}</p>
        </details>
      )}
    </Shell>
  );
}

/** The post's @font-face rules with each font inlined as a data URL. html-to-image can't find
 *  fonts linked inside the frame on its own, and a PNG without them falls back to system type. */
async function embeddedFontCss(doc: Document): Promise<string> {
  const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => l.href.includes("/fonts/") || l.href.includes("fonts.googleapis.com"));
  const out: string[] = [];
  for (const link of links) {
    const css = await (await fetch(link.href)).text();
    const urls = [...new Set([...css.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]!))];
    let inlined = css;
    for (const u of urls) {
      const blob = await (await fetch(new URL(u, link.href))).blob();
      const data = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(blob);
      });
      inlined = inlined.split(u).join(data);
    }
    out.push(inlined);
  }
  return out.join("\n");
}
