"use client";

// Light / dark switch. With no choice saved, the page follows the system setting (CSS
// prefers-color-scheme). A choice is saved per browser and applied before paint by THEME_SCRIPT.
import { useEffect, useState } from "react";

const KEY = "specs.theme";
type Choice = "light" | "dark" | "system";

/** Runs in <head> before the page paints, so a saved choice never flashes the wrong theme. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function systemIsDark() {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    if (saved === "light" || saved === "dark") setChoice(saved);
    setSystemDark(systemIsDark());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const dark = choice === "dark" || (choice === "system" && systemDark);

  function flip() {
    // Flipping back to what the system already shows clears the choice, so the page follows the system again.
    const next: Choice = dark ? (systemDark ? "light" : "system") : systemDark ? "system" : "dark";
    setChoice(next);
    const root = document.documentElement;
    try {
      if (next === "system") {
        delete root.dataset.theme;
        localStorage.removeItem(KEY);
      } else {
        root.dataset.theme = next;
        localStorage.setItem(KEY, next);
      }
    } catch {}
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={flip}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={choice === "system" ? "Following your system setting" : `${choice} mode`}
    >
      <span className="theme-toggle-knob" data-dark={dark} />
    </button>
  );
}
