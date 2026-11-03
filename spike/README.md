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
