// Test doubles: memory storage, a fake bot check, and a fake Claude that returns canned
// answers and records every prompt it was sent.
import { memoryKV } from "../server/store.ts";
import { readSettings } from "../server/settings.ts";
import type { Deps } from "../server/handlers.ts";
import type { CallStep } from "../server/claude.ts";
import type { Plan, Written } from "../core/schemas.ts";
import type { Usage } from "../core/claude.ts";

export const ENV = {
  ANTHROPIC_API_KEY: "test-key-not-real",
  TURNSTILE_SECRET_KEY: "test-secret",
  IP_HASH_SALT: "test-salt",
  GENERATION_ENABLED: "true",
  DAILY_SPEND_CAP_USD: "1.50",
};

export const PLAN: Plan = {
  template: "photo-led",
  photo: "uploads/photo-02-day-six-sill.jpg",
  angle: "Lead with the ten-day payoff.",
  rationale: [{ decision: "template", choice: "photo-led", reason: "The sill photo carries it.", cites: ["art-direction"] }],
};

export const WRITTEN: Written = {
  slots: { headline: "Pea shoots. Ten days.", subhead: null, cta: "Link in bio", badge: null, quote: null, attribution: null, date: null, details: null, caption: "One windowsill." },
  rationale: [{ decision: "headline", choice: "Pea shoots. Ten days.", reason: "Matches the voice anchor.", cites: ["voice-core"] }],
};

export type Sent = { step: string; system: string; user: string };

export function makeDeps(opts: { env?: Record<string, string | undefined>; usd?: number; turnstileOk?: boolean; fail?: (step: string) => Error | null } = {}) {
  const sent: Sent[] = [];
  const callStep: CallStep = async (o) => {
    sent.push({ step: o.step, system: o.system, user: o.user });
    const err = opts.fail?.(o.step);
    if (err) throw err;
    const usage: Usage = { step: o.step, model: "claude-sonnet-5-5", input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, usd: opts.usd ?? 0.05 };
    return { data: (o.step === "plan" ? PLAN : WRITTEN) as never, usage };
  };
  const deps: Deps = {
    kv: memoryKV(),
    settings: readSettings({ ...ENV, ...opts.env }),
    now: () => new Date("2026-11-03T18:00:00Z"),
    verifyTurnstile: async (token) => (opts.turnstileOk ?? true) && token === "good-token",
    callStep,
  };
  return { deps, sent };
}

export function jsonReq(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nf-client-connection-ip": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function formReq(fields: Record<string, string | Blob>, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://localhost/api/uploads", { method: "POST", body: form, headers });
}

export async function body(res: Response) {
  return (await res.json()) as { error?: { code: string; message: string } } & Record<string, unknown>;
}

export const brief = { goal: "Get renters to join", details: "First box is pea shoots." };
