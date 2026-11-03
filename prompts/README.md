# Prompts

Each file has a `# System` section and a `# User` section. Code fills `{{placeholders}}` in the user section and sends the result; it never adds instructions of its own.

| File | Step | Model (see `core/config.ts`) |
| --- | --- | --- |
| `plan.md` | Pick the layout, photo and copy angle | Sonnet 5.5 |
| `write.md` | Fill the template's slots and explain each choice | Sonnet 5.5 |
| `critique.md` | Check the rendered post against the kit; pass or ask for one revision | Haiku 5.5 |
| `read.md` | Extraction step 1: turn one upload into evidence notes, each with where it came from | Sonnet 5.5 |
| `assemble.md` | Extraction step 2: draft one kit chunk (or list the conflicts) from all the evidence notes | Sonnet 5.5 |

The no-kit baseline uses `plan.md` and `write.md` too, with the kit section replaced by a note that there is no kit. Same instructions, same templates, same photos; the only difference is the kit.

All prompts are rights reserved (see the repo README).
