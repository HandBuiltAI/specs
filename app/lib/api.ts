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

/** True when the request never got an answer (Safari says "Load failed", Chrome "Failed to fetch"). */
export const isDropped = (e: unknown) => e instanceof TypeError;

/**
 * A call that's safe to repeat, tried again if the connection drops on the way back. After a drop
 * the server may still be finishing the first try, so "still working" answers wait and ask again.
 */
export async function callAgainIfDropped<T>(path: string, body: unknown, stillWorking = "not_ready"): Promise<T> {
  let dropped = 0;
  for (let waited = 0; ; ) {
    try {
      return await call<T>(path, body);
    } catch (e) {
      if (isDropped(e) && dropped < 2) dropped++;
      else if (dropped && (e as ApiError).code === stillWorking && waited < 10) waited++;
      else throw e;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}

/** A call that waits and tries again while the day's budget is held by other steps still running. */
export async function callPatiently<T>(path: string, body: unknown, tries = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await call<T>(path, body);
    } catch (e) {
      if ((e as ApiError).code !== "spend_busy" || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 + i * 1000));
    }
  }
}
