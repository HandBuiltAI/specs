"use client";

// Renders one A2UI component call from the intake agent. The call is validated against the
// catalog schemas first; anything not in the catalog, or with bad props, shows an error card
// instead of rendering. Phase 5's intake conversation goes through this one function.
import { parseCall, type AnswerOf, type ComponentName } from "../../core/catalog.ts";
import * as C from "./catalog/index.ts";
import type { Status } from "./primitives.tsx";

export type AnswerHandler = <N extends ComponentName>(component: N, answer: AnswerOf<N>) => void;

export function RenderCall({ call, onAnswer, status, errorText }: { call: unknown; onAnswer?: AnswerHandler; status?: Status; errorText?: string }) {
  const parsed = parseCall(call);
  if (!parsed.ok) {
    return (
      <section className="c-card" data-status="error">
        <header className="c-head">
          <span className="c-name">Not in the catalog</span>
        </header>
        <p className="c-error" role="alert">
          <b aria-hidden="true">!</b>
          <span>This step couldn&rsquo;t be shown. {parsed.error}</span>
        </p>
      </section>
    );
  }
  const s = { status, errorText };
  const c = parsed.call;
  const on = <N extends ComponentName>(n: N) => (onAnswer ? (a: AnswerOf<N>) => onAnswer(n, a) : undefined);
  switch (c.component) {
    case "SwatchPicker":
      return <C.SwatchPicker {...c.props} {...s} onAnswer={on("SwatchPicker")} />;
    case "FontPairCard":
      return <C.FontPairCard {...c.props} {...s} onAnswer={on("FontPairCard")} />;
    case "ToneSlider":
      return <C.ToneSlider {...c.props} {...s} onAnswer={on("ToneSlider")} />;
    case "ChoiceChips":
      return <C.ChoiceChips {...c.props} {...s} onAnswer={on("ChoiceChips")} />;
    case "LineCompare":
      return <C.LineCompare {...c.props} {...s} onAnswer={on("LineCompare")} />;
    case "PhotoPicker":
      return <C.PhotoPicker {...c.props} {...s} onAnswer={on("PhotoPicker")} />;
    case "SourceCard":
      return <C.SourceCard {...c.props} {...s} onAnswer={on("SourceCard")} />;
    case "BriefForm":
      return <C.BriefForm {...c.props} {...s} onAnswer={on("BriefForm")} />;
    case "PostPreview":
      return <C.PostPreview {...c.props} {...s} />;
    case "KitProgress":
      return <C.KitProgress {...c.props} {...s} />;
  }
}
