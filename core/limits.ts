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
  logoCount: 1,
  /** The note field on the upload screen ("we're a family bakery, 30 years in Calumet"). */
  noteCount: 1,
  /** The paste box, the fallback when a website can't be fetched. Not in the spec's table; about 2,000 tokens. */
  pastedCount: 1,
  pastedChars: 8000,
  /** Colors sampled per photo in the browser. */
  colorsPerImage: 8,
  /** Tries per extraction call (one upload read, or one chunk drafted). A failed try that cost money counts. */
  extractAttempts: 2,

  /** Model turns in the intake conversation. Haiku, so about a cent each; the owner can still edit the kit by hand after. */
  intakeTurns: 12,

  postsPerSession: 4,
  regenerationsPerSession: 1,
  /** Bold passes per session (Scott, Nov 6): one, so the $1.50 daily cap still covers a few visitors. */
  boldPerSession: 1,
  /** The bold pass builds this many of the art director's directions (plus the image model's rough at energy 4–5). */
  boldDirections: 2,
  /** One render the browser sends to the critic: a JPEG about 540 px wide is plenty to judge. */
  boldRenderBytes: 400 * 1024,
  sessionHours: 24,
  liveSessionsPerIpPerDay: 3,

  /** Default daily tripwire in dollars; DAILY_SPEND_CAP_USD overrides it. */
  dailySpendCapUsd: 1.5,
} as const;

export const POST_INTENTS = ["promo", "announcement", "event", "testimonial", "tip"] as const;
export type PostIntent = (typeof POST_INTENTS)[number];

/** Length as a person counts it: one per character, emoji included. */
export const charCount = (s: string) => [...s].length;
