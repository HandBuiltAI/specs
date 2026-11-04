---
chunk_id: layout-system
domain: visual
depends_on: [visual-system, art-direction, social-rules]
token_count: 520
confidence: medium
sources:
  - upload: photo-01-window-at-night.jpg
    location: painted banner, price board, taped paper signs, pink neon
  - upload: old-flyer.pdf
    location: stacked capitals, prices as big as the headline
version: 1
fictional: true
summary: >-
  How a Third Shift Slice post is composed: like the window at 2am. Huge
  stacked capitals that hit the edges, paper signs taped up crooked, prices as
  loud as headlines, and one pink glow.
---

# Layout system

> Fictional brand made for the Specs demo.

**The idea:** a post is the window itself: a black wall with hand-painted yellow capitals, paper signs taped on at angles, and one pink neon thing. It's loud because it's read from across the street by someone tired.

## Grid and space

- Black ground. Type goes big enough to nearly touch the 64px margin on both sides: scale headlines so the longest line fills the width.
- Stack, don't spread: words on separate lines, tight leading (0.85–0.95), no gaps between lines.
- Break the grid once per post: one element crooked, overlapping, or bleeding off an edge.

## Devices (pick one or two per post)

- **The painted wall line:** the headline in sign yellow, stacked capitals, set as large as it will go (140–260px).
- **The taped sign:** a paper-colored panel (`--role-text` paper on black) with black marker lettering, rotated 2–4°, a strip of tape at the top. For hours, a price, a rule.
- **The price as hero:** a price or time set as big as the headline, in yellow or paper.
- **The neon:** one pink element only, the wordmark, a marker underline, or a circled price. Can glow (a pink `text-shadow` or `box-shadow`).
- **The menu board:** a two-column list with dotted leaders between item and price, like the board in the window.

## Type

- Headlines in the heading font, all capitals, condensed, enormous.
- Supporting text in the body font, 34–44px, paper color.
- Marker font for one hand-lettered line or label, never for the headline.

## Photos

- Full bleed and dark, or a hard-edged block that runs off one side. Put type on black, or on a taped paper sign over the photo, never straight over the busy middle.

## Never

- Centered, airy layouts with small type: the brand never whispers.
- Rounded corners, soft pastels, or gradients other than the neon glow.
- More than one pink element.
