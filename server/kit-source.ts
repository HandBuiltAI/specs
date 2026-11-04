// Where a post's brand kit comes from: a demo brand's bundled kit, or the kit a live session
// drafted from its own uploads. Plan, write and compose read only this, so the same pipeline
// serves both.
import "server-only";
import { CONTENT, DEMO_BRAND_IDS, type DemoBrandId } from "./generated/content.ts";
import { kitFromChunks, businessNameOf, googleFontsHref } from "../core/session-kit.ts";
import type { Image } from "../core/claude.ts";
import { Refusal } from "./http.ts";
import type { Session } from "./sessions.ts";
import type { KV } from "./store.ts";
import { loadChunks } from "./kit-chunks.ts";

export type KitPhoto = { file: string; alt: string; mediaType: Image["mediaType"]; base64: string; uploadId?: string };
export type KitSource = {
  /** A demo brand's id, or "session" for the visitor's own kit. */
  id: DemoBrandId | "session";
  files: Record<string, string>;
  businessName: string;
  businessLine: string;
  photos: KitPhoto[];
  tokensCss: string;
  wordmarkLines: string[];
  /** The stylesheet that loads the kit's fonts in the browser. */
  fontsHref: string;
};

export const isDemoBrand = (b: string): b is DemoBrandId => (DEMO_BRAND_IDS as readonly string[]).includes(b);

export function demoKit(brand: DemoBrandId): KitSource {
  const b = CONTENT.brands[brand];
  return {
    id: brand,
    files: b.kit,
    businessName: b.businessName,
    businessLine: b.businessLine,
    photos: b.photos.map((p) => ({ file: p.file, alt: p.alt, mediaType: p.mediaType, base64: p.base64 })),
    tokensCss: b.kit["tokens.css"] ?? CONTENT.neutralTokensCss,
    wordmarkLines: b.wordmark,
    fontsHref: "/generated/fonts/fonts.css",
  };
}

const MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** The visitor's kit, rebuilt from the session's drafted chunks and its uploaded photos. */
export async function sessionKit(deps: { kv: KV }, session: Session): Promise<KitSource> {
  const targets = session.extraction?.targets ?? {};
  if (!session.extraction?.locked || !Object.values(targets).some((t) => t.status === "done")) {
    throw new Refusal(409, "kit_not_ready", "Build the kit from your uploads before making posts.");
  }
  const chunks = await loadChunks(deps, session);
  const name = businessNameOf(chunks) ?? "Your business";
  const kit = kitFromChunks(chunks, { name });
  const line = chunks["positioning-core"]?.draft.items.find((i) => i.label.toLowerCase().startsWith("what_it_is"))?.value ?? chunks["brand-about"]?.draft.summary ?? "";
  const photos: KitPhoto[] = [];
  const used = new Set<string>();
  for (const up of session.uploads.filter((u) => u.kind === "image")) {
    const bytes = await deps.kv.getBytes(`upload/${session.id}/${up.id}`);
    const mediaType = up.mediaType ?? "image/jpeg";
    if (!bytes || !MEDIA.has(mediaType)) continue;
    // Plans name photos by file, so keep names unique within the session.
    let file = up.label ?? "photo";
    for (let n = 2; used.has(file); n++) file = `${up.label ?? "photo"} (${n})`;
    used.add(file);
    photos.push({ file, alt: `Uploaded photo: ${up.label ?? "photo"}`, mediaType: mediaType as Image["mediaType"], base64: Buffer.from(bytes).toString("base64"), uploadId: up.id });
  }
  return { id: "session", files: kit.files, businessName: name, businessLine: line.slice(0, 300), photos, tokensCss: kit.tokensCss, wordmarkLines: kit.wordmarkLines, fontsHref: googleFontsHref(Object.values(kit.fonts)) };
}

export async function kitFor(deps: { kv: KV }, session: Session, brand: DemoBrandId | "session"): Promise<KitSource> {
  return brand === "session" ? sessionKit(deps, session) : demoKit(brand);
}
