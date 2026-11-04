"use client";

// Which of two sample lines sounds more like the brand. "Neither" is always allowed.
import { useState } from "react";
import { WRITES_TO, type AnswerOf, type PropsOf } from "../../../core/catalog.ts";
import { Question, Shell, Skeleton, Sources, type CommonProps } from "../primitives.tsx";

type Props = PropsOf<"LineCompare"> & CommonProps<AnswerOf<"LineCompare">> & { value?: "a" | "b" | "neither" };

export function LineCompare({ title, titleMuted, a, b, value, status, errorText, onAnswer }: Props) {
  const [picked, setPicked] = useState(value);
  const pick = (p: "a" | "b" | "neither") => {
    setPicked(p);
    onAnswer?.({ pick: p });
  };
  return (
    <Shell name="LineCompare" writesTo={WRITES_TO.LineCompare} status={status} errorText={errorText} skeleton={<Skeleton block={56} lines={2} />}>
      <Question title={title} muted={titleMuted} />
      <div className="c-lines" role="radiogroup" aria-label={title}>
        {(["a", "b"] as const).map((k) => {
          const line = k === "a" ? a : b;
          return (
            <button key={k} type="button" role="radio" aria-checked={picked === k} className="c-line" disabled={!onAnswer} onClick={() => pick(k)}>
              <span className="c-line-k">{k.toUpperCase()}</span>
              <span>{line.text}</span>
            </button>
          );
        })}
      </div>
      <div className="c-row-between">
        <Sources sources={[a.source, b.source].filter((s) => !!s)} />
        {onAnswer && (
          <button type="button" className="c-link" aria-pressed={picked === "neither"} onClick={() => pick("neither")}>
            Neither sounds like us
          </button>
        )}
      </div>
    </Shell>
  );
}
