"use client";

// Choose hero photos, or mark weak ones to leave out. Chosen photos get an ink ring and a number;
// excluded ones fade and get a red strike.
import { useState } from "react";
import { WRITES_TO, type AnswerOf, type PropsOf } from "../../../core/catalog.ts";
import { Question, Shell, Skeleton, type CommonProps } from "../primitives.tsx";

type Props = PropsOf<"PhotoPicker"> & CommonProps<AnswerOf<"PhotoPicker">> & { value?: string[] };

export function PhotoPicker({ title, titleMuted, mode, photos, max, value = [], status, errorText, onAnswer }: Props) {
  const [picked, setPicked] = useState<string[]>(value);
  const full = mode === "choose" && picked.length >= max;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : full ? p : [...p, id]));
  return (
    <Shell name="PhotoPicker" writesTo={WRITES_TO.PhotoPicker} status={status} errorText={errorText} skeleton={<Skeleton block={140} lines={1} />}>
      <Question title={title} muted={titleMuted} />
      <div className="c-photos" data-mode={mode}>
        {photos.map((p) => {
          const n = picked.indexOf(p.id);
          return (
            <button
              key={p.id}
              type="button"
              role="checkbox"
              aria-checked={n >= 0}
              aria-label={`${p.alt}${p.note ? `, ${p.note}` : ""}`}
              className="c-photo"
              disabled={!onAnswer || (full && n < 0)}
              onClick={() => toggle(p.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.src} alt="" loading="lazy" />
              {n >= 0 && <span className="c-photo-mark">{mode === "choose" ? n + 1 : "✕"}</span>}
              {p.note && <span className="c-photo-note">{p.note}</span>}
            </button>
          );
        })}
      </div>
      {onAnswer && (
        <div className="c-row-between">
          <span className="c-mono-dim">
            {mode === "choose" ? `${picked.length} of ${max} chosen` : `${picked.length} left out`}
          </span>
          <button type="button" className="c-btn" disabled={mode === "choose" && !picked.length} onClick={() => onAnswer({ photoIds: picked })}>
            {mode === "choose" ? "Use these" : picked.length ? "Leave these out" : "Keep them all"}
          </button>
        </div>
      )}
    </Shell>
  );
}
