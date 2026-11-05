import type { Metadata } from "next";
import LiveTest from "./live-test";
import { PageMotion } from "../ui/page-motion.tsx";

export const metadata: Metadata = { title: "Live session test · Specs" };

export default function LivePage() {
  return (
    <PageMotion>
    <main>
      <h1>Live session test</h1>
      <p className="muted">
        A plain page for checking the phase 3 guards against the real server. It makes posts for the fictional demo brand
        Half Acre Club from your brief. Every request goes through the same caps a visitor will hit.
      </p>
      <LiveTest siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} />
    </main>
    </PageMotion>
  );
}
