---
chunk_id: layout-system
domain: visual
depends_on: [visual-system, art-direction, social-rules]
token_count: 520
confidence: medium
sources:
  - upload: founder-interview
    location: Specs thread, 2026-11-03 ("a seed packet that's spent a week on the kitchen counter")
  - upload: photo-01-box-opened.jpg
    location: instruction card, kraft box, stamped wordmark
version: 1
fictional: true
summary: >-
  How a Half Acre Club post is composed: like a seed packet and its
  instruction card left on the counter. Cards, tape and stamps on cream,
  a little crooked, with numbered steps and one handwritten red note.
---

# Layout system

> Fictional brand made for the Specs demo.

**The idea:** every post is a printed thing on a kitchen counter: a seed packet, an instruction card, a photo stuck down with masking tape. Nothing floats; everything is a piece of paper with an edge. That's why the brand feels like a box you opened, not an ad.

## Grid and space

- Cream ground, 72px margin. Objects sit on it like paper on a counter: one main card, at most two smaller pieces overlapping it.
- Off-center is fine, crowded is not: leave at least one clear corner.

## Devices (pick one or two per post, never all)

- **The card:** a cream or white-ish panel (`--role-background` with a 3px soil border or a soft shadow) holding the copy, rotated by `--stamp-rotation` at most.
- **Masking tape:** a short translucent strip across a card or photo corner, holding it down. Built from a semi-transparent `--role-background` block, slightly rotated.
- **The stamp:** the wordmark or a box number inside a double-ruled border in pea green, like the ink stamp on the box.
- **One handwritten note** in the hand font, tomato red, with a short drawn underline or circle. Only one red thing per post.
- **Dotted rules** between sections, like a tear line on a packet.

## Type

- Headline in the heading font, sentence case, large (88–130px), can break over two or three lines. Sits on cream or on a card, never over a photo.
- Body in the body font at 34–40px, soil brown.

## Photos

- A photo is a print stuck down: a border of cream around it, taped corners or a slight tilt (within 2°). Or a full-bleed photo with the copy on a taped card over a calm area.

## Never

- Glossy gradients, drop shadows heavier than paper, or perfect symmetry.
- Text set directly over a busy part of a photo.
- More than one red element, or more than two rotated objects.
