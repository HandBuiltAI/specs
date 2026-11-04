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
  Routing file for the Third Shift Slice kit: what the brand is in one line,
  what each chunk holds, and which chunks to read for each job.
---

# Third Shift Slice brand kit

> **Fictional brand** made for the Specs demo. The business, people, prices and photos are invented. All rights reserved (see the repo README).

Third Shift Slice is a walk-up pizza window in Columbus, Ohio, open till 3am for people getting off a late shift. Style: bold and loud, like a hand-painted sign under a pink neon tube at 2am.

## Chunks

| Chunk | Holds |
| --- | --- |
| `positioning-core.yaml` | What it is, who it's for, the promise, differentiators, and the only facts posts may use |
| `brand-about.md` | Plain-language description and what a night at the window looks like |
| `audience-night-shift.yaml` | The core segment, their barriers, and what wins them |
| `voice-core.md` | How the brand sounds, built on "Hot slice. 2:47am. Window's open." |
| `voice-examples.md` | Lines from the signs, sample lines per post intent, do / don't pairs |
| `terminology.yaml` | Words to use and avoid, with reasons |
| `visual-system.json` | Colors, contrast limits, type roles, shape and spacing |
| `tokens.css` | Generated from visual-system (`npm run tokens -- third-shift-slice`); don't edit |
| `art-direction.md` | Night photography, photo and type together, the three reference shots |
| `social-rules.md` | Sizes, slot lengths, CTA and hashtag style, logo on posts, template per intent |
| `guardrails.yaml` | What never to say or show |
| `_retrieval-rules.yaml` | Which chunks load for each job |

## Which to read

- **Writing a post:** voice-core, visual-system, art-direction, social-rules, terminology; add positioning-core whenever the post states a price or an hour.
- **Critiquing a post:** voice-core, art-direction, guardrails, social-rules.
- **Finding gaps:** this file plus every chunk's summary; open anything marked `needs-review` or `medium`.

## Sources

`../uploads/` holds what a real owner would hand over: `notes-from-tavo.md` (a voice memo typed up), `old-flyer.pdf` (a crooked phone scan of the opening flyer), and three phone photos. The draft brand was approved by Scott on 2026-11-04.

## Known conflicts

Left in on purpose, because a real upload folder disagrees with itself and the intake step should catch it.

| Conflict | Sources | Resolved as |
| --- | --- | --- |
| Hours | `old-flyer.pdf` says Thurs–Sat, 9pm–2am; `photo-01` and `photo-03` say Wed–Sun till 3am; `notes-from-tavo.md` says closing moved to 3 this spring | Wed–Sun, 9pm–3am. The flyer is from opening; Tavo says to ignore its hours. |
| Pepperoni price | `old-flyer.pdf` says $4.50; `photo-01` price board and the notes say $5 | $5. |
| Payment | `old-flyer.pdf` says cash only; `photo-01` and the notes say cash and card | Cash and card. |
