"use client";

// A short closed question. Single choice answers on tap; multiple choice gets a Done button.
import { useState } from "react";
import type { AnswerOf, PropsOf } from "../../../core/catalog.ts";
import { Question, Shell, Skeleton, type CommonProps } from "../primitives.tsx";

type Props = PropsOf<"ChoiceChips"> & CommonProps<AnswerOf<"ChoiceChips">> & { value?: string[]; writesTo?: string };

export function ChoiceChips({ title, titleMuted, options, multiple, value = [], writesTo, status, errorText, onAnswer }: Props) {
  const [picked, setPicked] = useState<string[]>(value);
  const toggle = (id: string) => {
    if (!multiple) {
      setPicked([id]);
      onAnswer?.({ optionIds: [id] });
      return;
    }
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  return (
    <Shell name="ChoiceChips" writesTo={writesTo} status={status} errorText={errorText} skeleton={<Skeleton lines={2} />}>
      <Question title={title} muted={titleMuted} />
      <div className="c-chips" role={multiple ? "group" : "radiogroup"} aria-label={title}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role={multiple ? "checkbox" : "radio"}
            aria-checked={picked.includes(o.id)}
            className="c-chip"
            data-error={status === "error" && picked.includes(o.id)}
            disabled={!onAnswer}
            onClick={() => toggle(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {multiple && onAnswer && (
        <div>
          <button type="button" className="c-btn" disabled={!picked.length} onClick={() => onAnswer({ optionIds: picked })}>
            Done
          </button>
        </div>
      )}
    </Shell>
  );
}
