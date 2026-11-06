// Renders a post page in a hidden, script-free frame here in the browser, runs the layout probe
// on it, and (when asked) takes a small JPEG of it for the critic. The frame shares our origin
// only so we can read it; the post's own HTML never runs scripts.
import { LAYOUT_PROBE, type ProbeIssue } from "../../core/compose.ts";
import { embeddedFontCss } from "../ui/catalog/PostPreview.tsx";

export type Rendered = { issues: ProbeIssue[]; jpeg: string | null };

/** Null when the page couldn't be checked (then don't show it). */
export async function renderPost(html: string, aspect: "1:1" | "4:5", opts: { jpeg?: boolean } = {}): Promise<Rendered | null> {
  const h = aspect === "4:5" ? 1350 : 1080;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:1080px;height:${h}px;border:0;visibility:hidden`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument!;
    const win = frame.contentWindow!;
    await doc.fonts?.ready;
    await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))))));
    // The probe is written to run inside the page; here it runs from this window against the frame's document.
    const run = new Function("document", "getComputedStyle", `return ${LAYOUT_PROBE}`) as (d: Document, g: typeof getComputedStyle) => ProbeIssue[];
    const issues = run(doc, win.getComputedStyle.bind(win));
    let jpeg: string | null = null;
    const post = doc.querySelector<HTMLElement>(".post");
    if (opts.jpeg && post) {
      const { toJpeg } = await import("html-to-image");
      // Half size is plenty for the critic, and keeps each upload small.
      const url = await toJpeg(post, { width: 1080, height: h, pixelRatio: 0.5, quality: 0.82, cacheBust: false, fontEmbedCSS: await embeddedFontCss(doc) });
      jpeg = url.slice(url.indexOf(",") + 1);
    }
    return { issues, jpeg };
  } catch {
    return null;
  } finally {
    frame.remove();
  }
}
