// Splits a prompt file from prompts/ into its system and user sections and fills the
// user section's {{placeholders}}. Pure: callers pass the file's text.

export type PromptName = "plan" | "write" | "critique" | "read" | "assemble";

export function fillPrompt(name: PromptName, text: string, values: Record<string, string>) {
  const system = text.match(/^# System\s*\n([\s\S]*?)^# User\s*$/m)?.[1]?.trim();
  const user = text.match(/^# User\s*\n([\s\S]*)$/m)?.[1]?.trim();
  if (!system || !user) throw new Error(`prompts/${name}.md needs a "# System" and a "# User" section`);
  const filled = user.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`prompts/${name}.md uses {{${key}}} but no value was given`);
    return values[key]!;
  });
  return { system, user: filled };
}

/**
 * Free text as data: drops control characters and swaps angle brackets for look-alikes, so a
 * visitor can't close the prompt's tags (<brief>, <upload>) or open a tag of their own.
 */
export function asData(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .trim();
}
