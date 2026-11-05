// Test doubles: memory storage, a fake bot check, and a fake Claude that returns canned
// answers and records every prompt it was sent.
import { memoryKV } from "../server/store.ts";
import { readSettings } from "../server/settings.ts";
import type { Deps } from "../server/handlers.ts";
import type { CallStep } from "../server/claude.ts";
import type { Plan, Written } from "../core/schemas.ts";
import type { Usage } from "../core/claude.ts";
import type { ChunkDraft, Conflicts, Evidence } from "../core/extract.ts";

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

export const COMPOSED = {
  html: '<section class="card"><h1 data-slot="headline"></h1></section><img data-slot="photo"><div data-slot="wordmark"></div>',
  css: ".card{position:absolute;inset:var(--safe-margin);background:var(--role-background)} h1{font-family:var(--font-heading);color:var(--role-heading);font-size:96px}",
  rationale: [{ decision: "layout", choice: "One card", reason: "Paper on a counter.", cites: ["layout-system"] }],
};

export type Sent = { step: string; system: string; user: string; cachedText?: string; fetchDomain?: string; images?: number; documents?: number };

export const EVIDENCE: Evidence = {
  summary: "Working notes from the packing table.",
  facts: [
    { topic: "offer", statement: "First box is pea shoots.", quote: "Box 01 / pea shoots", location: "page 1" },
    { topic: "visual", statement: "Packet cream swatch.", quote: "packet cream #F2E8D5", location: "page 2" },
  ],
  lines: [{ line: "One small thing to grow.", location: "page 1" }],
};

export const DRAFT: ChunkDraft = {
  summary: "Cream paper, brown text.",
  confidence: "high",
  items: [
    { label: "color: background", value: "#F2E8D5 packet cream", why: "Cream for paper.", sources: [{ upload: "rough-notes.pdf", location: "page 2" }], confidence: "high" },
    { label: "color: accent", value: "#123456 invented blue", why: null, sources: [{ upload: "rough-notes.pdf", location: "page 2" }], confidence: "high" },
    { label: "promise", value: "Something", why: null, sources: [{ upload: "brochure.pdf", location: "p1" }], confidence: "medium" },
  ],
  missing: ["heading font"],
};

export const CONFLICTS: Conflicts = {
  conflicts: [
    {
      about: "Monthly price",
      sides: [
        { says: "$24 a month", source: { upload: "rough-notes.pdf", location: "page 1" } },
        { says: "$22 a month", source: { upload: "brochure.pdf", location: "p1" } },
      ],
      suggestion: "The notes are newer.",
      topic: "price",
      trust: 0,
    },
    {
      about: "Box number for pea shoots",
      sides: [
        { says: "BOX No. 014", source: { upload: "photo-01.jpg", location: "card" } },
        { says: "Box 01", source: { upload: "rough-notes.pdf", location: "page 1" } },
      ],
      suggestion: "Trust the notes.",
      topic: "count",
      trust: 1,
    },
  ],
};

/** A default intake turn: a SourceCard about the first open gap listed in the prompt. */
export function intakeTurnFor(user: string): unknown {
  const gap = user.match(/- id: (\S+)/)?.[1] ?? "none";
  return {
    gap,
    say: "Your uploads disagree on this. A second sentence that should be cut.",
    call: { component: "SourceCard", props: { chunk: "brand-about", label: "First box", fact: "Your first box is Box 01.", sources: [{ upload: "rough-notes.pdf", location: "page 1" }] } },
  };
}

/** Tests write turns as { gap, say, call }; the model sends the call's props as a JSON string. */
function asModelTurn(t: unknown): unknown {
  const x = t as { gap: string; say: string; call?: { component: string; props: unknown }; props?: string };
  if (!x.call) return t;
  return { gap: x.gap, say: x.say, component: x.call.component, props: JSON.stringify(x.call.props) };
}

export function makeDeps(
  opts: { env?: Record<string, string | undefined>; usd?: number; turnstileOk?: boolean; fail?: (step: string) => Error | null; intake?: (user: string) => unknown } = {},
) {
  const sent: Sent[] = [];
  const callStep: CallStep = async (o) => {
    sent.push({ step: o.step, system: o.system, user: o.user, cachedText: o.cachedText, fetchDomain: o.fetchDomain, images: o.images?.length, documents: o.documents?.length });
    const err = opts.fail?.(o.step);
    if (err) throw err;
    const usage: Usage = { step: o.step, model: "claude-sonnet-5-5", input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, usd: opts.usd ?? 0.05 };
    const data =
      o.step === "intake" ? asModelTurn((opts.intake ?? intakeTurnFor)(o.user))
      : o.step === "plan" ? PLAN
      : o.step === "write" ? WRITTEN
      : o.step === "read" ? EVIDENCE
      : o.step === "compose" ? COMPOSED
      : o.user.includes("Target: conflicts") ? CONFLICTS
      : DRAFT;
    return { data: data as never, usage };
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
