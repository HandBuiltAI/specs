"use client";

// The Cloudflare Turnstile widget, rendered once into a div. Calls back with a token.
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string };
  }
}

export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey) return;
    const render = () => {
      if (box.current && window.turnstile && !box.current.hasChildNodes()) {
        window.turnstile.render(box.current, { sitekey: siteKey, callback: onToken, "expired-callback": () => onToken(null) });
      }
    };
    if (window.turnstile) return render();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [siteKey, onToken]);
  if (!siteKey) return <p className="error">The bot check isn&rsquo;t set up on this server (no site key).</p>;
  return <div ref={box} />;
}
