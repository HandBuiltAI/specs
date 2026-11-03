import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo type-checks with `npm run typecheck` (TypeScript 7), which Next's built-in
  // checker can't drive, so the build skips it. The Netlify build runs typecheck first.
  typescript: { ignoreBuildErrors: true },
  // The spike's Playwright stays out of the app bundle.
  serverExternalPackages: ["playwright"],
  poweredByHeader: false,
};

export default nextConfig;
