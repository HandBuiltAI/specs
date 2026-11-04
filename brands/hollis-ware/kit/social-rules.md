---
chunk_id: social-rules
domain: social
depends_on: [voice-core, visual-system, art-direction]
token_count: 460
confidence: medium
sources:
  - upload: notes-batch-07.md
    location: '"I want the posts to read like the tags"'
  - upload: docs/spec.md
    location: scope (Instagram 1:1 and 4:5; five post intents; six templates)
version: 1
fictional: true
summary: >-
  Instagram sizes, slot lengths, CTA style, caption and hashtag rules, and
  which template suits each post intent for Hollis Ware.
---

# Social rules

> Fictional brand made for the Specs demo. Length limits are drafted to fit the voice; tune them once real posts render.

## Sizes

- **4:5** at 1080 × 1350 for photo-led and offer posts: the extra height is empty space, which is the look.
- **1:1** at 1080 × 1080 for type-led and quote posts.
- Keep 96px clear on every edge (`--safe-margin`). The wide margin is deliberate.

## Slot lengths

| Slot | Limit | Why |
| --- | --- | --- |
| Headline | 5 words, 32 characters | "Batch 07. Forty pieces." Light serif needs room. |
| Subhead | 80 characters | Facts with middle dots: material · count · time. |
| CTA | 3 words | "Online Sunday." "Open studio." No exclamation marks. |
| Badge / label | 14 characters | The tag format, "07 · 12/40", or a price: the post's one clay element. |
| Caption | 2–4 sentences, under 350 characters | Matches the caption pattern in voice-examples. |

## CTA style

State the time or the place: "Online Sunday, 9am." "Open studio, Saturday." Never "Shop now", "Grab yours", or anything with urgency.

## Hashtags

None, or one (`#stoneware`). Never a block.

## Logo on posts

The stacked wordmark ("Hollis" over a small spaced WARE) in charcoal, small, bottom corner. Leave it off quote cards.

## Template by intent

| Intent | First choice | Why |
| --- | --- | --- |
| Announcement | Photo-led (4:5) | Show the batch. |
| Promo | Split | Photo and facts side by side, no badge shouting. |
| Tip | Type-led (1:1) | One care instruction, set large in serif. |
| Event | Event card | Date and hours read at a glance. |
| Testimonial | Quote card | The customer's words with space around them. |
