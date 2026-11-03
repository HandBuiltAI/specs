// Key-value storage for sessions, uploads, rate limits and daily spend: Netlify Blobs when
// deployed, an in-memory map for local dev and tests. Counters use compare-and-swap on the
// blob's ETag so two requests can't both take the last slot.
import "server-only";
import { getStore } from "@netlify/blobs";

export type Versioned<T> = { value: T; etag: string };

export interface KV {
  get<T>(key: string): Promise<Versioned<T> | null>;
  /** Writes only if the key is unchanged since `ifMatch`, or absent when `ifNew`. Returns whether it wrote. */
  put(key: string, value: unknown, cond: { ifMatch: string } | { ifNew: true }): Promise<boolean>;
  putBytes(key: string, bytes: ArrayBuffer, metadata: Record<string, string | number>): Promise<void>;
}

const STORE_NAME = "specs";

function blobsKV(): KV {
  // Strong consistency: a counter read just after a write must see it.
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  return {
    async get<T>(key: string) {
      const entry = await store.getWithMetadata(key, { type: "json" });
      if (entry === null) return null;
      return { value: entry.data as T, etag: entry.etag ?? "" };
    },
    async put(key, value, cond) {
      const res = await store.setJSON(key, value, "ifNew" in cond ? { onlyIfNew: true } : { onlyIfMatch: cond.ifMatch });
      return res.modified;
    },
    async putBytes(key, bytes, metadata) {
      await store.set(key, bytes, { metadata });
    },
  };
}

export function memoryKV(): KV {
  const data = new Map<string, { json: string; etag: string }>();
  let n = 0;
  return {
    async get<T>(key: string) {
      const e = data.get(key);
      return e ? { value: JSON.parse(e.json) as T, etag: e.etag } : null;
    },
    async put(key, value, cond) {
      const cur = data.get(key);
      if ("ifNew" in cond ? cur : cur?.etag !== cond.ifMatch) return false;
      data.set(key, { json: JSON.stringify(value), etag: `"${++n}"` });
      return true;
    },
    async putBytes(key, bytes, metadata) {
      data.set(key, { json: JSON.stringify({ bytes: bytes.byteLength, metadata }), etag: `"${++n}"` });
    },
  };
}

let shared: KV | undefined;

/**
 * Blobs whenever the code runs on Netlify. The memory store is only for `next dev` and tests,
 * opted into with SPECS_STORE=memory, and is ignored on Netlify: per-instance memory would
 * let each function instance keep its own spend total.
 */
export function liveKV(): KV {
  const onNetlify = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
  shared ??= !onNetlify && process.env.SPECS_STORE === "memory" ? memoryKV() : blobsKV();
  return shared;
}

/**
 * Read-modify-write with retries. `change` returns the new value, or throws to abort
 * (for example, a Refusal when a cap is reached).
 */
export async function update<T>(kv: KV, key: string, initial: () => T, change: (current: T) => T): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const cur = await kv.get<T>(key);
    const next = change(cur ? cur.value : initial());
    if (await kv.put(key, next, cur ? { ifMatch: cur.etag } : { ifNew: true })) return next;
  }
  throw new Error(`Couldn't update ${key.split("/")[0]} after 10 tries`);
}
