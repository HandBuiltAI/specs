// Reads a brand kit: chunks, retrieval profiles, and the bits of visual-system code needs.
// Pure: every function takes the kit's files as { filename: text }, so the spike reads them
// from disk and the app's server reads them from its bundled copy.
import YAML from "yaml";

export type KitFiles = Record<string, string>;
export type Chunk = { id: string; file: string; text: string; summary: string; confidence: string };
export type Task = "post_generate" | "post_critique";

function chunkIdOf(file: string, text: string): string {
  const m = text.match(/chunk_id:\s*"?([\w-]+)"?/);
  return m?.[1] ?? file.replace(/\.(md|ya?ml|json)$/, "");
}

export function parseChunks(files: KitFiles): Map<string, Chunk> {
  const chunks = new Map<string, Chunk>();
  for (const [file, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (file.startsWith("_") || file === "tokens.css") continue;
    const id = chunkIdOf(file, text);
    const summary = text.match(/summary:\s*>-?\s*\n([\s\S]*?)\n(?:---|\S)/)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const confidence = text.match(/confidence:\s*"?([\w-]+)/)?.[1] ?? "unknown";
    chunks.set(id, { id, file, text, summary, confidence });
  }
  return chunks;
}

type Profile = { always: string[]; if_relevant?: { chunk: string; when: string }[]; budget: number };

export function parseProfile(files: KitFiles, task: Task): Profile {
  const raw = files["_retrieval-rules.yaml"];
  if (!raw) throw new Error("Kit has no _retrieval-rules.yaml");
  const rules = YAML.parse(raw) as { profiles: Record<string, Profile> };
  const p = rules.profiles[task];
  if (!p) throw new Error(`No ${task} profile in _retrieval-rules.yaml`);
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

export function selectChunks(files: KitFiles, task: Task, intent: string) {
  const chunks = parseChunks(files);
  const profile = parseProfile(files, task);
  const wanted = [...profile.always];
  const relevant = new Set(RELEVANT_BY_INTENT[intent] ?? []);
  // In the critique profile every listed if_relevant chunk is cheap and useful (facts and terms to check).
  for (const r of profile.if_relevant ?? []) if (task === "post_critique" || relevant.has(r.chunk)) wanted.push(r.chunk);

  const picked: Chunk[] = [];
  for (const id of wanted) {
    const c = chunks.get(id);
    if (!c) throw new Error(`Profile ${task} names chunk "${id}" but the kit has no such chunk`);
    picked.push(c);
  }
  return { chunks: picked, budget: profile.budget, tokens: picked.reduce((n, c) => n + approxTokens(chunkForModel(c)), 0) };
}

// Bookkeeping fields the models don't need; dropping them keeps each call inside its budget.
const BOOKKEEPING = /^(token_count|sources|version|depends_on|domain|chunk_id):.*(\n[ \t]+.*)*\n?/gm;

/** A chunk as the model sees it: its rules and summary, without source and version bookkeeping. */
export function chunkForModel(c: Chunk): string {
  if (c.file.endsWith(".json")) {
    const data = JSON.parse(c.text) as { meta?: Record<string, unknown> };
    if (data.meta) data.meta = { summary: data.meta.summary, confidence: data.meta.confidence };
    return JSON.stringify(data, null, 1);
  }
  return c.text.replace(BOOKKEEPING, "").trim();
}

export function formatChunks(chunks: Chunk[]): string {
  return chunks.map((c) => `<chunk id="${c.id}" file="${c.file}">\n${chunkForModel(c)}\n</chunk>`).join("\n\n");
}

export function wordmarkLines(files: KitFiles, fallback: string): string[] {
  const raw = files["visual-system.json"];
  if (!raw) return [fallback];
  const vs = JSON.parse(raw) as { type: { wordmark?: { lockup?: string[] } } };
  return vs.type.wordmark?.lockup ?? [fallback];
}
