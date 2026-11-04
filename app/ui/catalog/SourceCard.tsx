"use client";

// One fact with its receipts. Confirm it, or edit it in place. A conflict shows both sides.
import { useState } from "react";
import type { AnswerOf, PropsOf } from "../../../core/catalog.ts";
import { Shell, Skeleton, Sources, type CommonProps } from "../primitives.tsx";

type Props = PropsOf<"SourceCard"> & CommonProps<AnswerOf<"SourceCard">> & { confirmLabel?: string };

export function SourceCard({ chunk, label, fact, sources, conflict, confirmLabel, status, errorText, onAnswer }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact);
  const [shown, setShown] = useState(fact);
  return (
    <Shell name="SourceCard" writesTo={chunk} status={status} errorText={errorText} skeleton={<Skeleton block={40} lines={3} />}>
      <span className="c-mono-dim">{label}</span>
      {editing ? (
        <div className="c-edit">
          <textarea value={draft} maxLength={160} rows={2} aria-label={label} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <span className="c-mono-dim">{draft.length}/160</span>
        </div>
      ) : (
        <p className="c-fact">{shown}</p>
      )}
      {conflict && !editing && (
        <div className="c-conflict">
          <span className="c-flag">Conflict</span>
          <span>{conflict.text}</span>
          <Sources sources={conflict.sources} />
        </div>
      )}
      <Sources sources={sources} />
      {onAnswer && (
        <div className="c-row">
          {editing ? (
            <>
              <button
                type="button"
                className="c-btn"
                disabled={!draft.trim()}
                onClick={() => {
                  setShown(draft.trim());
                  setEditing(false);
                  onAnswer({ action: "edit", value: draft.trim() });
                }}
              >
                Save
              </button>
              <button type="button" className="c-btn ghost" onClick={() => (setDraft(shown), setEditing(false))}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" className="c-btn" onClick={() => onAnswer({ action: "confirm" })}>
                {confirmLabel ?? "That's right"}
              </button>
              <button type="button" className="c-btn ghost" onClick={() => setEditing(true)}>
                Edit
              </button>
            </>
          )}
        </div>
      )}
    </Shell>
  );
}
