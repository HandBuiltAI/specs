// The daily spend tripwire and the kill switch.
//
// Before each Claude call the server reserves that call's worst case (its estimated input plus
// every allowed output token). The call only goes ahead if today's spend plus open reservations
// plus this one stays within the cap. Afterwards the reservation is swapped for the real cost
// from the response's usage. A call that dies mid-way leaves its reservation in place, which
// overcounts: the safe direction. The day rolls over at midnight US Eastern.
import "server-only";
import { Refusal } from "./http.ts";
import { update, type KV } from "./store.ts";
import type { Settings } from "./settings.ts";

export type DaySpend = { day: string; spentUsd: number; reservedUsd: number; calls: number };
export type Reservation = { day: string; usd: number };
export type GenerationState = "open" | "off" | "closed_for_today" | "not_configured";

export const dayKey = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const spendKey = (day: string) => `spend/${day}`;
const empty = (day: string): DaySpend => ({ day, spentUsd: 0, reservedUsd: 0, calls: 0 });

export async function todaysSpend(kv: KV, now: Date): Promise<DaySpend> {
  const day = dayKey(now);
  return (await kv.get<DaySpend>(spendKey(day)))?.value ?? empty(day);
}

export async function generationState(kv: KV, settings: Settings, now: Date): Promise<GenerationState> {
  if (!settings.generationEnabled) return "off";
  if (!settings.apiKeyPresent || !settings.turnstileSecret || !settings.ipHashSalt) return "not_configured";
  const s = await todaysSpend(kv, now);
  return s.spentUsd + s.reservedUsd >= settings.dailyCapUsd ? "closed_for_today" : "open";
}

const REFUSALS: Record<Exclude<GenerationState, "open">, Refusal> = {
  off: new Refusal(503, "generation_off", "Live generation is switched off right now. The demo brands still work."),
  not_configured: new Refusal(503, "not_configured", "Live generation isn't set up on this server yet."),
  closed_for_today: new Refusal(503, "daily_cap_reached", "Live generation has hit today's spending cap and reopens tomorrow. The demo brands still work."),
};

/** Throws unless the kill switch is on, the server is configured, and today's cap isn't reached. */
export async function assertGenerationOpen(kv: KV, settings: Settings, now: Date) {
  const state = await generationState(kv, settings, now);
  if (state !== "open") throw REFUSALS[state];
}

export async function reserve(kv: KV, settings: Settings, now: Date, usd: number): Promise<Reservation> {
  await assertGenerationOpen(kv, settings, now);
  const day = dayKey(now);
  await update<DaySpend>(kv, spendKey(day), () => empty(day), (s) => {
    // Spent plus this call would pass the cap: closed for today. Only calls still running stand in
    // the way: that's a moment's wait, not a closed day, so the browser tries again shortly.
    if (s.spentUsd + usd > settings.dailyCapUsd) throw REFUSALS.closed_for_today;
    if (s.spentUsd + s.reservedUsd + usd > settings.dailyCapUsd) throw new Refusal(429, "spend_busy", "Other steps are still running. Trying again in a moment.");
    return { ...s, reservedUsd: s.reservedUsd + usd };
  });
  return { day, usd };
}

/** Swaps a reservation for the call's real cost. Pass 0 when the call never reached the model. */
export async function settle(kv: KV, r: Reservation, actualUsd: number) {
  await update<DaySpend>(kv, spendKey(r.day), () => empty(r.day), (s) => ({
    ...s,
    reservedUsd: Math.max(0, s.reservedUsd - r.usd),
    spentUsd: s.spentUsd + actualUsd,
    calls: s.calls + 1,
  }));
}
