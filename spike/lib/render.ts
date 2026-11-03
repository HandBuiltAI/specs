// Screenshots filled post pages to PNG with Playwright.
import { chromium, type Browser } from "playwright";
import { pathToFileURL } from "node:url";

export type RenderJob = { htmlFile: string; pngFile: string; width: number; height: number };

export type OverflowReport = { selector: string; text: string }[];

export async function renderAll(jobs: RenderJob[]): Promise<Map<string, OverflowReport>> {
  // CHROMIUM_PATH is only for machines with a preinstalled browser; normally `npm install` fetches one.
  const browser: Browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const overflow = new Map<string, OverflowReport>();
  try {
    for (const job of jobs) {
      const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(job.htmlFile).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      // Flag any text block that spills past the canvas, so the critique and the review page can see it.
      const spills = await page.evaluate(() => {
        const post = document.querySelector(".post")!.getBoundingClientRect();
        const out: { selector: string; text: string }[] = [];
        document.querySelectorAll(".post h1, .post p, .post blockquote, .post .hand, .post .cta, .post .stamp").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.bottom > post.bottom - 8 || r.right > post.right - 8) out.push({ selector: el.className || el.tagName, text: (el.textContent ?? "").trim().slice(0, 60) });
        });
        return out;
      });
      overflow.set(job.htmlFile, spills);
      await page.locator(".post").screenshot({ path: job.pngFile });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return overflow;
}
