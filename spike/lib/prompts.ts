// Loads a prompt file from prompts/ and fills its {{placeholders}} (see core/prompts.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPTS_DIR } from "./paths.ts";
import { fillPrompt, type PromptName } from "../../core/prompts.ts";

export function loadPrompt(name: PromptName, values: Record<string, string>) {
  return fillPrompt(name, readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8"), values);
}
