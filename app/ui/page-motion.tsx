// Native-app-style page changes. Each page sits in this wrapper: a link tagged "nav-forward"
// slides the old page out left and the new one in from the right, "nav-back" the other way,
// and the top bar stays put. Untagged changes (the browser's back button, a refresh) just swap.
// Built on React's <ViewTransition>; browsers without the View Transitions API swap instantly.
import { ViewTransition } from "react";

const DIRECTIONS = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" } as const;

export function PageMotion({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={DIRECTIONS} exit={DIRECTIONS} default="none">
      {children}
    </ViewTransition>
  );
}

/** One thing that persists across a page change (a brand's name, its card), morphing from one spot to the other. */
export function Shared({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}
