// Request reading and refusal responses shared by every route.
import "server-only";
import { createHash } from "node:crypto";

/** A deliberate refusal: a status, a stable code for scripts and tests, and a plain message for people. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const NO_STORE = { "cache-control": "no-store" };

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

/** Runs a handler, turning refusals into JSON errors and anything unexpected into a bare 500. */
export async function respond(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Refusal) return json({ error: { code: err.code, message: err.message } }, err.status);
    // Log the message only: never the request, which could hold free text, and never headers.
    console.error("Unexpected server error:", err instanceof Error ? err.message : String(err));
    return json({ error: { code: "server_error", message: "Something went wrong on our side." } }, 500);
  }
}

/** Reads a JSON body with a hard byte cap, before any parsing. */
export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new Refusal(415, "json_only", "Send JSON with Content-Type: application/json.");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw tooLarge(maxBytes);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw tooLarge(maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Refusal(400, "bad_json", "The request body isn't valid JSON.");
  }
}

const tooLarge = (max: number) =>
  new Refusal(413, "body_too_large", `Requests are capped at ${Math.round(max / 1024)} KB. This endpoint takes short structured fields, not prompts.`);

/** The visitor's IP as Netlify reports it. Only ever stored as a salted hash. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export const hashIp = (ip: string, salt: string) => createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
