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

/**
 * Returns the file to upload and its sampled colors. Photos become JPEG at most 1568 px on the
 * long edge; a logo keeps PNG (for transparency) unless it's too big.
 */
export async function prepareImage(file: File, kind: "image" | "logo"): Promise<{ file: File; colors: Swatch[] }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} isn't an image this browser can open.`);
  }
  try {
    const colors = sample(bitmap);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const keepPng = kind === "logo" && file.type === "image/png";
    if (scale === 1 && file.size <= MAX_UPLOAD_BYTES && (keepPng || file.type === "image/jpeg")) return { file, colors };

    const { canvas } = draw(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    let blob = keepPng ? await toBlob(canvas, "image/png") : await toBlob(canvas, "image/jpeg", 0.85);
    if (blob.size > MAX_UPLOAD_BYTES) blob = await toBlob(canvas, "image/jpeg", 0.7);
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is still too large after shrinking.`);
    const name = file.name.replace(/\.[^.]+$/, "") + (blob.type === "image/png" ? ".png" : ".jpg");
    return { file: new File([blob], name, { type: blob.type }), colors };
  } finally {
    bitmap.close();
  }
}
