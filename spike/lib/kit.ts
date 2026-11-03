// Reads a brand kit: chunks, retrieval profiles, and the bits of visual-system code needs.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { kitDir } from "./paths.ts";

export type Chunk = { id: string; file: string; text: string; summary: string; confidence: string };

function chunkIdOf(file: string, text: string): string {
  const m = text.match(/chunk_id:\s*"?([\w-]+)"?/);
  return m?.[1] ?? file.replace(/\.(md|ya?ml|json)$/, "");
}

export function loadChunks(brand: string): Map<string, Chunk> {
  const dir = kitDir(brand);
  const chunks = new Map<string, Chunk>();
  for (const file of readdirSync(dir)) {
    if (file.startsWith("_") || file === "tokens.css") continue;
    const text = readFileSync(join(dir, file), "utf8");
    const id = chunkIdOf(file, text);
    const summary = text.match(/summary:\s*>-?\s*\n([\s\S]*?)\n(?:---|\S)/)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const confidence = text.match(/confidence:\s*"?([\w-]+)/)?.[1] ?? "unknown";
    chunks.set(id, { id, file, text, summary, confidence });
  }
  return chunks;
}

type Profile = { always: string[]; if_relevant?: { chunk: string; when: string }[]; budget: number };

export function loadProfile(brand: string, task: "post_generate" | "post_critique"): Profile {
  const rules = YAML.parse(readFileSync(join(kitDir(brand), "_retrieval-rules.yaml"), "utf8")) as { profiles: Record<string, Profile> };
  const p = rules.profiles[task];
  if (!p) throw new Error(`No ${task} profile in ${brand}/_retrieval-rules.yaml`);
  return p;
}

// Which load-if-relevant chunks apply to a post intent. Mirrors the "when" notes in
// _retrieval-rules.yaml; kept in code so the selection is visible and testable.
const RELEVANT_BY_INTENT: Record<string, string[]> = {
  announcement: ["positioning-core", "voice-examples", "audience-renters"],
  promo: ["positioning-core", "voice-examples", "audience-renters", "guardrails"],
  tip: ["voice-examples"],
  event: ["voice-examples", "positioning-core"],
  testimonial: ["voice-examples", "guardrails"],
};

/** Approximate tokens: about 4 characters each. Good enough for a budget check. */
export const approxTokens = (s: string) => Math.ceil(s.length / 4);

export function selectChunks(brand: string, task: "post_generate" | "post_critique", intent: string) {
  const chunks = loadChunks(brand);
  const profile = loadProfile(brand, task);
  const wanted = [...profile.always];
  const relevant = new Set(RELEVANT_BY_INTENT[intent] ?? []);
  // In the critique profile every listed if_relevant chunk is cheap and useful (facts and terms to check).
  for (const r of profile.if_relevant ?? []) if (task === "post_critique" || relevant.has(r.chunk)) wanted.push(r.chunk);

  const picked: Chunk[] = [];
  for (const id of wanted) {
    const c = chunks.get(id);
    if (!c) throw new Error(`Profile ${task} names chunk "${id}" but ${brand} has no such chunk`);
    picked.push(c);
  }
  return { chunks: picked, budget: profile.budget, tokens: picked.reduce((n, c) => n + approxTokens(c.text), 0) };
}

export function formatChunks(chunks: Chunk[]): string {
  return chunks.map((c) => `<chunk id="${c.id}" file="${c.file}">\n${c.text.trim()}\n</chunk>`).join("\n\n");
}

export function wordmarkLines(brand: string): string[] {
  const vs = JSON.parse(readFileSync(join(kitDir(brand), "visual-system.json"), "utf8")) as { type: { wordmark?: { lockup?: string[] } } };
  return vs.type.wordmark?.lockup ?? [brand];
}
