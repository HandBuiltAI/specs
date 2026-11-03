// Checks one uploaded file or URL against the spec's caps before anything stores it.
// Types are judged by the file's first bytes, not its name or the browser's label.
import "server-only";
import { PDFDocument } from "pdf-lib";
import { LIMITS, charCount } from "../core/limits.ts";
import { Refusal } from "./http.ts";

export type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

export function sniffImage(b: Uint8Array): ImageType | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function checkImage(file: File): Promise<{ mediaType: ImageType; bytes: number }> {
  if (file.size > LIMITS.imageBytes) {
    throw new Refusal(413, "image_too_large", `Photos are capped at ${mb(LIMITS.imageBytes)} each; this one is ${mb(file.size)}.`);
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mediaType = sniffImage(head);
  if (!mediaType) throw new Refusal(415, "image_type", "Photos must be JPEG, PNG, GIF or WebP.");
  return { mediaType, bytes: file.size };
}

export async function checkPdf(file: File): Promise<{ bytes: number; pages: number }> {
  if (file.size > LIMITS.pdfBytes) {
    throw new Refusal(413, "pdf_too_large", `The PDF is capped at ${mb(LIMITS.pdfBytes)}; this one is ${mb(file.size)}.`);
  }
  const data = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...data.subarray(0, 5)) !== "%PDF-") throw new Refusal(415, "pdf_type", "That file isn't a PDF.");
  let pages: number;
  try {
    pages = (await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  } catch {
    throw new Refusal(400, "pdf_unreadable", "That PDF couldn't be read. Try exporting it again.");
  }
  if (pages > LIMITS.pdfPages) {
    throw new Refusal(413, "pdf_too_many_pages", `The PDF is capped at ${LIMITS.pdfPages} pages; this one has ${pages}.`);
  }
  return { bytes: file.size, pages };
}

export function checkUrl(raw: string): string {
  const text = raw.trim();
  if (charCount(text) > LIMITS.urlChars) throw new Refusal(413, "url_too_long", `URLs are capped at ${LIMITS.urlChars} characters.`);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Refusal(400, "url_invalid", "That doesn't look like a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Refusal(400, "url_invalid", "Use an http or https web address.");
  if (url.username || url.password) throw new Refusal(400, "url_invalid", "Web addresses with a username or password aren't accepted.");
  return url.toString();
}
