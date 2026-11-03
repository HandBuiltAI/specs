import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root, so scripts work from any working directory.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TEMPLATES_DIR = join(ROOT, "templates");
export const PROMPTS_DIR = join(ROOT, "prompts");
export const OUTPUT_DIR = join(ROOT, "output");
export const brandDir = (brand: string) => join(ROOT, "brands", brand);
export const kitDir = (brand: string) => join(brandDir(brand), "kit");
