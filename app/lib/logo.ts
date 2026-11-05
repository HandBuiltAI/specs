// Browser-only: the visitor's uploaded logo, ready to sign their posts.

/**
 * The visitor's logo as a small PNG data URL, so it travels inside each post (and its PNG
 * export) like the photos do. 480 px on the long edge is plenty for a post's signature.
 */
export async function logoDataUrl(sessionId: string, uploadId: string): Promise<string | null> {
  try {
    const res = await fetch("/api/uploads/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, uploadId }) });
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

