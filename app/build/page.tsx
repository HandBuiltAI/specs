import type { Metadata } from "next";
import BuildKit from "./build-kit";
import { PageMotion } from "../ui/page-motion.tsx";

export const metadata: Metadata = { title: "Build a brand kit · Specs" };

export default function BuildPage() {
  return (
    <PageMotion>
    <main className="build">
      <h1>Build a brand kit</h1>
      <p className="muted">
        Upload your logo, photos, a PDF and your website. Claude reads each one, then drafts your brand kit piece by piece,
        and every item shows the upload it came from.
      </p>
      <BuildKit siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} />
    </main>
    </PageMotion>
  );
}
