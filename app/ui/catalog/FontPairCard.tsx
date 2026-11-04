"use client";

// One to three font pairings, each shown as a big "Aa" in the display face with the body face under it.
// Fonts load from Google Fonts only when they are in the curated list.
import { useEffect, useState } from "react";
import { CURATED_FONTS, WRITES_TO, type AnswerOf, type PropsOf } from "../../../core/catalog.ts";
import { Question, Shell, Skeleton, type CommonProps } from "../primitives.tsx";

type Props = PropsOf<"FontPairCard"> & CommonProps<AnswerOf<"FontPairCard">> & { value?: string };

const curated = new Set<string>(CURATED_FONTS);

function useGoogleFonts(families: string[]) {
  const key = families.filter((f) => curated.has(f)).sort().join("|");
  useEffect(() => {
    if (!key) return;
    const href = `https://fonts.googleapis.com/css2?${key
      .split("|")
      .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`)
      .join("&")}&display=swap`;
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [key]);
}

export function FontPairCard({ title, titleMuted, options, value, status, errorText, onAnswer }: Props) {
  const [picked, setPicked] = useState(value);
  useGoogleFonts(options.flatMap((o) => [o.display, o.body]));
  return (
    <Shell name="FontPairCard" writesTo={WRITES_TO.FontPairCard} status={status} errorText={errorText} skeleton={<Skeleton block={120} lines={1} />}>
      <Question title={title} muted={titleMuted} />
      <div className="c-fonts" role="radiogroup" aria-label={title} data-count={options.length}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={picked === o.id}
            className="c-font"
            disabled={!onAnswer}
            onClick={() => {
              setPicked(o.id);
              onAnswer?.({ optionId: o.id });
            }}
          >
            <span className="c-font-aa" style={{ fontFamily: `"${o.display}", Georgia, serif` }}>
              Aa
            </span>
            {o.sample && (
              <span className="c-font-sample" style={{ fontFamily: `"${o.display}", Georgia, serif` }}>
                {o.sample}
              </span>
            )}
            <span style={{ fontFamily: `"${o.body}", system-ui, sans-serif`, fontSize: 13 }}>
              {o.display} + {o.body}
            </span>
            {o.note && <span className="c-mono-dim">{o.note}</span>}
          </button>
        ))}
      </div>
    </Shell>
  );
}
