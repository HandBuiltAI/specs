// Browser-only image prep before upload: shrink photos to fit under Netlify's ~4.5 MB request
// limit (and to the size Claude reads anyway), and sample their main colors in code so the model
// confirms colors rather than guessing hex values.
import { dominantColors, type Swatch } from "../../core/colors.ts";

/** Claude scales images down past about this long edge, so sending more costs upload time and nothing else. */
const MAX_EDGE = 1568;
/** Comfortably under Netlify's request limit, with room for the form's other fields. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))), type, quality));

function draw(bitmap: ImageBitmap, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't prepare images.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { canvas, ctx };
}

/** Main colors at 96 px: plenty for a palette, and fast. Tiny shares (stray highlights) are dropped. */
function sample(bitmap: ImageBitmap): Swatch[] {
  const scale = 96 / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const { ctx } = draw(bitmap, w, h);
  return dominantColors(ctx.getImageData(0, 0, w, h).data, 6).filter((s) => s.share >= 0.03);
}

/** Logo formats people commonly have, and what to do with the ones a browser can't open. */
export const LOGO_ACCEPT = "image/png,image/svg+xml,.svg,image/jpeg,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif";
const DESIGN_FILE = /\.(ai|eps|psd|sketch|fig|xd|indd|cdr|pdf)$/i;

export const isSvg = (file: File) => file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

/**
 * A browser draws an SVG through an <img>, not createImageBitmap. Rasterized at 1024 px on the
 * long edge: crisp for Claude to read, and the SVG itself is kept for posts.
 */
async function svgBitmap(file: File): Promise<ImageBitmap> {
  const text = await file.text();
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    // An SVG with only a viewBox has no natural size in some browsers.
    const vb = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    const w0 = img.naturalWidth || Number(vb?.[1]) || 1024;
    const h0 = img.naturalHeight || Number(vb?.[2]) || 1024;
    const scale = 1024 / Math.max(w0, h0);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w0 * scale);
    canvas.height = Math.round(h0 * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Why a file can't be used as a logo, in words a person can act on, or null if it can. */
export function logoProblem(file: File): string | null {
  if (DESIGN_FILE.test(file.name)) return `${file.name} is a design file. Export the logo as SVG or PNG (in Illustrator: File, Export, Export As) and drop that in.`;
  return null;
}

/**
 * Returns the file to upload and its sampled colors. Photos become JPEG at most 1568 px on the
 * long edge. A logo becomes PNG, so transparency survives, from any format the browser can open,
 * SVG included.
 */
export async function prepareImage(file: File, kind: "image" | "logo"): Promise<{ file: File; colors: Swatch[] }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = kind === "logo" && isSvg(file) ? await svgBitmap(file) : await createImageBitmap(file);
  } catch {
    const hint = /\.(heic|heif)$/i.test(file.name) ? " This browser can't open HEIC; export it as PNG or JPEG." : kind === "logo" ? " Try SVG or PNG." : "";
    throw new Error(`${file.name} isn't an image this browser can open.${hint}`);
  }
  try {
    const colors = sample(bitmap);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const keepAsIs = kind === "logo" ? file.type === "image/png" : file.type === "image/jpeg";
    if (scale === 1 && file.size <= MAX_UPLOAD_BYTES && keepAsIs) return { file, colors };

    const { canvas } = draw(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    let blob = kind === "logo" ? await toBlob(canvas, "image/png") : await toBlob(canvas, "image/jpeg", 0.85);
    if (blob.size > MAX_UPLOAD_BYTES) blob = await toBlob(canvas, "image/jpeg", 0.7);
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is still too large after shrinking.`);
    const name = file.name.replace(/\.[^.]+$/, "") + (blob.type === "image/png" ? ".png" : ".jpg");
    return { file: new File([blob], name, { type: blob.type }), colors };
  } finally {
    bitmap.close();
  }
}
