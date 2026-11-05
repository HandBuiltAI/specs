"use client";

// Two or three candidate palettes, fanned like paint cards. Picking one lifts it to the front.
import { useState } from "react";
import { WRITES_TO, type AnswerOf, type PropsOf } from "../../../core/catalog.ts";
import { Question, Shell, Skeleton, Sources, type CommonProps } from "../primitives.tsx";

type Props = PropsOf<"SwatchPicker"> & CommonProps<AnswerOf<"SwatchPicker">> & { value?: string };

const TILT = [[-7, 6], [6, 10], [0, 14]] as const;

export function SwatchPicker({ title, titleMuted, options, value, status, errorText, onAnswer }: Props) {
  const [picked, setPicked] = useState(value);
  const n = options.length;
  return (
    <Shell name="SwatchPicker" writesTo={WRITES_TO.SwatchPicker} status={status} errorText={errorText} skeleton={<Skeleton block={200} lines={1} />}>
      <Question title={title} muted={titleMuted} />
      <div className="c-fan" role="radiogroup" aria-label={title} data-count={n}>
        {options.map((o, i) => {
          const on = picked === o.id;
          const [rot, drop] = TILT[i] ?? [0, 0];
          const bg = o.colors[0]!;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              className="c-pal"
              disabled={!onAnswer}
              style={{
                background: bg,
                color: readableOn(bg),
                left: `${(i * (100 - 48)) / Math.max(1, n - 1)}%`,
                transform: on ? "rotate(0) translateY(-8px)" : `rotate(${n === 3 && i === 1 ? 0 : rot}deg) translateY(${drop}px)`,
              }}
              onClick={() => {
                setPicked(o.id);
                onAnswer?.({ optionId: o.id });
              }}
            >
              <span className="c-check" aria-hidden="true">✓</span>
              <span className="c-pal-stack">
                {o.colors.slice(1).map((c, j) => (
                  <i key={j} style={{ background: c }} title={c} />
                ))}
              </span>
              <span>
                <b>{o.label}</b>
                {o.note && <small>{o.note}</small>}
                {o.heading && (
                  <small className="c-pal-heading">
                    Headlines <i style={{ background: o.heading }} title={o.heading} />
                  </small>
                )}
                <small className="c-pal-hex">{o.colors.join(" ")}</small>
              </span>
            </button>
          );
        })}
      </div>
      {options.some((o) => o.sources.length) && <Sources sources={options.flatMap((o) => o.sources)} />}
    </Shell>
  );
}

/** Ink or paper text, whichever reads better on the palette's first color. */
function readableOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return L > 0.4 ? "#141414" : "#fafafa";
}
