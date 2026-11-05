"use client";

// Native-app-style page changes. Each page sits in this wrapper, and every page change slides:
// going deeper (a demo card, Build a kit) pushes the new page in from the right; going back (the
// Specs mark, the browser's back button) pops it the other way. The direction is set on <html>
// just before the change (see NavDirection), and motion.css reads it. The top bar stays put.
// Built on React's <ViewTransition>; browsers without the View Transitions API swap instantly.
import { ViewTransition, useEffect } from "react";

export function PageMotion({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page" exit="page" default="none">
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

const depth = (path: string) => path.split("/").filter(Boolean).length;

/** Marks each page change as forward or back, from where the link goes or the browser's back button. */
export function NavDirection() {
  useEffect(() => {
    const root = document.documentElement;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.origin !== location.origin) return;
      const back = a.dataset.nav === "back" || depth(a.pathname) < depth(location.pathname);
      root.dataset.nav = back ? "back" : "forward";
    };
    const onPop = () => (root.dataset.nav = "back");
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  return null;
}
