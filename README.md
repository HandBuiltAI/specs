# Specs

Specs turns a small business's messy brand materials (a logo, a website, a rough PDF, a few phone photos) into a brand kit an AI can read, then uses that kit to art-direct Instagram posts that explain their own design decisions.

Try it at **[specs.humanbuiltai.work](https://specs.humanbuiltai.work)**. The three demo brands are free and need no upload.

It's a portfolio piece by Scott Galetto, not a commercial product. The full design is in [`docs/spec.md`](docs/spec.md), and [`docs/journal.md`](docs/journal.md) records every decision and dead end along the way.

## What it does

1. **Brand DNA reveal.** Upload your materials and watch the kit assemble on screen. Every item is tagged with the upload it came from, and anything the model is unsure of is marked for review.
2. **Fill the gaps.** A short conversation asks about what's missing or contradictory, one question at a time, each as a small interface component (a palette picker, a font pair, a yes/no) rather than a wall of chat.
3. **Posts that show their work.** Tap a post to see notes pinned to it, each citing the kit rule behind it. Flip to "Without kit" to see the same brief written generically.
4. **Take the kit with you.** Download it as a zip of small Markdown and YAML files that any AI tool, or a freelancer, can use.

The three demo brands are fictional: **Half Acre Club** (a monthly growing kit for renters, warm and handmade), **Third Shift Slice** (a late-night pizza window, bold and loud) and **Hollis Ware** (a one-person ceramics studio, minimal and premium). Specs also ships with [its own brand kit](brands/specs/kit/), written in the same format it makes for others.

## How it works

**The brand kit** is a folder of small chunks, one idea each (positioning, voice, terminology, audience, visual system, layout, art direction, social rules, guardrails), about 200 to 500 tokens apiece. Each chunk starts with front matter saying where it came from and how sure it is. Rules state their reason and prefer concrete examples over adjectives, because a model (or a freelancer) follows "calm, specific, one warm line" with a sample sentence better than "friendly". See [`brands/half-acre-club/kit/`](brands/half-acre-club/kit/) for a complete example.

**Extraction** runs in two steps so each call fits the hosting platform's time limit: one call per upload writes evidence notes, then one call per chunk assembles the kit from that evidence, plus one that only looks for contradictions.

**Posts** go through plan, write and critique, then render as HTML and CSS rather than generated images, so fonts, colors and logos stay exact. The model composes each post's layout from the kit's layout chunk, but code fills in the approved copy, CSS can only reach colors and fonts through the kit's variables, and a browser check catches clipped text, overlaps and low contrast. If a layout fails twice, the post falls back to one of six fixed templates.

**Cost guards.** It's free to try, so every model call goes through a server that owns all prompts, refuses raw prompts and model overrides, caps uploads and posts per session, and stops all generation once the day's spend reaches a limit.

Built with Next.js, TypeScript and the Claude API (Sonnet for extraction and writing, Haiku for critique and the intake conversation), hosted on Netlify.

## Run it locally

You need Node 22 or later and an Anthropic API key.

```bash
git clone https://github.com/HandBuiltAI/specs.git
cd specs
npm install          # also downloads the Chromium the scripts render posts with
cp .env.example .env # then add your ANTHROPIC_API_KEY
npm run dev          # http://localhost:3000
```

The demo brands work without a key. `.env.example` explains each setting; the defaults use Cloudflare's test keys for the bot check and keep sessions in memory.

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the test suite (no API calls) |
| `npm run build` | Type-checks and builds the app |
| `npm run spike -- spike/generate.ts half-acre-club` | Writes posts for a demo brand outside the app, with a review page in `output/` |
| `npm run spike -- spike/extract.ts half-acre-club` | Drafts a kit from a demo brand's messy uploads and compares it to the hand-built one |

Deploying your own copy takes a Claude Console key, a Cloudflare Turnstile key and a Netlify site; [`docs/setup-netlify.md`](docs/setup-netlify.md) walks through it.

## Repo layout

| Folder | What's in it |
| --- | --- |
| `app/` | Next.js pages and API routes |
| `core/` | Shared logic: model config, kit chunk selection, schemas, layout checks |
| `server/` | Server-only code: guards, the Claude client, session and spend storage |
| `prompts/` | Every prompt, as Markdown |
| `templates/` | The six fallback post layouts |
| `brands/` | The demo brands: messy uploads, hand-built kits and precomputed posts |
| `spike/` | Scripts that run the pipeline outside the app |
| `docs/` | The spec, the build journal and the deploy guide |

## License

The code is MIT licensed (see [`LICENSE`](LICENSE)).

The fictional brands (everything under `brands/`, including their names, kits, copy, logos and photos), the prompts in `prompts/`, and the design assets (post templates and the app's look) are © 2026 Scott Galetto, all rights reserved. You're welcome to read them and learn from them, but please don't reuse them in your own projects. The bundled fonts in `assets/fonts/` keep their own open licenses, included beside each font.
