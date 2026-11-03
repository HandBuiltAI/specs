// The spec's caps for live sessions ("Architecture, cost and guardrails" in docs/spec.md).
// Pure constants, so the server enforces them and the browser can show them.

export const LIMITS = {
  /** Free-typed text: each brief field and the upload note. */
  messageChars: 500,
  /** A whole JSON request body. Generous for structured fields; far too small for a pasted prompt plus kit. */
  jsonBodyBytes: 8 * 1024,

  pdfCount: 1,
  pdfPages: 10,
  /** Not in the spec's table; Netlify can't accept a request body much over 4.5 MB anyway. */
  pdfBytes: 4 * 1024 * 1024,
  imageCount: 5,
  /** The spec's cap. Netlify's ~4.5 MB request limit is lower, so phase 4 should resize photos in the browser. */
  imageBytes: 5 * 1024 * 1024,
  urlCount: 1,
  urlChars: 2048,

  postsPerSession: 4,
  regenerationsPerSession: 1,
  sessionHours: 24,
  liveSessionsPerIpPerDay: 3,

  /** Default daily tripwire in dollars; DAILY_SPEND_CAP_USD overrides it. */
  dailySpendCapUsd: 1.5,
} as const;

export const POST_INTENTS = ["promo", "announcement", "event", "testimonial", "tip"] as const;
export type PostIntent = (typeof POST_INTENTS)[number];

/** Length as a person counts it: one per character, emoji included. */
export const charCount = (s: string) => [...s].length;
