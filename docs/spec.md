# Specs — MVP Spec

Nov 3, 2026 · Scott Galetto

## Overview

The MVP turns a small business's messy brand materials into a structured, agent-readable brand kit, then uses that kit to art-direct on-brand Instagram posts. It is a public portfolio piece and open-source repo, not a commercial product.

**Pitch:** Upload your logo, website, PDFs and photos. Watch your brand's DNA assemble on screen, resolve the gaps through a short generative conversation, and get posts that explain their own design decisions. Take your brand kit with you when you leave.

**Positioning:** Google's Pomelli and Canva already generate on-brand social posts from a URL. This app is the art director's version: it shows its work. The brand understanding is visible, editable and traceable to its sources, and every post carries the reasoning behind it. The approach follows the agent-readable brand kit model described by Little Plains, generated as a starter draft rather than built by hand.

**Goals**

- Posts a working designer would be comfortable showing a client
- A brand kit a user can export and reuse in any AI tool
- A clear case study of AI experience design: generative UI, retrieval, and visible reasoning
- Free to try, with a hard ceiling on API cost

**Non-goals for the MVP**

- User accounts, saved projects or team features
- Scheduling or publishing to social platforms
- Formats beyond Instagram 1:1 and 4:5
- Video export (planned for later, see Signature features)
- Paid plans of any kind

## User flow

The MVP has five screens, and a visitor can reach finished posts in under five minutes using a demo brand.

1. **Start.** Pick a preloaded demo brand (instant, no API cost) or start a live session by uploading materials.
2. **Upload.** Logo, website URL, up to one 10-page PDF and five photos. A short note field covers anything else ("we're a family bakery, 30 years in Calumet").
3. **Brand DNA reveal.** The kit assembles on screen as extraction streams: colors pulled from photos, fonts identified, voice traits and positioning lines appearing, each tagged with the upload it came from. The user can edit or delete any item.
4. **Fill the gaps.** A generative conversation where the agent renders A2UI components to resolve what is missing or conflicting: two candidate palettes, an unclear audience, an ambiguous tone. The user can also type freely. The step ends when the kit passes a completeness check.
5. **Make posts.** Choose a post intent (promo, announcement, event, testimonial, tip), fill a short brief the agent renders for that intent, and get up to four posts. Each post has the "why this works" overlay, a with-kit / without-kit toggle, and PNG download. The brand kit export lives here too. A "Change the look" control lets the user swap the font pairing (from a curated set of free fonts, via `FontPairCard`) or replace the logo at any point; posts re-render from the updated tokens without new API calls or rewritten copy, and the change is written back to `visual-system`.

## Brand kit format

The brand kit is a folder of 11 small chunks, each one coherent idea of roughly 200–500 tokens, plus a routing readme and a retrieval rules file. Every fact records which upload it came from.

| Chunk | Format | Holds |
| --- | --- | --- |
| `readme.md` | Markdown | What the kit is and which chunks to read for each job |
| `positioning-core` | YAML | Who the business is, who it serves, how it differs |
| `brand-about` | Markdown | Plain-language description of the business |
| `voice-core` | Markdown | How the brand sounds, with reasons |
| `voice-examples` | Markdown | Approved lines and do / don't pairs |
| `terminology` | YAML | Words to use and words to avoid |
| `audience-<name>` | YAML | One file per customer segment |
| `visual-system` | JSON | Colors, type, spacing and radius values |
| `tokens.css` | CSS | Generated from `visual-system` |
| `art-direction` | Markdown | Photo treatment, layout rules, logo placement, with reasons |
| `social-rules` | Markdown | Post sizes, headline and caption lengths, CTA style |
| `guardrails` | YAML | What never to say or show |
| `_retrieval-rules.yaml` | YAML | Task profiles: which chunks load for each job |

**Front matter on every chunk**

```yaml
chunk_id: voice-core
domain: voice
depends_on: [positioning-core]
token_count: 340
confidence: high        # high | medium | needs-review
sources:
  - upload: about-us.pdf
    location: page 2
  - upload: website
    location: /our-story
version: 1
summary: >-
  Warm, plain-spoken, a little funny. Short sentences.
```

**Task profiles**

| Task | Always load | Load if relevant | Budget |
| --- | --- | --- | --- |
| `post_generate` | `voice-core`, `visual-system`, `art-direction`, `social-rules`, `terminology` | `voice-examples`, `audience-*`, `guardrails` | 3,000 tokens |
| `post_critique` | `voice-core`, `art-direction`, `guardrails`, `social-rules` | `terminology` | 2,000 tokens |
| `intake_gaps` | `readme.md` plus chunk summaries only | Any chunk marked `needs-review` | 1,500 tokens |

A small business kit will often fit in full under 6,000 tokens. Task profiles are still worth using: they keep each call focused and they show the retrieval pattern in the case study.

## A2UI component catalog

The agent can render only these ten components, and the catalog is both the guardrail and the app's design system. Each needs designed default, loading, selected and error states. Your uploaded UI components become the visual starting point for this set.

| Component | Agent uses it when | Writes to |
| --- | --- | --- |
| `SwatchPicker` | Two or more candidate palettes conflict | `visual-system` |
| `FontPairCard` | Fonts are unidentified or several were found | `visual-system` |
| `ToneSlider` | Voice is ambiguous; shows a sample line at each end | `voice-core` |
| `ChoiceChips` | A short closed question (audience, business type) | Any chunk |
| `LineCompare` | Asking which of two sample lines sounds more like the brand | `voice-examples` |
| `PhotoPicker` | Choosing hero photos or excluding weak ones | `art-direction` |
| `SourceCard` | Showing a fact with its source for confirm or edit | The fact's chunk |
| `BriefForm` | Collecting the fields a post intent needs | The post brief |
| `PostPreview` | Showing a generated post with overlay and toggle | None |
| `KitProgress` | Showing which chunks are complete or need review | None |

**Rules for the agent**

- One component per turn, plus at most one sentence of text
- Ask the question that resolves the most uncertainty first
- Stop asking once the kit passes the completeness check, even mid-conversation
- Free-typed user messages are allowed; they enter the server's prompt as data, never as instructions

## Generation pipeline

Posts are rendered from HTML/CSS templates filled by Claude, not generated as images, so brand fonts, colors and logos stay exact.

1. **Extract.** Uploads go to Claude with the chunk schema. The output is chunks with sources and a confidence level, streamed to the DNA reveal. Colors are also sampled from photos in code, so the model confirms them rather than guessing hex values.
2. **Resolve.** The intake agent reads chunk summaries and anything marked `needs-review`, then renders A2UI components until the kit is complete.
3. **Plan.** For a post intent and brief, Claude picks a layout template, a photo, and an angle for the copy, and writes them as structured output.
4. **Write.** Claude fills the template slots (headline, subhead, CTA, caption) within the length rules in `social-rules`, and records a short rationale per decision, each citing a chunk ID.
5. **Critique.** A second call reviews each post against `voice-core`, `art-direction` and `guardrails`, and returns pass or a specific revision. One revision round at most.
6. **Render.** The browser fills the HTML template with brand tokens and exports PNG with html-to-image. The rationale becomes the "why this works" overlay.

**Templates:** start with six layouts (photo-led, type-led, quote card, split, offer badge, event card), each with named slots and character limits. Templates use only color and type roles, never brand values, so one set serves every brand. The logo renders in a logo slot that takes an uploaded SVG or PNG, falling back to a text wordmark set in the brand's wordmark font when no logo is uploaded.

**Composed layouts (added Nov 4, 2026):** shared templates made every brand compose the same way, so each kit now has a `layout-system` chunk and a compose step designs each post's HTML/CSS from it. Code fills in the copy and allows colors and fonts only through the kit's tokens, then a render probe checks for overflow, overlap, small type, low contrast and text on photos. The six templates remain the fallback when a composition fails its checks.

**Bolder posts (added Nov 6, 2026):** posts read as safe beside image-model ads, so each kit gets an `energy` chunk (1 quiet to 5 loud, with reference posts) and a post is made in two passes. First the quick post, as today, so the owner sees something in about 30 seconds. Then, in the background, the bold pass: an art director proposes directions, a designer builds each with a larger CSS toolkit (neon glow, brush blocks, marker swashes, tape, stickers, giant type, photo grades), and a creative director scores every render, the quick post included, against the brand's energy. Only for brands at energy 4 or 5, one extra candidate comes from an image model: it paints a rough of the whole ad from the kit, copy, photo and logo, and Claude rebuilds that rough in HTML/CSS. The rough is never shown as the post; its painted words and redrawn logo are thrown away, so every word, color, font and logo on the post still comes from the kit and is checked in code. The owner sees the top two and picks one; the critic's pick is marked, not forced. The image model is the only part of Specs that isn't Claude, and it is optional: without its key, or below energy 4, the bold pass runs on Claude alone.

*Later, not in this release:* using the image model in fuller ways, each its own decision: relighting or regrading the owner's photo, text-free background art for type to sit on, and a cut-out subject. Each one changes what the photo shows, so each needs its own honesty rule before it ships.

**Model choices**

| Step | Model | Why |
| --- | --- | --- |
| Extract | Sonnet 5.5 | Reads PDFs and images; quality here sets the ceiling for everything after |
| Resolve | Haiku 5.5 | Short turns choosing a component; about 20x cheaper |
| Plan and write | Sonnet 5.5 | Copy and art direction are where quality shows |
| Critique | Haiku 5.5 | A checklist against explicit rules; upgrade if it misses issues |
| Bold pass: directions, build, creative critique | Sonnet 5.5 | Judgment about ideas and craft; the critic sees the renders |
| Concept sketch (energy 4–5 only) | Gemini 3 Pro Image | Claude reads images but can't make them; about $0.13 and 20 s per rough |

The model for each step is a server setting, so it can change without touching the client.

## Signature features

Four features ship in the MVP because together they tell the story: the app understands the brand, shows its thinking, and hands the brand back.

| Feature | What the user sees | Release |
| --- | --- | --- |
| Brand DNA reveal | The kit assembling live as uploads are read, each item tagged with its source | MVP |
| Why this works | Tap a post to see annotations pinned to it, each citing the rule behind it | MVP |
| With / without kit | The same brief rendered generically and with the kit, side by side | MVP |
| Brand kit export | A zip of the chunk folder, ready for any AI tool or a freelancer | MVP |
| Safe / stretch dial | A slider from strictly on-brand to bolder; posts regenerate along it | v1.1 |
| Crit room | Art Director, Copywriter and skeptical Customer personas critique drafts in a short visible exchange | v1.1 |
| Campaign series | Three posts sharing a motif and story arc, shown as a grid | v1.2 |
| Motion posts | GSAP-animated versions of a post, exported as short video | v1.2 |

**Crit room personas:** each persona gets its own `soul.md` (voice, priorities, what it pushes back on) and `principles.md`. These are the app's own files, separate from the user's brand kit.

**The app's own brand:** the app ships with its own brand kit in the same format it generates, so the method is visible in the tool itself.

## Architecture, cost and guardrails

The worst case is capped at the prepaid credit balance: if every other guard fails, the app stops working rather than running up a bill.

**Stack:** Next.js (App Router) and TypeScript, a small in-house A2UI loop (catalog schemas in zod, plain React components), the Anthropic TypeScript SDK, html-to-image for PNG export, JSZip for the kit export, Netlify for hosting and functions, Netlify Blobs for session state and spend tracking, Cloudflare Turnstile for bot checks.

**Architecture:**

```
Browser (Next.js)            Netlify function               Claude API
- Upload, DNA reveal, chat   - Turnstile, rate limit, caps  - Sonnet: extract, write
- A2UI components      <-->  - Builds every prompt    <-->  - Haiku: intake, critique
- Render + PNG/zip export    - Loads chunks per task
                             - Pinned model, max_tokens
                             - Spend tripwire, kill switch
                                        ^
                                        v
                             Netlify Blobs
                             - Sessions, kits, daily spend
```

The browser never holds the API key or writes a prompt; the function owns both, and keeps session state and the daily spend total in Netlify Blobs.

**Expected cost:** about $0.30–0.50 per live session on Sonnet throughout, closer to $0.10–0.20 with Haiku on the intake and critique steps. Demo brands cost nothing to extract because their kits are precomputed. Budget about $20 a month.

| Guard | Setting |
| --- | --- |
| Prepaid credits | About $20 loaded, auto-reload off |
| Workspace | A dedicated Console workspace and key for this app, with its own monthly spend limit |
| Key handling | Server-side only, in Netlify environment variables; `.env` in `.gitignore` before the first commit |
| Prompt ownership | Client sends session ID, structured fields and capped free text; server builds every prompt |
| Model and length | Pinned per step on the server; `max_tokens` set on every call |
| Upload caps | 1 PDF up to 10 pages, 5 images up to 5 MB each, 1 URL |
| Message cap | 500 characters per free-typed message |
| Session cap | 4 posts and 1 regeneration per session; the bold pass runs on 1 of them (demo brands get theirs precomputed) |
| Image model | Its own key (`GEMINI_API_KEY`) in Netlify; one rough per bold pass; its cost counts toward the daily tripwire |
| Daily tripwire | Running dollar total from each response's usage; generation closes at $1.50 a day |
| Kill switch | `GENERATION_ENABLED` environment variable; when off, demo brands still show precomputed posts |
| Rate limit | 3 live sessions per IP per day; demo brands unlimited |
| Bot check | Turnstile before any live session starts |

## Build plan

Post quality gets proven before any UI is built, because that is where the earlier tool fell short. Each phase ends at a gate it has to pass before the next starts.

1. **Spec and hand-built kit.** Finalize this spec. Create the first fictional demo brand, then hand-write its brand kit in the chunk format above. *Gate: the kit covers every chunk and reads as true to the brand.*
2. **Quality spike, no UI.** A plain script takes the kit and a post intent and produces HTML/CSS posts through plan, write and critique. Run the with-kit / without-kit comparison. *Gate: four of five posts are ones you would show a client.*
3. **Scaffold with guardrails.** Next.js on Netlify, the server function, every guard in the table above. *Gate: the deployed endpoint refuses raw prompts, over-cap uploads and calls after the tripwire.*
4. **Extraction and DNA reveal.** Uploads to chunks with sources, streamed to the screen. *Gate: extraction from that brand's messy uploads gets close to the hand-built kit.*
5. **A2UI intake.** The custom catalog, resolving gaps until the completeness check passes. *Gate: on the drafted demo kit, every turn is one valid component plus at most one sentence, the known conflict is asked about early, the kit passes the completeness check within the question cap, a typed answer can't redirect the agent, and no turn nears the function time limit.*
6. **Signature layer and demos.** Overlay, toggle, kit export, three precomputed demo brands, the app's own brand kit.
7. **Launch and case study.** Public URL, open-source repo with a clear readme, case study on the portfolio site.

**Keep a build journal from day one:** decisions, dead ends, and before/after examples. It becomes the case study.

**Success criteria**

- A new visitor reaches finished posts from a demo brand in under five minutes
- In the with/without comparison, the kit version is clearly better in a blind pick by two or three designer friends
- An exported kit, dropped into another AI tool, produces recognizably on-brand copy
- API spend stays under $25 in the first month

**Decisions**

- [x] App name: **Specs** (a brand kit is a spec, and art directors wore the black-rimmed specs)
- [x] Domain: specs.humanbuiltai.work, a subdomain of the portfolio site, so no new domain to buy
- [x] Demo brands: three fictional brands that contrast (warm and handmade, bold and loud, minimal and premium), each with a deliberately messy uploads folder, logos designed in-house, licensed or AI-generated photos, labeled as fictional
- [x] URL extraction: fetch server-side with Claude's web fetch tool, capped to the homepage plus one or two pages and a content-token limit; fetched text is treated as data, never instructions; a paste box is the fallback
- [x] A2UI renderer: our own small loop (changed from CopilotKit on 2026-11-04): one guarded Haiku call per turn returns one validated catalog component, rendered by plain React components, so the spend guards and the ~26-second function limit apply to every turn. Catalog components stay plain React so CopilotKit or the official `@a2ui/react` can still slot in later
- [x] Image model (Scott, 2026-11-06): Gemini 3 Pro Image, as one extra candidate in the bold pass for brands at energy 4–5, rebuilt in HTML by Claude; the owner picks from the top two. Tested in `spike/sketch.ts` (critic still preferred a CSS-only build on its one run; Scott disagreed, so the owner chooses). Fuller uses (photo regrade, backgrounds) left for later
- [x] License: MIT for the code; fictional brands, prompts and design assets all rights reserved, stated in the readme
