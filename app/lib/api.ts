"use client";

// Browser helpers for the API: JSON calls that turn refusals into errors with a code, and a
// small pool for running a few calls at once.

export type ApiError = Error & { code?: string };

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: { error?: { message?: string; code?: string } } & Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    // Netlify's own error pages are HTML, e.g. a 504 when a function runs out of time.
    throw Object.assign(new Error(`The server didn't answer properly (HTTP ${res.status}).`), { code: `http_${res.status}` });
  }
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? `HTTP ${res.status}`), { code: data.error?.code });
  return data as T;
}

export async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return parse<T>(res);
}

export async function sendForm<T>(path: string, fields: Record<string, string | Blob>): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return parse<T>(await fetch(path, { method: "POST", body: form }));
}

/** Runs `work` over `items`, at most `size` at a time. Failures are the work function's to handle. */
export async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) await work(next);
    }),
  );
}
