# Specs

Specs turns a small business's messy brand materials (logo, website, PDFs, photos) into a structured, agent-readable brand kit, then uses that kit to art-direct on-brand Instagram posts that explain their own design decisions.

It is a public portfolio piece and an open-source repo, not a commercial product. Live at specs.humanbuiltai.work (once launched). The full spec is in `docs/spec.md`; read it before starting any new phase.

## Current phase

**Phase 7: launch and case study (started Nov 5, 2026).** Phases 1–5 passed their gates; phase 6 (signature layer and demos) is built, and its proposed gate is folded into phase 7's launch check. Before launch, intake was reworked after the first live run: code triages gaps (`core/triage.ts`: ask what changes a post, settle what the uploads settle with an Undo, skip the rest; at most 5 calls, prices and dates always asked), the reveal is a mood board, and each call sits beside a live post (`core/preview.ts`).

The app's look is agreed with Scott ("Quiet room. Loud brand."): gray canvas, white cards, Geist and Geist Mono, no color of its own except one signal red meaning "needs your call"; light and dark, following the system, with a switch in the top bar. Tokens are in `app/globals.css`, component styles in `app/ui/catalog.css`. The ten catalog components live in `app/ui/catalog/` (plain React); their props and answers are zod schemas in `core/catalog.ts`, and `app/ui/render.tsx` renders one validated component call. `/catalog` shows them all.

Fill the gaps (`/build`, after the reveal): `POST /api/intake` triages once (`core/triage.ts`), writes the owner's reply into the kit (no model call), runs the completeness check in code (`core/intake.ts`: required items per chunk, no needs-review items, every conflict answered, settled or skipped), and if a planned call remains asks Haiku (`prompts/intake.md`) to word it: one component, one sentence. `{ undo: gapId }` reverts a settlement and makes it the next call.

Make posts from the visitor's own kit (`/build`, after Fill the gaps): `core/session-kit.ts` turns drafted chunks into kit files and tokens; `server/kit-source.ts` gives plan, write and compose one kit shape for demo brands and sessions; `POST /api/posts/compose` (two tries, probe issues as codes only) and `POST /api/posts/baseline` (no-kit version); the browser runs `LAYOUT_PROBE` and falls back to the template.

- Phase 5 gate check: `npm run spike -- spike/intake.ts output/extract-<run-id>` (uses the phase 4 gate's drafted kit; transcript in `output/intake-<run-id>/`).

Phase 4 (for reference):

Uploads become kit chunks with sources, shown on screen as they're drafted (`/build`). Extraction is two steps that each fit the deployed function's ~26 s Claude timeout: `read` (one call per upload → evidence notes) and `assemble` (one call per chunk, plus a conflict check, from the cached evidence). The browser shrinks photos and samples their colors before upload.

- Phase 4 gate check: `npm run spike -- spike/extract.ts half-acre-club` (checklist in `brands/half-acre-club/extraction-check.yaml`, side-by-side page in `output/extract-<run-id>/`).
- Reuse `prompts/`, `templates/` and `brands/` as they are. Shared logic lives in `core/` (no file access), used by both `spike/` and `server/`.
- Account steps (Claude Console workspace and key, Turnstile, Netlify, environment variables) are Scott's; the click-by-click guide is `docs/setup-netlify.md`.

## Repo structure

```
CLAUDE.md                  this file
docs/spec.md               full MVP spec
docs/journal.md            build journal: decisions, dead ends, before/after
brands/<brand>/uploads/    deliberately messy inputs (rough PDF, phone photos, wordy About text)
brands/<brand>/kit/        hand-built brand kit chunks + _retrieval-rules.yaml
templates/                 six HTML/CSS post layouts with named slots
prompts/                   plan.md, write.md, critique.md, read.md and assemble.md (extraction)
core/                      pure shared code: model config, kit chunk selection, prompt filling, schemas
spike/                     TypeScript scripts for the pipeline (phase 2)
app/                       Next.js App Router pages and API routes
server/                    server-only code: guards, Claude client, session and spend storage
server/generated/          prompts, templates and demo kits bundled for the server (npm run content; not committed)
scripts/                   build helpers and the deployed gate check
output/<run-id>/           generated posts, PNGs, and a review index.html per run
```

## Brand kit format

Each kit is a folder of small chunks, one coherent idea each, roughly 200–500 tokens:
`readme.md`, `positioning-core`, `brand-about`, `voice-core`, `voice-examples`, `terminology`, `audience-<name>`, `visual-system.json`, `tokens.css` (generated from visual-system), `art-direction`, `social-rules`, `guardrails`, plus `_retrieval-rules.yaml`.

Every chunk starts with YAML front matter:

```yaml
chunk_id: voice-core
domain: voice
depends_on: [positioning-core]
token_count: 340
confidence: high        # high | medium | needs-review
sources:
  - upload: about-us.pdf
    location: page 2
version: 1
summary: >-
  One or two sentences on what this chunk says.
```

Rules inside chunks state the reason, not just the rule. Prefer concrete examples over adjectives.

## Pipeline (spike)

1. **Plan**: kit + post intent + brief → layout template, photo, copy angle (structured output)
2. **Write**: fill template slots within `social-rules` limits; record a short rationale per decision, citing chunk IDs
3. **Critique**: review against `voice-core`, `art-direction`, `guardrails`; pass or one revision
4. **Render**: fill the HTML template with brand tokens, screenshot to PNG with Playwright
5. **Baseline**: run the same brief with no kit for the with/without comparison
6. **Review page**: write `output/<run-id>/index.html` showing with-kit and no-kit posts side by side, rationale under each

Models: Sonnet 5.5 for extraction (read, assemble), plan and write; Haiku 5.5 for critique (upgrade if it misses issues). Keep the model per step in one config file (`core/config.ts`), shared by the spike and the app.

## Rules

- TypeScript throughout. Node scripts for the spike.
- The API key is read only from `.env` locally (`ANTHROPIC_API_KEY`) and from Netlify environment variables in production. Never hard-code it, log it, commit it, or let it reach the browser: only `server/` code (which imports `server-only`) creates the Claude client.
- Prompts live in `prompts/` as Markdown files, never inline in code.
- Set `max_tokens` on every API call.
- Post copy and layout must come from the kit and brief. Never invent facts about a brand (prices, dates, awards, locations).
- Posts render from HTML/CSS templates, not image generation, so fonts, colors, and logos stay exact.
- Use plan mode before multi-file changes. Commit after each working step.
- When a prompt, kit, or template change affects output quality, add a dated line to `docs/journal.md` saying what changed and what it did.

## Decisions already made

- Name: Specs. Domain: specs.humanbuiltai.work.
- Scope: Instagram 1:1 and 4:5 only. Post intents: promo, announcement, event, testimonial, tip.
- Three fictional demo brands (warm and handmade, bold and loud, minimal and premium), labeled as fictional.
- URL extraction (later phase): Claude web fetch tool, homepage plus one or two pages, capped; paste box fallback.
- A2UI renderer: our own small loop, not CopilotKit (Scott, 2026-11-04): one guarded Haiku call per turn, validated against `core/catalog.ts`; catalog components stay plain React so CopilotKit or `@a2ui/react` can slot in later.
- Layouts (Scott, 2026-11-04): the model composes each post's layout from the kit's `layout-system` chunk (`prompts/compose.md`), checked in code by `core/compose.ts` (copy filled by code, colors and fonts only via kit variables, render probe); the six templates are the fallback. Still HTML/CSS, never image generation.
- License: MIT for code. Fictional brands, prompts, and design assets are all rights reserved, stated in the README.
