---
chunk_id: readme
domain: routing
depends_on: []
token_count: 520
confidence: high
sources:
  - upload: docs/spec.md
    location: Brand kit format; "The app's own brand"
version: 1
summary: >-
  Routing file for Specs' own brand kit: the app describing itself in the same
  format it makes for other brands, and which chunks to read for each job.
---

# Specs brand kit

Specs is a free, open-source web app that turns a small business's messy brand materials into a brand kit an AI can read, then art-directs Instagram posts that explain their own design decisions. This is its own kit, written in the format it generates, so the method is visible in the tool itself.

Unlike the three demo brands, Specs is real. The facts here are true as of the version date.

## Chunks

| Chunk | Holds |
| --- | --- |
| `positioning-core.yaml` | What Specs is, who it's for, the promise, differentiators, and the only facts copy may use |
| `brand-about.md` | Plain-language description and how a session works |
| `audience-designers.yaml` | The core audience: designers and creative leads judging AI design tools |
| `voice-core.md` | How Specs sounds, built on "Your brand, written down for machines." |
| `voice-examples.md` | Lines from the app, sample lines per post intent, do / don't pairs |
| `terminology.yaml` | Words to use and avoid, with reasons |
| `visual-system.json` | "Quiet room. Loud brand.": colors, contrast limits, type roles, shape and spacing |
| `tokens.css` | Generated from visual-system (`npm run tokens -- specs`); don't edit |
| `art-direction.md` | Screens as the subject, the brand being built as the only color |
| `social-rules.md` | Sizes, slot lengths, CTA and hashtag style, template per intent |
| `guardrails.yaml` | What never to say or show |
| `_retrieval-rules.yaml` | Which chunks load for each job |

## Which to read

- **Writing a post or page copy:** voice-core, visual-system, art-direction, social-rules, terminology; add positioning-core whenever the copy states a number, model or limit.
- **Critiquing:** voice-core, art-direction, guardrails, social-rules.
- **Finding gaps:** this file plus every chunk's summary; open anything marked `medium`.

## Sources

`docs/spec.md` (the product), `app/globals.css` (the look, as built), `docs/journal.md` (decisions and why), `core/config.ts` and `core/limits.ts` (models and caps), and the look agreed with Scott Galetto on 2026-11-04 ("Quiet room. Loud brand.").
