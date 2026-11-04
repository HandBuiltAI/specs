---
chunk_id: social-rules
domain: social
depends_on: [voice-core, visual-system, art-direction]
token_count: 480
confidence: medium
sources:
  - upload: notes-from-tavo.md
    location: '"loud, short, a little funny"'
  - upload: docs/spec.md
    location: scope (Instagram 1:1 and 4:5; five post intents; six templates)
version: 1
fictional: true
summary: >-
  Instagram sizes, slot lengths, CTA style, caption and hashtag rules, and
  which template suits each post intent for Third Shift Slice.
---

# Social rules

> Fictional brand made for the Specs demo. Length limits are drafted to fit the voice; tune them once real posts render.

## Sizes

- **1:1** at 1080 × 1080 for type-led, quote and offer posts.
- **4:5** at 1080 × 1350 for photo-led posts, so the window or the slice gets the height.
- Keep 64px clear on every edge (`--safe-margin`).

## Slot lengths

| Slot | Limit | Why |
| --- | --- | --- |
| Headline | 6 words, 36 characters, capitals | The wall line is three fragments; Anton gets loud fast. |
| Subhead | 80 characters | Prices or hours, not a pitch. |
| CTA | 3 words | "Walk up." "Window's open." No exclamation marks. |
| Badge / label | 10 characters | A price or an hour: the post's one pink element. |
| Caption | 2–4 sentences, under 300 characters | Matches the caption pattern in voice-examples. |

## CTA style

Say where and when, not "click". "Window's open." "Till 3am." "Walk up." Never "Order now!" (there's no ordering) or "Link in bio" (there's nothing to buy online).

## Hashtags

Zero to two, at the end of the caption: `#columbuspizza`, `#nightshift`. Never a block.

## Logo on posts

The stacked wordmark (THIRD SHIFT over a spaced SLICE) in neon pink, small, bottom corner. It's the post's pink element unless a price stamp is; then the wordmark still shows, since a wordmark and a stamp read as two different things.

## Template by intent

| Intent | First choice | Why |
| --- | --- | --- |
| Announcement | Photo-led (4:5) | Show tonight's slice or the window. |
| Promo | Offer badge | Prices are the pitch; the stamp is the pink element. |
| Tip | Type-led (1:1) | One line, painted big. |
| Event | Event card | Date and hour read at a glance. |
| Testimonial | Quote card | A regular's words, with their job and the time. |
