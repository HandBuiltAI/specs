# Spike scripts

Phase 2 quality spike: plain scripts, no app. Everything writes to `output/` (ignored by git).

## Setup (once)

```sh
npm install                      # also downloads the Chromium that renders posts
cp .env.example .env             # then paste your API key after ANTHROPIC_API_KEY=
```

## Commands

| Command | What it does | Costs money? |
| --- | --- | --- |
| `npm run samples` | Renders all six templates with sample copy, in the brand look and the no-kit look, to `output/samples/` | No |
| `npm run spike -- spike/generate.ts half-acre-club` | Full run: five briefs, with kit and without, then the review page | Yes, roughly $0.50 |
| `npm run spike -- spike/generate.ts half-acre-club --only tip-watering` | Just one brief (ids are in `brands/half-acre-club/briefs.yaml`) | A few cents |
| `npm run spike -- spike/generate.ts half-acre-club --no-baseline` | Kit posts only | Less |
| `npm run review -- output/<run-id>` | Rebuilds a run's review page from its `run.json` | No |
| `npm run tokens -- half-acre-club` | Regenerates `tokens.css` from `visual-system.json` | No |
| `npm run spike -- spike/extract.ts half-acre-club` | Phase 4 gate: extracts a kit from the brand's messy uploads and compares it with the hand-built kit | Yes, roughly $0.30–0.50 |
| `npm run spike -- spike/compose.ts third-shift-slice` | Phase 6: lays out the brand's packed demo posts from its `layout-system` chunk instead of the shared templates, and writes a template-vs-composed page to `output/compose-<run-id>/` (same photo and copy, only the layout changes) | Yes, under $0.50 |
| `npm run review-extract -- output/extract-<run-id>` | Rebuilds an extraction run's page from its `run.json`, scored against the current checklist | No |

Open `output/<run-id>/index.html` in a browser to review a run. Tick "I'd show this to a client" and pick the better post per brief; the tally at the top is the phase 2 gate. **Blind mode** hides the labels and reasoning and shuffles sides, for asking a designer friend.

## Pipeline (per brief)

1. **Plan** (`prompts/plan.md`, Sonnet 5.5): template, photo and angle. Sees the photos themselves.
2. **Write** (`prompts/write.md`, Sonnet 5.5): slot copy, caption and a rationale citing chunk IDs.
3. **Render**: fills the HTML template with the brand's tokens and screenshots it with Playwright.
4. **Checks** (code): slot lengths, required slots, exclamation marks, hashtags, exact testimonial quote, banned terms, text spilling off the canvas.
5. **Critique** (`prompts/critique.md`, Haiku 5.5): reads the rendered PNG and the checks against the kit. On `revise`, steps 2–5 run once more; the second critique is recorded, not acted on.
6. **Baseline**: steps 1–3 with no kit and the neutral look.

The render comes before the critique so the critique can see the actual post (legibility, cut-off text, red elements), not just the copy.

Models, `max_tokens` and effort per step live in `core/config.ts`. Kit chunks per step come from the kit's `_retrieval-rules.yaml` (see `spike/lib/kit.ts`).

## Extraction (phase 4)

`spike/extract.ts` runs the app's extraction with the same prompts, models and code checks, on the uploads listed in `brands/<brand>/extraction-check.yaml`:

1. **Colors** (code): main colors of each photo, sampled the way the browser does it.
2. **Read** (`prompts/read.md`, Sonnet 5.5, low effort): one call per upload, all at once, each giving evidence notes with a location.
3. **Assemble** (`prompts/assemble.md`, Sonnet 5.5, medium effort): one call per kit chunk plus one for conflicts. The evidence is cached text: the first call writes the cache, the rest read it.

Open `output/extract-<run-id>/index.html`. At the top: the checklist score (facts it should find and things it must not invent), and any call slower than 20 seconds, since the deployed app cuts each Claude call off at 26. Below: each extracted chunk next to the hand-built one. The extracted kit is also written as files to `output/extract-<run-id>/kit/`.

## Composed layouts (phase 6)

`spike/compose.ts` tests whether the model can design each post's layout from the brand's `layout-system` chunk, so posts stop looking like the same six templates in different colors. It reuses a brand's packed demo posts (`demo-posts.json`), so the copy and photo are already approved and only the layout changes.

For each post: **compose** (`prompts/compose.md`, Sonnet 5.5) returns HTML and CSS, then code checks it (`core/compose.ts`): copy can only come from the slots (the model leaves `data-slot` elements empty and code fills them), colors and fonts only through the kit's CSS variables, a short list of tags, no inline styles or URLs. The page is rendered and probed for text off the canvas or clipped, overlapping slots, type under 24px, low contrast and copy sitting straight on the photo. Any problem goes back to the model once; if the second try fails too, the post falls back to its template.

### Pack composed layouts into the demo pages

`npx tsx spike/pack-compose.ts output/compose-<run-id>` (free). Re-checks each attempt in the run with the current code check and render probe and saves the first one that passes into `brands/<brand>/demo-posts.json`. Pass several runs for one brand to combine them; later runs win for the posts they cover. Posts with no passing layout keep their template.

## Image-model concept sketches (Nov 6)

Tests whether an image model makes posts bolder, on one post (Third Shift's "$3 slices from 3am - 3:30am!"). An image model (Google Gemini, `SKETCH` in `core/config.ts`) paints three rough concepts from the kit, the copy, the owner's photo and the real logo (`prompts/sketch.md`). Claude rebuilds each in HTML with the bold designer's toolkit plus `prompts/rebuild.md`, under the usual code checks, so the sketch's words and redrawn logo never reach the post. The critic then judges the rebuilds blind beside today's post and the latest `spike/bold.ts` winner.

```sh
npm run spike -- spike/sketch.ts                      # needs GEMINI_API_KEY in .env
npm run spike -- spike/sketch.ts --vs output/bold-<run-id> --takes 2
```

Output: `output/sketch-<run-id>/index.html`, `sheet-posts.png` and `sheet-sketches.png`. About $1 a run (three images at about 13 cents, plus Claude).
