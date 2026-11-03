// Reads a brand kit from disk for the spike scripts. The parsing and chunk selection live in
// core/kit.ts, shared with the app's server.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { kitDir } from "./paths.ts";
import * as core from "../../core/kit.ts";

export type { Chunk } from "../../core/kit.ts";
export { approxTokens, chunkForModel, formatChunks } from "../../core/kit.ts";

export function readKitFiles(brand: string): core.KitFiles {
  const dir = kitDir(brand);
  return Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
}

export const loadChunks = (brand: string) => core.parseChunks(readKitFiles(brand));
export const loadProfile = (brand: string, task: core.Task) => core.parseProfile(readKitFiles(brand), task);
export const selectChunks = (brand: string, task: core.Task, intent: string) => core.selectChunks(readKitFiles(brand), task, intent);
export const wordmarkLines = (brand: string) => core.wordmarkLines(readKitFiles(brand), brand);
