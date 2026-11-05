import Link from "next/link";
import { CONTENT, DEMO_BRAND_IDS, type DemoBrandId } from "../server/generated/content.ts";
import { tokenValues } from "../core/kit.ts";

// The start screen: pick a precomputed demo brand (free, instant) or build a kit from your own
// materials. Each demo card is set in that brand's own colors and type, read from its tokens.css.

const STYLE: Record<DemoBrandId, string> = {
  "half-acre-club": "Warm and handmade",
  "third-shift-slice": "Bold and loud",
  "hollis-ware": "Minimal and premium",
};

const COLOR_ORDER = /^--color-/;

function DemoCard({ id }: { id: DemoBrandId }) {
  const b = CONTENT.brands[id];
  const t = tokenValues(b.kit["tokens.css"] ?? "");
  const colors = Object.entries(t).filter(([k]) => COLOR_ORDER.test(k)).map(([, v]) => v);
  const photo = b.photos[0];
  const count = b.demoPosts?.posts.length ?? 0;
  const [line1, ...rest] = b.wordmark;
  const plate = {
    "--plate-bg": t["--role-background"],
    "--plate-ink": t["--role-wordmark"],
    "--plate-font": t["--font-wordmark"],
    "--plate-weight": t["--weight-wordmark"],
    "--plate-tracking": t["--tracking-wordmark"],
    "--plate-line2-tracking": t["--wordmark-line2-tracking"] ?? "0.2em",
    "--plate-line2-scale": t["--wordmark-line2-scale"] ?? "0.5",
  } as React.CSSProperties;

  return (
    <Link href={`/posts/${id}`} className="demo-card card">
      <div className="demo-plate" style={plate}>
        {photo && <img src={`/generated/${id}/${photo.file}`} alt="" loading="lazy" />}
        {b.logo ? (
          <div className="demo-logo">
            <img src={b.logo} alt="" />
          </div>
        ) : (
          <p className="demo-wordmark" aria-hidden="true">
            <span>{line1}</span>
            {rest.length > 0 && <span className="demo-wordmark-2">{rest.join(" ")}</span>}
          </p>
        )}
      </div>
      <div className="demo-body">
        <p className="eyebrow">{STYLE[id]}</p>
        <h3>{b.businessName}</h3>
        <p className="muted small">{b.businessLine}</p>
        <div className="demo-foot">
          <span className="swatches" aria-label="Brand colors">
            {colors.map((c) => (
              <span key={c} className="swatch" style={{ background: c }} title={c} />
            ))}
          </span>
          <span className="mono small muted">{count > 0 ? `${count} posts →` : "Kit ready, posts soon →"}</span>
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  return (
    <main className="wide start">
      {/* Brand fonts for the demo cards; post pages load the same file. */}
      <link rel="stylesheet" href="/generated/fonts/fonts.css" precedence="default" />
      <h1>
        Your brand, <span>written down for machines.</span>
      </h1>
      <p className="start-lede">
        Hand Specs the messy stuff: a logo, a website, a rough PDF, phone photos. It writes your brand down as a kit an AI can
        read, then art-directs Instagram posts that explain their own design decisions.
      </p>
      <p className="muted start-lede-2">
        The kit is yours to keep. Download it, give it to the coding agent of your choice, and whatever it builds starts on
        brand.
      </p>

      <h2>
        Pick a demo brand <span>to see finished posts.</span>
      </h2>
      <p className="muted small">
        Each post shows why it works, and the same brief made with no kit. Free and instant: these were made ahead of time. The
        three brands are fictional.
      </p>
      <div className="demo-grid">
        {DEMO_BRAND_IDS.map((id) => (
          <DemoCard key={id} id={id} />
        ))}
      </div>

      <h2>
        Or start with yours.
      </h2>
      <Link href="/build" className="card start-own">
        <div>
          <h3>Build a brand kit from your own materials</h3>
          <p className="muted small">
            Upload a logo, photos, a PDF or your About text. Watch the kit assemble with every item tagged to the upload it
            came from, then answer a few questions about what&rsquo;s missing.
          </p>
        </div>
        <span className="mono small">Start →</span>
      </Link>

      <p className="muted small start-links">
        Also here: <Link href="/kit">Specs&rsquo; own brand kit</Link>, the <Link href="/catalog">components</Link> the intake agent asks with, and the{" "}
        <Link href="/live">live session test page</Link> for the cost guards.
      </p>
    </main>
  );
}
