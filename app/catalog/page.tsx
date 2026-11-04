import type { Metadata } from "next";
import Showcase from "./showcase.tsx";

export const metadata: Metadata = { title: "Components · Specs" };

export default function CatalogPage() {
  return (
    <main className="wide">
      <p className="eyebrow">The A2UI catalog</p>
      <h1>
        Ten components. <span>Nothing else.</span>
      </h1>
      <p className="muted" style={{ maxWidth: "52ch" }}>
        During intake, the agent can only show you these ten pieces, one at a time, to fill the gaps in your brand kit.
        Below is an example intake for Half Acre Club, a fictional brand. Tap anything to answer; each card shows what it
        would send back.
      </p>
      <Showcase />
    </main>
  );
}
