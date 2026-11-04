"use client";

// Every catalog component with example props, switchable between its states, plus the answer
// each one sends back. Answers go nowhere here: this page makes no API calls.
import { useState } from "react";
import { SAMPLE_CALLS } from "../../core/catalog-samples.ts";
import { RenderCall } from "../ui/render.tsx";
import { ToastProvider, useToast, type Status } from "../ui/primitives.tsx";

const STATES: { id: Status; label: string }[] = [
  { id: "ready", label: "Default" },
  { id: "loading", label: "Loading" },
  { id: "error", label: "Error" },
];

export default function Showcase() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  );
}

function Inner() {
  const [status, setStatus] = useState<Status>("ready");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const toast = useToast();

  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Component state">
        {STATES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={status === s.id} onClick={() => setStatus(s.id)}>
            {s.label}
          </button>
        ))}
        <span className="muted small">Selected is whatever you tap.</span>
      </div>
      <div className="showcase">
        {SAMPLE_CALLS.map((call, i) => (
          <div key={`${i}-${status}`} className="showcase-item">
            <RenderCall
              call={call}
              status={status}
              errorText="That didn't save. Tap your answer again to retry."
              onAnswer={(component, answer) => {
                setAnswers((a) => ({ ...a, [i]: JSON.stringify(answer) }));
                const before = answers[i];
                toast(`Saved to ${savedTo(component, call)}`, () =>
                  setAnswers((a) => {
                    const next = { ...a };
                    if (before === undefined) delete next[i];
                    else next[i] = before;
                    return next;
                  }),
                );
              }}
            />
            {answers[i] && (
              <p className="answer">
                <span>sends</span> {answers[i]}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function savedTo(component: string, call: (typeof SAMPLE_CALLS)[number]) {
  if (call.component === "SourceCard") return call.props.chunk;
  if (component === "BriefForm") return "the post brief";
  if (component === "ChoiceChips") return "audience";
  return { SwatchPicker: "visual-system", FontPairCard: "visual-system", ToneSlider: "voice-core", LineCompare: "voice-examples", PhotoPicker: "art-direction" }[component] ?? "the kit";
}
