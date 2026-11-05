"use client";

// A radio-tuner ruler with a red needle. The sample line above it changes as the needle moves,
// so the person hears the voice rather than reading an adjective.
import { useState } from "react";
import { WRITES_TO, sizePercent, type AnswerOf, type PropsOf } from "../../../core/catalog.ts";
import { Question, Shell, Skeleton, type CommonProps } from "../primitives.tsx";

type Props = PropsOf<"ToneSlider"> & CommonProps<AnswerOf<"ToneSlider">>;

export function ToneSlider({ title, titleMuted, left, right, middle, value, size, status, errorText, onAnswer }: Props) {
  const [v, setV] = useState(value);
  // A size slider reads out the size itself; a tone slider plays the closest sample line.
  const line = size ? `${sizePercent(v)}% of the standard size` : middle ? (v < 34 ? left.sample : v > 66 ? right.sample : middle) : v < 50 ? left.sample : right.sample;
  return (
    <Shell name="ToneSlider" writesTo={size ? "visual-system" : WRITES_TO.ToneSlider} status={status} errorText={errorText} skeleton={<Skeleton block={60} lines={2} />}>
      <Question title={title} muted={titleMuted} />
      <p className="c-sample" data-size={size || undefined} aria-live="polite">
        {line}
      </p>
      <div className="c-tuner">
        <div className="c-ticks" aria-hidden="true" />
        <div className="c-needle" style={{ left: `${v}%` }} aria-hidden="true" />
        <input
          type="range"
          min={0}
          max={100}
          value={v}
          disabled={!onAnswer}
          aria-label={`${left.label} to ${right.label}`}
          aria-valuetext={line}
          onChange={(e) => setV(Number(e.target.value))}
          onPointerUp={() => onAnswer?.({ value: v })}
          onKeyUp={(e) => (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") && onAnswer?.({ value: v })}
        />
      </div>
      <div className="c-tuner-ends">
        <span>{left.label}</span>
        <span>{right.label}</span>
      </div>
    </Shell>
  );
}
