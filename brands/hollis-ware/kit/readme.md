---
chunk_id: readme
domain: routing
depends_on: []
token_count: 560
confidence: high
sources:
  - upload: docs/spec.md
    location: Brand kit format
version: 1
fictional: true
summary: >-
  Routing file for the Hollis Ware kit: what the brand is in one line, what
  each chunk holds, and which chunks to read for each job.
---

# Hollis Ware brand kit

> **Fictional brand** made for the Specs demo. The business, people, prices and photos are invented. All rights reserved (see the repo README).

Hollis Ware is a one-person ceramics studio in Portland, Maine, selling stoneware tableware in numbered batches of forty. Style: minimal and premium, like a care card on linen by a north window.

## Chunks

| Chunk | Holds |
| --- | --- |
| `positioning-core.yaml` | What it is, who it's for, the promise, differentiators, and the only facts posts may use |
| `brand-about.md` | Plain-language description and how a batch is made and released |
| `audience-everyday-cooks.yaml` | The core segment, their barriers, and what wins them |
| `voice-core.md` | How the brand sounds, built on "Batch 07. Forty pieces. Made slowly, sold once." |
| `voice-examples.md` | Lines from the tags and site, sample lines per post intent, do / don't pairs |
| `terminology.yaml` | Words to use and avoid, with reasons |
| `visual-system.json` | Colors, contrast limits, type roles, shape and spacing |
| `tokens.css` | Generated from visual-system (`npm run tokens -- hollis-ware`); don't edit |
| `art-direction.md` | North-light photography, photo and type together, the three reference shots |
| `layout-system.md` | How a post is composed: grid, space, devices, photo placement (read when composing a layout) |
| `social-rules.md` | Sizes, slot lengths, CTA and hashtag style, logo on posts, template per intent |
| `guardrails.yaml` | What never to say or show |
| `_retrieval-rules.yaml` | Which chunks load for each job |

## Which to read

- **Writing a post:** voice-core, visual-system, art-direction, social-rules, terminology; add positioning-core whenever the post states a number, price or date.
- **Critiquing a post:** voice-core, art-direction, guardrails, social-rules.
- **Finding gaps:** this file plus every chunk's summary; open anything marked `needs-review` or `medium`.

## Sources

`../uploads/` holds what a real owner would hand over: `website-about.md` (the site's About page, out of date in places), `care-card.pdf` (the card that ships with each piece), `notes-batch-07.md` (June's notes to herself), and three photos. The draft brand was approved by Scott on 2026-11-04.

## Known conflicts

Left in on purpose, because a real upload folder disagrees with itself and the intake step should catch it.

| Conflict | Sources | Resolved as |
| --- | --- | --- |
| Cup price | `website-about.md` and `care-card.pdf` say $36; `photo-03-batch-tag.jpg` and `notes-batch-07.md` say $38 | $38. The notes say clay went up and the website still needs fixing. |
| Batch size | `website-about.md` says "around thirty pieces"; the tag (12/40) and the notes say 40 | 40 for Batch 07. The notes say the batch grew with a new kiln shelf. |
