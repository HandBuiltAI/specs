---
chunk_id: social-rules
domain: social
depends_on: [voice-core, visual-system, art-direction]
token_count: 420
confidence: medium
sources:
  - upload: docs/spec.md
    location: scope (Instagram 1:1 and 4:5; five post intents; six templates)
version: 1
summary: >-
  Instagram sizes, slot lengths, CTA and hashtag style, and the template for
  each post intent when Specs posts about itself.
---

# Social rules

Drafted for when Specs posts about itself; tune once real posts render.

## Sizes

- **4:5** at 1080 × 1350 for screenshots and announcements.
- **1:1** at 1080 × 1080 for type-led tips.
- Keep 72px clear on every edge.

## Slot lengths

| Slot | Limit | Why |
| --- | --- | --- |
| Headline | 7 words, 42 characters | "Your brand, written down for machines." |
| Subhead | 90 characters | One concrete sentence: what it does or why. |
| CTA | 3 words | "Try a demo." "Read the kit." No exclamation marks. |
| Badge / label | 16 characters, mono | A source tag or chunk ID, never a price. |
| Caption | 2–4 sentences, under 400 characters | Ends with the URL. |

## CTA style

Say where and what: "Try a demo at specs.humanbuiltai.work." Never "Sign up now" (there are no accounts) or "Link in bio!".

## Hashtags

None, or one (`#branddesign`). Never a block.

## Logo on posts

The wordmark, "Specs" with the red dot, ink on gray, small, bottom corner.

## Template by intent

| Intent | First choice | Why |
| --- | --- | --- |
| Announcement | Photo-led (4:5) with a screenshot | Show it working. |
| Promo | Split | The with-kit post beside the without-kit post. |
| Tip | Type-led (1:1) | One kit-writing idea, set large. |
| Event | Event card | Date and place at a glance. |
| Testimonial | Quote card | Only a quote the brief supplies. |
