# Specs

Specs turns a small business's messy brand materials (logo, website, PDFs, photos) into a structured, agent-readable brand kit, then uses that kit to art-direct on-brand Instagram posts that explain their own design decisions.

It is a public portfolio piece and an open-source repo, not a commercial product. Live at specs.humanbuiltai.work (once launched). The full spec is in `docs/spec.md`; read it before starting any new phase.

## Current phase

**Phase 4: extraction and the Brand DNA reveal. Gate passed on Nov 3, 2026 (checklist 20 of 20, no timeouts on the deployed `/build`); phase 5 (A2UI intake) is next.** Phases 1–3 passed on Nov 3, 2026.

Uploads become kit chunks with sources, shown on screen as they're drafted (`/build`). Extraction is two steps that each fit the deployed function's ~26 s Claude timeout: `read` (one call per upload → evidence notes) and `assemble` (one call per chunk, plus a conflict check, from the cached evidence). The browser shrinks photos and samples their colors before upload. The reveal is plain on purpose: the app's look arrives with the component catalog in phase 5, so decide it with Scott before building the catalog.

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
- A2UI renderer (later phase): CopilotKit; catalog components stay plain React.
- License: MIT for code. Fictional brands, prompts, and design assets are all rights reserved, stated in the README.
