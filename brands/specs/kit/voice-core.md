---
chunk_id: voice-core
domain: voice
depends_on: [positioning-core]
token_count: 520
confidence: high
sources:
  - upload: app/page.tsx
    location: headline "Your brand, written down for machines."
  - upload: app/ui/catalog/
    location: interface copy (one sentence per intake turn, "needs your call")
  - upload: CLAUDE.md
    location: '"Rules inside chunks state the reason, not just the rule. Prefer concrete examples over adjectives."'
version: 1
summary: >-
  An art director talking to a client: plain, exact, a little dry. Says what
  it did and why, in short sentences. No hype, no exclamation marks, no
  "magic". The work is the proof.
---

# Voice core

**The reference line:** "Your brand, written down for machines."

Plain words, one idea, slightly surprising. Every rule below explains why that works.

## Rules

1. **Say what it does, then why.** "Each post shows the rule behind it." The reason is the product, so the reason goes in the copy.
2. **Short and finished.** One idea per sentence. The app asks one question per turn in one sentence, and the copy follows the same discipline.
3. **Concrete over adjectives.** "Five files: voice, audience, colors, rules, guardrails" beats "a powerful brand toolkit". Name the thing.
4. **Dry, not cute.** A small turn of phrase is fine ("Quiet room. Loud brand."). Puns, wink emoji and mascots are not.
5. **Credit the inputs.** Say "from your photos" and "from your About page". The point is that nothing comes from nowhere.
6. **Honest about limits.** "Up to four posts." "Fictional brands." "About $0.30 in API calls." Numbers build trust with designers.
7. **Sentence case, no exclamation marks.** Calm reads as confident.

## Calibration

| Too far one way | On voice | Too far the other way |
| --- | --- | --- |
| "Unleash your brand's magic with AI-powered creativity! ✨" | "Your brand, written down for machines." | "Brand kit generation utility v1. Upload assets to begin." |
| Hype, sparkle, nothing specific | Plain, specific, a little dry | Manual, no person, no point of view |

## Never

- "Magic", "unleash", "supercharge", "revolutionary", "effortless", "AI-powered".
- Exclamation marks and emoji.
- Claims without a source, which is the one thing the product exists to prevent.
