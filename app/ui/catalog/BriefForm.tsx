"use client";

// The few fields a post intent needs, with live character counts against each field's limit.
import { useState } from "react";
import { WRITES_TO, type AnswerOf, type PropsOf } from "../../../core/catalog.ts";
import { Question, Shell, Skeleton, type CommonProps } from "../primitives.tsx";

type Props = PropsOf<"BriefForm"> & CommonProps<AnswerOf<"BriefForm">> & { value?: Record<string, string> };

export function BriefForm({ title, titleMuted, intent, fields, value = {}, status, errorText, onAnswer }: Props) {
  const [values, setValues] = useState<Record<string, string>>(value);
  const missing = fields.some((f) => f.required && !values[f.id]?.trim());
  const over = fields.some((f) => (values[f.id]?.length ?? 0) > f.maxChars);
  return (
    <Shell name="BriefForm" writesTo={WRITES_TO.BriefForm} status={status} errorText={errorText} skeleton={<Skeleton lines={4} />}>
      <div className="c-row-between">
        <Question title={title} muted={titleMuted} />
        <span className="c-tag">{intent}</span>
      </div>
      <form
        className="c-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing && !over) onAnswer?.({ values });
        }}
      >
        {fields.map((f) => {
          const id = `brief-${f.id}`;
          const len = values[f.id]?.length ?? 0;
          const common = {
            id,
            value: values[f.id] ?? "",
            placeholder: f.placeholder,
            required: f.required,
            disabled: !onAnswer,
            "aria-invalid": len > f.maxChars,
            onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f.id]: e.target.value })),
          };
          return (
            <div key={f.id} className="c-field">
              <label htmlFor={id}>
                {f.label}
                {!f.required && <span className="c-mono-dim"> optional</span>}
              </label>
              {f.kind === "textarea" ? <textarea rows={3} {...common} /> : <input type={f.kind === "date" ? "date" : "text"} {...common} />}
              {f.kind !== "date" && (
                <span className="c-count" data-over={len > f.maxChars}>
                  {len}/{f.maxChars}
                </span>
              )}
            </div>
          );
        })}
        {onAnswer && (
          <div>
            <button type="submit" className="c-btn" disabled={missing || over}>
              Make posts
            </button>
          </div>
        )}
      </form>
    </Shell>
  );
}
