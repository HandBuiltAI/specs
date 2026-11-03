// Loads a prompt file from prompts/ and fills its {{placeholders}}.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPTS_DIR } from "./paths.ts";

export function loadPrompt(name: "plan" | "write" | "critique", values: Record<string, string>) {
  const text = readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8");
  const system = text.match(/^# System\s*\n([\s\S]*?)^# User\s*$/m)?.[1]?.trim();
  const user = text.match(/^# User\s*\n([\s\S]*)$/m)?.[1]?.trim();
  if (!system || !user) throw new Error(`prompts/${name}.md needs a "# System" and a "# User" section`);
  const filled = user.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`prompts/${name}.md uses {{${key}}} but no value was given`);
    return values[key]!;
  });
  return { system, user: filled };
}
