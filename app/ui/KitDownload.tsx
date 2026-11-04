"use client";

// "Download kit (.zip)": builds the kit folder in the browser, so it costs nothing.
import { useState } from "react";
import { downloadKitZip } from "../lib/kit-zip.ts";

export function KitDownload({ slug, name, files }: { slug: string; name: string; files: Record<string, string> }) {
  const [zipping, setZipping] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run() {
    setZipping(true);
    setFailed(false);
    try {
      await downloadKitZip(slug, name, files);
    } catch {
      setFailed(true);
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="kit-download">
      <button type="button" className="c-btn" onClick={run} disabled={zipping}>
        {zipping ? "Zipping…" : "Download kit (.zip)"}
      </button>
      {failed && (
        <p className="c-error" role="alert">
          <b aria-hidden="true">!</b>
          <span>The zip didn&rsquo;t build. Try again.</span>
        </p>
      )}
    </div>
  );
}
