---
chunk_id: social-rules
domain: social
depends_on: [voice-core, visual-system, art-direction]
token_count: 530
confidence: medium
sources:
  - upload: founder-interview
    location: Specs thread, 2026-11-03 (voice and look)
  - upload: docs/spec.md
    location: scope (Instagram 1:1 and 4:5; five post intents; six templates)
version: 1
fictional: true
summary: >-
  Instagram sizes, slot lengths, CTA style, caption and hashtag rules, and
  which template suits each post intent for Half Acre Club.
---

# Social rules

> Fictional brand made for the Specs demo. Length limits are drafted to fit the voice; tune them once real posts render.

## Sizes

- **1:1** at 1080 × 1080 for type-led and quote posts.
- **4:5** at 1080 × 1350 for photo-led posts, because the extra height gives the photo room and keeps copy off it.
- Keep 72px clear on every edge (`--safe-margin`).

## Slot lengths

| Slot | Limit | Why |
| --- | --- | --- |
| Headline | 6 words, 40 characters | The reference line works in fragments of one to three words. |
| Subhead | 90 characters, one or two sentences | One concrete detail, not a pitch. |
| CTA | 3 words | A plain action, no exclamation mark. |
| Badge / label | 12 characters | A box number or date: the post's one red element. |
| Caption | 3–5 sentences, under 400 characters | Matches the caption pattern in voice-examples. |

## CTA style

Plain verbs that describe the next physical step: "Get Box 01", "Join the club", "Start on the sill". Never "Shop now!", "Don't miss out", or urgency the facts don't support. "Link in bio" goes in the caption, not on the image.

## Hashtags

Zero to three, at the end of the caption, specific to the project (`#peashoots`, `#windowsillgarden`). Never a block of twenty.

## Logo on posts

The stacked wordmark ("Half Acre" in italic over a small, spaced CLUB), small, in a corner, in pea green on cream. It signs the post; the photo or headline carries it. Leave it off quote cards where the wordmark would compete with the quote.

## Template by intent

| Intent | First choice | Why |
| --- | --- | --- |
| Announcement | Photo-led (4:5) | A new box is best shown, not described. |
| Promo | Offer badge | Price and "cancel anytime" are the facts that move people; the badge is the red element. |
| Tip | Type-led (1:1) | The instruction is the content; legibility wins. |
| Event | Event card | Date and place must read at a glance. |
| Testimonial | Quote card | The member's words, nothing competing. |
