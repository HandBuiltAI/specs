"use client";

// A line that says Specs is working, in the voice of a design studio mid-job. It starts with
// what's actually happening ("Writing the copy…") and then drifts through studio asides, so a
// long wait reads as busy hands, not a frozen screen. The words shimmer; reduced motion keeps
// them still and stops the cycling.
import { useEffect, useState } from "react";

const ASIDES = {
  reading: ["Squinting at your photos…", "Reading the fine print…", "Holding swatches up to the light…", "Boot-scooting through the PDF…", "Taking notes in the margins…", "Zooming in on the signage…"],
  drafting: ["Pinning things to the board…", "Mixing the paint…", "Arguing about fonts…", "Writing it all down…", "Sorting the good stuff…", "Boot-scooting…"],
  asking: ["Picking the question that matters…", "Laying out the options…", "Sharpening the pencils…"],
  making: ["Kerning…", "Measuring the margins…", "Cropping with intent…", "Asking the logo nicely…", "Nudging things two pixels left…", "Squinting from across the room…"],
  chat: ["Thinking it over…", "Flipping through your kit…", "Checking the swatches…"],
} as const;

export type WorkingKind = keyof typeof ASIDES;

export function Working({ kind, lead, className }: { kind: WorkingKind; lead?: string | null; className?: string }) {
  const asides = ASIDES[kind];
  const [i, setI] = useState(0);

  // A new lead (the next real step) shows at once.
  useEffect(() => setI(0), [lead]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => n + 1), 2600);
    return () => clearInterval(t);
  }, [lead, kind]);

  // The real step stays up longest: every other beat goes back to it.
  const text = lead ? (i % 2 === 0 ? lead : asides[Math.floor(i / 2) % asides.length]!) : asides[i % asides.length]!;
  return (
    <p className={`working ${className ?? ""}`} role="status" aria-live="polite">
      <span className="working-dot" aria-hidden="true" />
      <span key={text} className="working-text">
        {text}
      </span>
    </p>
  );
}
