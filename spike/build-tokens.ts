// Generates brands/<brand>/kit/tokens.css from visual-system.json.
// Usage: npm run tokens -- <brand>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Color = { hex: string; name: string };
type TypeRole = { stand_in_font: string; weight: number; letter_spacing?: string; line_height?: number; min_px_at_1080?: number };
type VisualSystem = {
  color: Record<string, Color>;
  type: Record<string, TypeRole>;
  shape: { radius_px: number; stamp_rotation_deg: number };
  spacing: { safe_margin_px_at_1080: number; unit_px: number };
  roles?: Record<string, string>;
};

const brand = process.argv[2];
if (!brand) throw new Error("Usage: npm run tokens -- <brand>");

const kitDir = join("brands", brand, "kit");
const vs = JSON.parse(readFileSync(join(kitDir, "visual-system.json"), "utf8")) as VisualSystem;

const lines: string[] = [];
for (const [key, c] of Object.entries(vs.color)) lines.push(`  --color-${key}: ${c.hex}; /* ${c.name} */`);
for (const [role, t] of Object.entries(vs.type)) {
  lines.push(`  --font-${role}: "${t.stand_in_font}", system-ui, sans-serif;`);
  lines.push(`  --weight-${role}: ${t.weight};`);
  if (t.letter_spacing) lines.push(`  --tracking-${role}: ${t.letter_spacing};`);
  if (t.line_height) lines.push(`  --leading-${role}: ${t.line_height};`);
  if (t.min_px_at_1080) lines.push(`  --min-size-${role}: ${t.min_px_at_1080}px;`);
}
lines.push(`  --radius: ${vs.shape.radius_px}px;`);
lines.push(`  --stamp-rotation: ${vs.shape.stamp_rotation_deg}deg;`);
lines.push(`  --safe-margin: ${vs.spacing.safe_margin_px_at_1080}px;`);
lines.push(`  --unit: ${vs.spacing.unit_px}px;`);
// Color roles: the shared post templates use only these, never brand color names.
for (const [role, colorKey] of Object.entries(vs.roles ?? {})) {
  if (role === "note") continue;
  if (!vs.color[colorKey]) throw new Error(`roles.${role} points to unknown color "${colorKey}"`);
  lines.push(`  --role-${role}: var(--color-${colorKey});`);
}

const css = `/* Generated from visual-system.json by spike/build-tokens.ts. Do not edit by hand. */\n:root {\n${lines.join("\n")}\n}\n`;
writeFileSync(join(kitDir, "tokens.css"), css);
console.log(`Wrote ${join(kitDir, "tokens.css")}`);
