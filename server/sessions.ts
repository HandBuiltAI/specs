// Live sessions: created after the bot check and the per-IP limit, then used to count
// posts, regenerations and uploads against the spec's per-session caps.
import "server-only";
import { LIMITS, type PostIntent } from "../core/limits.ts";
import type { Plan, Written } from "../core/schemas.ts";
import type { DemoBrandId } from "./generated/content.ts";
import type { Brief } from "./pipeline.ts";
import { Refusal } from "./http.ts";
import { update, type KV } from "./store.ts";

export type PostRecord = {
  id: string;
  brand: DemoBrandId;
  intent: PostIntent;
  brief: Brief;
  regenerationOf: string | null;
  status: "planning" | "planned" | "writing" | "written" | "failed";
  plan?: Plan;
  photo?: string | null;
  written?: Written;
  warnings: string[];
};

export type UploadRecord = { id: string; kind: "pdf" | "image" | "url"; bytes?: number; pages?: number; mediaType?: string; url?: string };

export type Session = {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipHash: string;
  postsUsed: number;
  regenerationsUsed: number;
  uploads: UploadRecord[];
  posts: Record<string, PostRecord>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sessionKey = (id: string) => `session/${id}`;

export async function createSession(kv: KV, ipHash: string, now: Date): Promise<Session> {
  const id = crypto.randomUUID();
  const session: Session = {
    id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LIMITS.sessionHours * 3600_000).toISOString(),
    ipHash,
    postsUsed: 0,
    regenerationsUsed: 0,
    uploads: [],
    posts: {},
  };
  if (!(await kv.put(sessionKey(id), session, { ifNew: true }))) throw new Error("Session ID collision");
  return session;
}

const noSession = () => new Refusal(401, "no_session", "Start a live session first.");

export async function loadSession(kv: KV, id: string, now: Date): Promise<Session> {
  if (!UUID.test(id)) throw noSession();
  const s = (await kv.get<Session>(sessionKey(id)))?.value;
  if (!s) throw noSession();
  if (new Date(s.expiresAt) <= now) throw new Refusal(401, "session_expired", "This live session has ended. Start a new one.");
  return s;
}

/** Changes a session safely under concurrent requests. `change` may throw a Refusal to abort. */
export function updateSession(kv: KV, id: string, change: (s: Session) => Session): Promise<Session> {
  return update<Session>(kv, sessionKey(id), () => {
    throw noSession();
  }, change);
}

/** Per-IP live-session limit for today. Demo brands never come through here. */
export async function claimIpSlot(kv: KV, ipHash: string, day: string) {
  await update<{ count: number }>(kv, `ip/${day}/${ipHash}`, () => ({ count: 0 }), (c) => {
    if (c.count >= LIMITS.liveSessionsPerIpPerDay) {
      throw new Refusal(429, "ip_limit", `Each visitor can start ${LIMITS.liveSessionsPerIpPerDay} live sessions a day. The demo brands are unlimited.`);
    }
    return { count: c.count + 1 };
  });
}
