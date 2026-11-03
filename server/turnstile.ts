// Cloudflare Turnstile: the bot check before a live session starts.
import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type VerifyTurnstile = (token: string, ip: string) => Promise<boolean>;

export function turnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch): VerifyTurnstile {
  return async (token, ip) => {
    const body = new URLSearchParams({ secret, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    try {
      const res = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false; // Can't reach Cloudflare: fail closed.
    }
  };
}
