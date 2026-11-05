"use client";

// The Brand DNA reveal as a mood board: the brand at a glance (palette, type, voice, facts,
// what it never says), each card filling in as its chunk lands. The full item list with every
// source sits one tap down. Built from the drafted chunks in the browser, so it costs nothing.
import { boardFrom } from "../../core/preview.ts";
import { googleFontsHref } from "../../core/session-kit.ts";
import type { IntakeChunks } from "../../core/intake.ts";
import { Skeleton } from "../ui/primitives.tsx";

type Waiting = { status?: "running" | "done" | "failed" };

export function BrandBoard({ chunks, targets }: { chunks: IntakeChunks; targets: Record<string, Waiting | undefined> }) {
  const b = boardFrom(chunks);
  const pending = (id: string) => targets[id]?.status === "running" || !targets[id];
  const card = (cls: string, label: string, ready: boolean, waitingOn: string, body: React.ReactNode, src?: string) => (
    <div className={`card board-card ${cls} ${ready ? "in" : ""}`}>
      <p className="eyebrow">{label}</p>
      {ready ? body : pending(waitingOn) ? <Skeleton lines={3} /> : <p className="muted small">Nothing in your uploads covered this yet.</p>}
      {ready && src && <span className="source">{src}</span>}
    </div>
  );
  return (
    <div className="board">
      {b.fonts && <link rel="stylesheet" href={googleFontsHref([b.fonts.heading, b.fonts.body])} />}
      {card(
        "board-palette",
        "Palette",
        !!b.palette?.length,
        "visual-system",
        <div className="fan" aria-label="Palette">
          {b.palette?.map((c, i) => (
            <div key={c.hex} className="fan-chip" style={{ background: c.hex, color: lum(c.hex) > 0.5 ? "#111" : "#fff", left: `${i * 26}%`, transform: `rotate(${(i - (b.palette!.length - 1) / 2) * 6}deg)` }}>
              <b>{c.role}</b>
              {c.hex}
            </div>
          ))}
        </div>,
      )}
      {card(
        "board-type",
        "Type",
        !!b.fonts,
        "visual-system",
        b.fonts && (
          <>
            <div className="typeset" style={{ background: b.palette?.[0]?.hex, color: b.palette?.[1]?.hex }}>
              <div style={{ fontFamily: `"${b.fonts.heading}", serif`, fontSize: 36, lineHeight: 1.05 }}>{b.name ?? "Your brand"}</div>
              <div style={{ fontFamily: `"${b.fonts.body}", sans-serif`, fontSize: 14, marginTop: 8 }}>{b.voice?.line ?? "Body text set in your body font."}</div>
            </div>
            <span className="source">
              {b.fonts.heading} · {b.fonts.body}
              {b.fonts.standIn ? " · closest free match" : ""}
            </span>
          </>
        ),
      )}
      {card(
        "board-voice",
        "Voice",
        !!(b.voice?.tone || b.voice?.line),
        "voice-core",
        <>
          {b.voice?.line && <p className="voice-line">&ldquo;{b.voice.line}&rdquo;</p>}
          {b.voice?.tone && <p className="small">{b.voice.tone}</p>}
        </>,
      )}
      {card(
        "board-facts",
        "Facts posts can use",
        !!b.facts?.length,
        "positioning-core",
        <ul className="facts">
          {b.facts?.map((f) => (
            <li key={f.label + f.value}>
              <span>
                <span className="muted small">{f.label}</span>
                <br />
                {f.value}
              </span>
              <span className="mono small muted">{f.source}</span>
            </li>
          ))}
        </ul>,
      )}
      {card(
        "board-never",
        "Never say",
        !!b.never?.length,
        "guardrails",
        <div className="never">
          {b.never?.map((n) => (
            <s key={n}>{n}</s>
          ))}
        </div>,
      )}
    </div>
  );
}

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
