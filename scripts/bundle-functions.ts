// Bundles functions/*.ts into netlify/functions/*.mjs for Netlify (run by `npm run build`).
// The server code imports `server-only`, which throws unless the "react-server" condition is
// set, as it is inside Next. Bundling here with that condition keeps the guard for the browser
// bundle while letting a plain Netlify function use the same server code.
import { build } from "esbuild";
import { readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../spike/lib/paths.ts";

const src = join(ROOT, "functions");
const out = join(ROOT, "netlify", "functions");
mkdirSync(out, { recursive: true });
for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
  await build({
    entryPoints: [join(src, file)],
    outfile: join(out, file.replace(/\.ts$/, ".mjs")),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    conditions: ["react-server"],
    // Some bundled packages still call require() for Node built-ins.
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    logLevel: "warning",
  });
  console.log(`Bundled functions/${file} into netlify/functions/`);
}
