// Reading a session's drafted chunks from storage. Kept apart from the handlers so the post
// pipeline can load a visitor's kit without importing the extraction and intake handlers.
import "server-only";
import { EXTRACT_CHUNKS } from "../core/extract.ts";
import type { IntakeChunks } from "../core/intake.ts";
import type { ChunkRecord } from "./extract.ts";
import type { Session } from "./sessions.ts";
import type { KV } from "./store.ts";

export const chunkKey = (sid: string, target: string) => `extract/${sid}/chunk/${target}`;

export async function loadChunks(deps: { kv: KV }, s: Session): Promise<IntakeChunks> {
  const out: IntakeChunks = {};
  for (const t of [...EXTRACT_CHUNKS.map((c) => c.id), "conflicts"] as const) {
    if (s.extraction?.targets[t]?.status !== "done") continue;
    const rec = (await deps.kv.get<ChunkRecord>(chunkKey(s.id, t)))?.value;
    if (!rec) continue;
    if (rec.target === "conflicts") out.conflicts = { conflicts: rec.conflicts };
    else out[rec.target] = { draft: rec.draft };
  }
  return out;
}
