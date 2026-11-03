// Downloads the Chromium the spike renders posts with. Skipped on Netlify and wherever
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set, because the app doesn't need it.
import { execSync } from "node:child_process";

if (process.env.NETLIFY || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
  console.log("Skipping the spike's Chromium download.");
} else {
  execSync("npx playwright install chromium", { stdio: "inherit" });
}
