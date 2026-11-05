// Key-value storage for sessions, uploads, rate limits and daily spend: Netlify Blobs when
// deployed, an in-memory map for local dev and tests. Counters use compare-and-swap on the
// blob's ETag so two requests can't both take the last slot.
import "server-only";
import { getStore } from "@netlify/blobs";
import { Refusal } from "./http.ts";

export type Versioned<T> = { value: T; etag: string };

export interface KV {
  get<T>(key: string): Promise<Versioned<T> | null>;
  /** Writes only if the key is unchanged since `ifMatch`, or absent when `ifNew`. Returns whether it wrote. */
  put(key: string, value: unknown, cond: { ifMatch: string } | { ifNew: true }): Promise<boolean>;
  putBytes(key: string, bytes: ArrayBuffer, metadata: Record<string, string | number>): Promise<void>;
  getBytes(key: string): Promise<ArrayBuffer | null>;
}

const STORE_NAME = "specs";

// Next.js wraps the global fetch to add its own caching. Blobs requests go through the
// original fetch instead, each attempt capped at a few seconds, and any failure is logged
// with its status (never the token) so it shows up in Netlify's function logs.
const ATTEMPT_MS = 4000;
function blobsFetch(): typeof fetch {
  const base = ((globalThis.fetch as typeof fetch & { _nextOriginalFetch?: typeof fetch })._nextOriginalFetch ?? globalThis.fetch).bind(globalThis);
  return async (input, init) => {
    const where = (() => {
      try {
        const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return `${init?.method ?? "GET"} ${u.host}`;
      } catch {
        return "request";
      }
    })();
    try {
      const res = await base(input, { ...init, signal: AbortSignal.timeout(ATTEMPT_MS) });
      if (!res.ok && res.status !== 404 && res.status !== 412) console.error(`Blobs ${where} answered ${res.status}`);
      return res;
    } catch (err) {
      console.error(`Blobs ${where} failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      throw err;
    }
  };
}

/** Fails a whole storage operation (including the Blobs client's own retries) well inside Netlify's time limit. */
const OP_MS = 12_000;
function inTime<T>(op: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Refusal(503, "storage_unavailable", "Storage isn't answering right now. Try again in a minute.")), OP_MS);
  });
  return Promise.race([op, timeout]).finally(() => clearTimeout(timer));
}

function blobsKV(): KV {
  // Strong consistency: a counter read just after a write must see it.
  const store = getStore({ name: STORE_NAME, consistency: "strong", fetch: blobsFetch() });
  const kv: KV = {
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
    async getBytes(key) {
      return store.get(key, { type: "arrayBuffer" });
    },
  };
  return {
    get: (key) => inTime(kv.get(key)),
    put: (key, value, cond) => inTime(kv.put(key, value, cond)),
    putBytes: (key, bytes, metadata) => inTime(kv.putBytes(key, bytes, metadata)),
    getBytes: (key) => inTime(kv.getBytes(key)),
  };
}

export function memoryKV(): KV {
  const data = new Map<string, { json: string; etag: string }>();
  const files = new Map<string, ArrayBuffer>();
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
      files.set(key, bytes.slice(0));
    },
    async getBytes(key) {
      return files.get(key) ?? null;
    },
  };
}

let memory: KV | undefined;

/**
 * Blobs whenever the code runs on Netlify. The memory store is only for `next dev` and tests,
 * opted into with SPECS_STORE=memory, and is ignored on Netlify: per-instance memory would
 * let each function instance keep its own spend total.
 *
 * The Blobs store is made fresh on every call, never kept between requests: it captures the
 * access token Netlify hands each request, and a warm function instance that reused an old
 * store failed with "Token expired".
 */
export function liveKV(): KV {
  const onNetlify = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!onNetlify && process.env.SPECS_STORE === "memory") return (memory ??= memoryKV());
  return blobsKV();
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
