"use client";

// A generated post, scaled to fit the card, with the "why this works" overlay toggled on top.
// The post HTML runs in a sandboxed frame with scripts off.
import { useEffect, useRef, useState } from "react";
import type { PropsOf } from "../../../core/catalog.ts";
import { Shell, Skeleton, type Status } from "../primitives.tsx";

type Props = PropsOf<"PostPreview"> & { status?: Status; errorText?: string };

export function PostPreview({ format, html, alt, rationale, status, errorText }: Props) {
  const [why, setWhy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const h = format === "4:5" ? 1350 : 1080;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setScale(e.contentRect.width / 1080));
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  return (
    <Shell name="PostPreview" writesTo={null} status={status} errorText={errorText} skeleton={<Skeleton block={300} lines={1} />}>
      <div className="c-post" ref={box} style={{ aspectRatio: `1080 / ${h}` }}>
        <iframe
          title={alt}
          srcDoc={html}
          sandbox=""
          style={{ width: 1080, height: h, transform: `scale(${scale})` }}
          tabIndex={-1}
        />
        <div className="c-why" data-on={why} aria-hidden={!why}>
          <span className="c-name">Why this works</span>
          <ol>
            {rationale.map((r, i) => (
              <li key={i}>
                <span>{r.decision}</span>
                <span className="c-why-chunks">{r.chunks.join(" · ")}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="c-row-between">
        <span className="c-mono-dim">{format} · Instagram</span>
        <button type="button" className="c-btn ghost" aria-pressed={why} onClick={() => setWhy((w) => !w)} disabled={!rationale.length}>
          {why ? "Hide why" : "Why this works"}
        </button>
      </div>
    </Shell>
  );
}
