// Picks a photo's main colors from its pixels, so the model confirms colors instead of guessing
// hex values (spec, Generation pipeline step 1). Pure: the browser feeds it canvas pixels before
// upload, and the spike feeds it pixels read through Playwright.

export type Swatch = { hex: string; share: number };

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * k-means on RGBA pixels (alpha under 128 is skipped). Starts from evenly spaced pixels so the
 * same image always gives the same answer. Returns up to `k` colors, largest share first,
 * merging any two closer than a just-noticeable step.
 */
export function dominantColors(rgba: ArrayLike<number>, k = 6, iterations = 8): Swatch[] {
  const pixels: [number, number, number][] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! >= 128) pixels.push([rgba[i]!, rgba[i + 1]!, rgba[i + 2]!]);
  }
  if (!pixels.length) return [];
  const step = Math.max(1, Math.floor(pixels.length / k));
  let centers = Array.from({ length: Math.min(k, pixels.length) }, (_, i) => [...pixels[i * step]!] as [number, number, number]);
  let counts: number[] = [];

  for (let it = 0; it < iterations; it++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = centers.map(() => 0);
    for (const p of pixels) {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, j) => {
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < bestD) [best, bestD] = [j, d];
      });
      sums[best]![0]! += p[0];
      sums[best]![1]! += p[1];
      sums[best]![2]! += p[2];
      counts[best]!++;
    }
    centers = centers.map((c, j) => (counts[j] ? [sums[j]![0]! / counts[j]!, sums[j]![1]! / counts[j]!, sums[j]![2]! / counts[j]!] : c));
  }

  const swatches: { c: [number, number, number]; n: number }[] = [];
  centers
    .map((c, j) => ({ c, n: counts[j]! }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n)
    .forEach((s) => {
      const near = swatches.find((t) => Math.hypot(t.c[0] - s.c[0], t.c[1] - s.c[1], t.c[2] - s.c[2]) < 18);
      if (near) near.n += s.n;
      else swatches.push(s);
    });
  return swatches.map((s) => ({ hex: toHex(...s.c), share: Math.round((s.n / pixels.length) * 1000) / 1000 }));
}

export const isHex = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);
