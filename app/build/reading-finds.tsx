"use client";

// While the uploads are read and the kit is drafted: each file sits on a light table and gets
// scanned, and what Specs finds in it (a color, a line in the brand's own words, a fact) drops
// onto the table as a card the moment it is found. It turns the wait into the first look at the brand.
import { useMemo } from "react";
import type { Evidence } from "../../core/extract.ts";
import type { Swatch } from "../../core/colors.ts";

type Upload = { id: string; kind: string; label: string; colors?: Swatch[] };
type CallState = { status: "running" | "done" | "failed"; attempts: number };
type Find =
  | { key: string; kind: "color"; hex: string; from: string }
  | { key: string; kind: "line"; text: string; from: string }
  | { key: string; kind: "fact"; text: string; topic: string; from: string };

const GLYPH: Record<string, string> = { pdf: "PDF", url: "WWW", pasted: "TXT", note: "NOTE" };
const FACT_TOPICS = ["offer", "business", "visual", "audience", "photo"];
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The finds for one upload, best first: its loudest colors, its own words, then its facts. */
function findsOf(u: Upload, ev: Evidence | undefined): Find[] {
  const out: Find[] = [];
  for (const c of (u.colors ?? []).filter((c) => c.share >= 0.04).slice(0, 3)) out.push({ key: `${u.id}:c:${c.hex}`, kind: "color", hex: c.hex, from: u.label });
  if (!ev) return out;
  for (const [i, l] of ev.lines.slice(0, 2).entries()) out.push({ key: `${u.id}:l:${i}`, kind: "line", text: short(l.line, 90), from: u.label });
  const facts = [...ev.facts].sort((a, b) => rank(a.topic) - rank(b.topic)).slice(0, 2);
  for (const [i, f] of facts.entries()) out.push({ key: `${u.id}:f:${i}`, kind: "fact", text: short(f.quote || f.statement, 80), topic: f.topic, from: u.label });
  return out;
}
const rank = (t: string) => (FACT_TOPICS.includes(t) ? FACT_TOPICS.indexOf(t) : 9);

export function ReadingFinds(props: {
  uploads: Upload[];
  reads: Record<string, CallState>;
  evidence: Record<string, Evidence>;
  thumbs: Record<string, string>;
  drafting: number;
  draftTotal: number;
}) {
  const { uploads, reads, evidence, thumbs, drafting, draftTotal } = props;
  // Interleave uploads so the table fills from every file, not one file at a time.
  const finds = useMemo(() => {
    const per = uploads.map((u) => findsOf(u, evidence[u.id]));
    const out: Find[] = [];
    for (let i = 0; per.some((p) => p[i]); i++) for (const p of per) if (p[i]) out.push(p[i]!);
    // A color two files share is one find, not two.
    const seen = new Set<string>();
    return out.filter((f) => f.kind !== "color" || (!seen.has(f.hex.toLowerCase()) && !!seen.add(f.hex.toLowerCase()))).slice(0, 12);
  }, [uploads, evidence]);
  const read = uploads.filter((u) => reads[u.id]?.status === "done").length;
  const stage = read < uploads.length ? `Reading ${read + 1 > uploads.length ? uploads.length : read + 1} of ${uploads.length}` : drafting < draftTotal ? `Writing the kit · ${drafting} of ${draftTotal}` : "Almost there";

  return (
    <section className="finds card" aria-live="polite" aria-label="What Specs is finding">
      <div className="finds-head">
        <p className="eyebrow">What we&rsquo;re finding</p>
        <span className="finds-stage mono">{stage}</span>
      </div>
      <ul className="finds-files">
        {uploads.map((u, i) => {
          const s = reads[u.id]?.status ?? "waiting";
          return (
            <li key={u.id} className="finds-file" data-status={s} style={{ ["--i" as string]: i }} title={u.label}>
              {thumbs[u.id] ? <img src={thumbs[u.id]} alt="" /> : <span className="finds-glyph mono">{GLYPH[u.kind] ?? "FILE"}</span>}
              <span className="finds-scan" aria-hidden="true" />
              <span className="finds-check" aria-hidden="true">✓</span>
            </li>
          );
        })}
      </ul>
      <ul className="finds-table">
        {finds.map((f, i) => (
          <li key={f.key} className={`find find-${f.kind}`} style={{ ["--tilt" as string]: `${(((i * 37) % 7) - 3) / 2}deg` }}>
            {f.kind === "color" && (
              <>
                <span className="find-chip" style={{ background: f.hex }} />
                <span className="mono">{f.hex.toUpperCase()}</span>
              </>
            )}
            {f.kind === "line" && <q>{f.text}</q>}
            {f.kind === "fact" && (
              <>
                <span className="find-topic mono">{f.topic}</span>
                <span>{f.text}</span>
              </>
            )}
            <span className="find-from mono">{short(f.from, 28)}</span>
          </li>
        ))}
        {finds.length === 0 && <li className="find find-empty muted">The first finds land here in a few seconds.</li>}
      </ul>
    </section>
  );
}
