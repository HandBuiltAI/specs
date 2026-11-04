"use client";

// Shared pieces for the catalog components: the card shell, the two-tone question, source chips,
// skeleton lines and the toast. Plain React, no CopilotKit, so a later switch of A2UI renderer is cheap.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SourceRef } from "../../core/catalog.ts";

/** Every catalog component has these four designed states (spec): default, loading, selected
 *  (driven by the component's own value) and error. */
export type Status = "ready" | "loading" | "error";
export type CommonProps<A> = {
  status?: Status;
  /** Plain words for what went wrong and how to fix it. */
  errorText?: string;
  /** Called when the person answers. Omit to make the component read-only. */
  onAnswer?: (answer: A) => void;
};

export function Shell(props: {
  name: string;
  writesTo?: string | null;
  status?: Status;
  errorText?: string;
  className?: string;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  const { name, writesTo, status = "ready", errorText, className = "", skeleton, children } = props;
  return (
    <section className={`c-card ${className}`} data-status={status} aria-busy={status === "loading"}>
      <header className="c-head">
        <span className="c-name">{name}</span>
        {writesTo && <span className="c-writes">→ {writesTo}</span>}
      </header>
      {status === "loading" ? (skeleton ?? <Skeleton lines={3} />) : children}
      {status === "error" && (
        <p className="c-error" role="alert">
          <b aria-hidden="true">!</b>
          <span>{errorText ?? "That didn't save. Try again."}</span>
        </p>
      )}
    </section>
  );
}

export function Question({ title, muted }: { title: string; muted?: string }) {
  return (
    <h3 className="c-q">
      {title}
      {muted && <span> {muted}</span>}
    </h3>
  );
}

export function Sources({ sources }: { sources: SourceRef[] }) {
  if (!sources.length) return null;
  return (
    <div className="c-sources">
      {sources.map((s, i) => (
        <span key={i}>
          {s.upload}
          {s.location ? ` · ${s.location}` : ""}
        </span>
      ))}
    </div>
  );
}

export function Skeleton({ lines = 3, block }: { lines?: number; block?: number }) {
  return (
    <div className="c-skel-wrap" aria-label="Loading">
      {block && <div className="c-skel" style={{ height: block, borderRadius: 16 }} />}
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="c-skel" style={{ width: `${[82, 64, 48, 70][i % 4]}%` }} />
      ))}
    </div>
  );
}

/* Toast: one at a time, bottom center, black pill with an optional Undo. */
type ToastMsg = { text: string; undo?: () => void; key: number };
const ToastContext = createContext<(text: string, undo?: () => void) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((text: string, undo?: () => void) => {
    setMsg({ text, undo, key: Date.now() });
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 3600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="c-toast" data-on={shown} role="status" aria-live="polite">
        <span>{msg?.text}</span>
        {msg?.undo && (
          <button type="button" onClick={() => (msg.undo?.(), setShown(false))}>
            Undo
          </button>
        )}
        <button type="button" className="c-toast-x" aria-label="Dismiss" onClick={() => setShown(false)}>
          ✕
        </button>
      </div>
    </ToastContext.Provider>
  );
}
