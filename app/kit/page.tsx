import type { Metadata } from "next";
import Link from "next/link";
import YAML from "yaml";
import { CONTENT } from "../../server/generated/content.ts";
import { KitDownload } from "../ui/KitDownload.tsx";
import { PageMotion } from "../ui/page-motion.tsx";

// Specs' own brand kit, in the same format it makes for other brands (spec: "the app ships with
// its own brand kit ... so the method is visible in the tool itself"). Static, no API calls.

export const metadata: Metadata = { title: "Specs' own brand kit · Specs" };

type Meta = { id: string; domain: string; summary: string; confidence: string; sources: { upload: string; location?: string }[] };

function metaOf(file: string, text: string): Meta | null {
  if (file.startsWith("_") || file === "tokens.css") return null;
  let m: Record<string, unknown> | undefined;
  if (file.endsWith(".json")) m = (JSON.parse(text) as { meta?: Record<string, unknown> }).meta;
  else {
    const front = text.startsWith("---") ? text.split(/^---\s*$/m)[1] : text.split(/^---\s*$/m)[0];
    m = YAML.parse(front ?? "") as Record<string, unknown>;
  }
  if (!m) return null;
  return {
    id: String(m.chunk_id ?? file),
    domain: String(m.domain ?? ""),
    summary: String(m.summary ?? "").trim(),
    confidence: String(m.confidence ?? "unknown"),
    sources: (Array.isArray(m.sources) ? m.sources : []) as Meta["sources"],
  };
}

type Color = { hex: string; name: string; role: string };

export default function SpecsKitPage() {
  const files = CONTENT.specsKit;
  const order = ["readme.md", "positioning-core.yaml", "brand-about.md", "audience-designers.yaml", "voice-core.md", "voice-examples.md", "terminology.yaml", "visual-system.json", "art-direction.md", "social-rules.md", "guardrails.yaml"];
  const chunks = Object.keys(files)
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map((f) => ({ file: f, meta: metaOf(f, files[f] ?? "") }))
    .filter((c): c is { file: string; meta: Meta } => c.meta !== null);
  const colors = Object.values((JSON.parse(files["visual-system.json"] ?? "{}") as { color?: Record<string, Color> }).color ?? {});

  return (
    <PageMotion>
    <main className="wide kitpage">
      <p className="eyebrow">Specs · brand kit v1</p>
      <h1>
        Specs&rsquo; own brand kit. <span>Same format it makes for you.</span>
      </h1>
      <p className="muted kitpage-lede">
        Every brand Specs reads ends up as a folder of small files like these, each one idea, each with its sources. This is
        Specs describing itself the same way. Unlike the <Link href="/">demo brands</Link>, it&rsquo;s real.
      </p>

      <section className="card kitpage-head">
        <div>
          <p className="eyebrow">Quiet room. Loud brand.</p>
          <div className="kitpage-colors">
            {colors.map((c) => (
              <div key={c.hex} className="kitpage-color">
                <span className="kitpage-chip" style={{ background: c.hex }} />
                <span className="small">{c.name}</span>
                <span className="mono small muted">{c.hex}</span>
              </div>
            ))}
          </div>
        </div>
        <KitDownload slug="specs" name="Specs" files={files} />
      </section>

      <div className="kitpage-grid">
        {chunks.map(({ file, meta }) => (
          <article key={file} className="card kitpage-chunk">
            <header className="chunk-head">
              <h3 className="mono">{meta.id}</h3>
              <span className={`confidence ${meta.confidence}`}>{meta.confidence}</span>
            </header>
            {meta.domain && <p className="eyebrow">{meta.domain}</p>}
            <p>{meta.summary}</p>
            <div className="sources">
              {meta.sources.map((s, i) => (
                <span key={i} className="source" title={s.location}>
                  {s.upload}
                </span>
              ))}
            </div>
            <details className="kitpage-file">
              <summary className="mono small">{file}</summary>
              <pre>{files[file]}</pre>
            </details>
          </article>
        ))}
      </div>
      <p className="muted small">
        Also in the zip: <code>_retrieval-rules.yaml</code>, which says which files to load for each job, and <code>tokens.css</code>,
        generated from the visual system.
      </p>
    </main>
    </PageMotion>
  );
}
