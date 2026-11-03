---
chunk_id: readme
domain: routing
depends_on: []
token_count: 450
confidence: high
sources:
  - upload: docs/spec.md
    location: Brand kit format
version: 1
fictional: true
summary: >-
  Routing file for the Half Acre Club kit: what the brand is in one line, what
  each chunk holds, and which chunks to read for each job.
---

# Half Acre Club brand kit

> **Fictional brand** made for the Specs demo. The business, people, prices and photos are invented. All rights reserved (see the repo README).

Half Acre Club is a monthly growing kit for renters: one small project per box, sized for a windowsill. Style: warm and handmade, like a seed packet that's spent a week on the kitchen counter.

## Chunks

| Chunk | Holds |
| --- | --- |
| `positioning-core.yaml` | What it is, who it's for, the promise, differentiators, and the only facts posts may use |
| `brand-about.md` | Plain-language description and how a month with the box goes |
| `audience-renters.yaml` | The core segment, their barriers, and what wins them |
| `voice-core.md` | How the brand sounds, built on "Pea shoots. Ten days. One windowsill. You've got this." |
| `voice-examples.md` | Sample lines per post intent and do / don't pairs |
| `terminology.yaml` | Words to use and avoid, with reasons |
| `visual-system.json` | Colors, contrast limits, type roles, shape and spacing |
| `tokens.css` | Generated from visual-system (`npm run tokens -- half-acre-club`); don't edit |
| `art-direction.md` | Photo treatment, photo and type together, the three reference shots |
| `social-rules.md` | Sizes, slot lengths, CTA and hashtag style, logo on posts, template per intent |
| `guardrails.yaml` | What never to say or show |
| `_retrieval-rules.yaml` | Which chunks load for each job |

## Which to read

- **Writing a post:** voice-core, visual-system, art-direction, social-rules, terminology; add positioning-core whenever the post states a fact.
- **Critiquing a post:** voice-core, art-direction, guardrails, social-rules.
- **Finding gaps:** this file plus every chunk's summary; open anything marked `needs-review` or `medium`.

## Sources

Most chunks come from an interview with Scott (2026-11-03) and the reference photos in `../uploads/`. The deliberately messy uploads (rough PDF, wordy About text) are still to come.
