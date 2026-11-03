// Scores an extraction run against the brand's checklist and writes the comparison page and the
// extracted kit files. Shared by spike/extract.ts and spike/review-extract.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXTRACT_CHUNKS, renderChunk, type ChunkDraft, type Conflicts, type Evidence, type SampledColors, type UploadKind } from "../../core/extract.ts";

export type Check = { id: string; what: string; chunks: string[]; find?: string[]; never?: string[] };
export type ExtractRun = {
  runId: string;
  brand: string;
  createdAt: string;
  wallSeconds: number;
  uploads: { file: string; kind: UploadKind; label: string }[];
  sampled: SampledColors[];
  evidence: { upload: string; kind: UploadKind; evidence: Evidence }[];
  chunks: Record<string, { draft: ChunkDraft; warnings: string[] } | { conflicts: Conflicts["conflicts"]; warnings: string[] }>;
  calls: { name: string; seconds: number; usd: number; input: number; output: number; cacheRead: number; ok: boolean; error?: string }[];
  checks: Check[];
  handBuilt: Record<string, string>;
};

/** The deployed app gives each Claude call 26 seconds. Anything near that would fail live. */
const LIVE_LIMIT_S = 26;
const WARN_S = 20;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function chunkText(run: ExtractRun, id: string): string {
  const c = run.chunks[id];
  if (!c) return "";
  if ("conflicts" in c) return c.conflicts.map((x) => `${x.about}\n${x.sides.map((s) => `${s.says} (${s.source.upload})`).join("\n")}\n${x.suggestion}`).join("\n\n");
  return renderChunk(id as (typeof EXTRACT_CHUNKS)[number]["id"], c.draft);
}

export function scoreChecks(run: ExtractRun) {
  return run.checks.map((check) => {
    const text = check.chunks.map((id) => chunkText(run, id)).join("\n").toLowerCase();
    if (!check.chunks.some((id) => run.chunks[id])) return { ...check, pass: false, missing: ["(none of these chunks was drafted)"], invented: [] as string[] };
    const missing = (check.find ?? []).filter((p) => !new RegExp(p, "i").test(text));
    const invented = (check.never ?? []).filter((p) => new RegExp(p, "i").test(text));
    return { ...check, pass: missing.length === 0 && invented.length === 0, missing, invented };
  });
}

function handBuiltFor(run: ExtractRun, id: string): string {
  const file = Object.keys(run.handBuilt).find((f) => f.replace(/\.(md|ya?ml|json)$/, "") === id || (id === "audience" && f.startsWith("audience-")));
  return file ? run.handBuilt[file]! : "(no hand-built chunk)";
}

const swatches = (s: string) => (s.match(/#[0-9a-f]{6}\b/gi) ?? []).map((h) => `<span class="sw" style="background:${h}"></span>`).join("");

function extractedHtml(run: ExtractRun, id: string): string {
  const c = run.chunks[id];
  if (!c) return `<p class="bad">Not drafted (the call failed).</p>`;
  if ("conflicts" in c) {
    if (!c.conflicts.length) return "<p>No conflicts found.</p>";
    return c.conflicts
      .map((x) => `<div class="item"><b>${esc(x.about)}</b><ul>${x.sides.map((s) => `<li>${esc(s.says)} <span class="src">${esc(s.source.upload)} · ${esc(s.source.location)}</span></li>`).join("")}</ul><p class="muted">${esc(x.suggestion)}</p></div>`)
      .join("");
  }
  const d = c.draft;
  return `<p class="muted">${esc(d.summary)} <span class="conf ${d.confidence}">${d.confidence}</span></p>${d.items
    .map(
      (i) =>
        `<div class="item"><div class="label">${esc(i.label)} ${i.confidence === "high" ? "" : `<span class="conf ${i.confidence}">${i.confidence}</span>`}</div><div>${swatches(i.value)}${esc(i.value)}</div>${
          i.why ? `<div class="muted">Why: ${esc(i.why)}</div>` : ""
        }<div>${i.sources.map((s) => `<span class="src">${esc(s.upload)} · ${esc(s.location)}</span>`).join(" ")}</div></div>`,
    )
    .join("")}${d.missing.length ? `<p><b>Missing:</b> ${esc(d.missing.join("; "))}</p>` : ""}${c.warnings.map((w) => `<p class="muted">⚠ ${esc(w)}</p>`).join("")}`;
}

export function writeExtractReview(runDir: string, run: ExtractRun): string {
  // The extracted kit as files, in the same format as the hand-built one.
  const kitOut = join(runDir, "kit");
  mkdirSync(kitOut, { recursive: true });
  for (const c of EXTRACT_CHUNKS) {
    const rec = run.chunks[c.id];
    if (rec && "draft" in rec) writeFileSync(join(kitOut, `${c.id}.md`), renderChunk(c.id, rec.draft));
  }
  const conflicts = run.chunks.conflicts;
  if (conflicts && "conflicts" in conflicts) writeFileSync(join(kitOut, "conflicts.json"), JSON.stringify(conflicts.conflicts, null, 2));

  const scored = scoreChecks(run);
  const passed = scored.filter((s) => s.pass).length;
  const usd = run.calls.reduce((n, c) => n + c.usd, 0);
  const slow = run.calls.filter((c) => c.seconds >= WARN_S);
  const tooSlow = run.calls.filter((c) => c.seconds >= LIVE_LIMIT_S);
  const failed = run.calls.filter((c) => !c.ok);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Extraction ${esc(run.runId)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;color:#1b1b1b;background:#fbfaf7;margin:0;padding:2rem 1rem 4rem}
main{max-width:76rem;margin:0 auto}h1{margin:0 0 .25rem}h2{margin:2.5rem 0 .75rem}
.muted{color:#6b6b6b}.bad{color:#a3271b}.good{color:#2f6b3a}
table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #e2dfd8;padding:.4rem .6rem;text-align:left;vertical-align:top;font-size:.9rem}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:1rem}@media(max-width:800px){.cols{grid-template-columns:1fr}}
.panel{background:#fff;border:1px solid #e2dfd8;border-radius:8px;padding:1rem;overflow:auto}
pre{white-space:pre-wrap;font-size:.8rem;margin:0}
.item{border-top:1px solid #eee;padding:.5rem 0}.label{font-size:.8rem;font-weight:600;color:#6b6b6b}
.src{font-size:.75rem;background:#f1efe9;border-radius:4px;padding:0 .35rem;margin-right:.25rem}
.conf{font-size:.7rem;text-transform:uppercase;border-radius:99px;padding:0 .45rem;background:#eef3ec;color:#2f6b3a}.conf.medium{background:#f6f0e1;color:#7a5a12}.conf.needs-review{background:#f8e9e6;color:#a3271b}
.sw{display:inline-block;width:1rem;height:1rem;border-radius:3px;border:1px solid rgba(0,0,0,.15);vertical-align:-.15rem;margin-right:.3rem}
.big{font-size:1.4rem;font-weight:700}
</style></head><body><main>
<h1>Extraction: ${esc(run.brand)}</h1>
<p class="muted">${esc(run.runId)} · ${run.uploads.length} uploads · ${run.calls.length} calls · $${usd.toFixed(2)} · ${run.wallSeconds.toFixed(0)} s end to end</p>

<p class="big">Checklist: ${passed} of ${scored.length}</p>
<p>Calls over ${WARN_S} s: <b class="${slow.length ? "bad" : "good"}">${slow.length}</b> · over the live ${LIVE_LIMIT_S} s limit: <b class="${tooSlow.length ? "bad" : "good"}">${tooSlow.length}</b> · failed: <b class="${failed.length ? "bad" : "good"}">${failed.length}</b></p>
<p class="muted">The gate: extraction from the messy uploads gets close to the hand-built kit. The checklist covers facts the uploads hold; read the side-by-sides below for the rest. Price, founder and city came from an interview, so the hand-built kit has them and a good extraction lists them as missing.</p>

<h2>Checklist</h2>
<table><tr><th></th><th>Check</th><th>In</th><th>Problem</th></tr>
${scored.map((s) => `<tr><td class="${s.pass ? "good" : "bad"}">${s.pass ? "✓" : "✗"}</td><td>${esc(s.what)}</td><td>${esc(s.chunks.join(", "))}</td><td>${s.missing.length ? `not found: <code>${esc(s.missing.join(" · "))}</code>` : ""}${s.invented.length ? ` <b class="bad">invented:</b> <code>${esc(s.invented.join(" · "))}</code>` : ""}</td></tr>`).join("\n")}
</table>

<h2>Calls</h2>
<table><tr><th>Call</th><th>Seconds</th><th>Input</th><th>Cached</th><th>Output</th><th>Cost</th></tr>
${run.calls.map((c) => `<tr><td>${esc(c.name)}${c.ok ? "" : ` <b class="bad">failed</b> ${esc(c.error ?? "")}`}</td><td class="${c.seconds >= LIVE_LIMIT_S ? "bad" : ""}">${c.seconds.toFixed(1)}</td><td>${c.input}</td><td>${c.cacheRead}</td><td>${c.output}</td><td>$${c.usd.toFixed(3)}</td></tr>`).join("\n")}
</table>

<h2>Colors sampled from the photos</h2>
${run.sampled.map((s) => `<p>${esc(s.upload)}: ${s.colors.map((c) => `<span class="sw" style="background:${c.hex}" title="${c.hex}"></span>${c.hex} (${Math.round(c.share * 100)}%)`).join(" ")}</p>`).join("")}

${[...EXTRACT_CHUNKS.map((c) => ({ id: c.id as string, title: c.title })), { id: "conflicts", title: "Conflicts" }]
  .map(
    (c) => `<h2>${esc(c.title)} <span class="muted">(${esc(c.id)})</span></h2><div class="cols"><div class="panel"><b>Extracted</b>${extractedHtml(run, c.id)}</div><div class="panel"><b>Hand-built</b><pre>${esc(
      c.id === "conflicts" ? (run.handBuilt["readme.md"]?.split("## Known conflicts")[1] ?? "(none listed)") : handBuiltFor(run, c.id),
    )}</pre></div></div>`,
  )
  .join("\n")}

<h2>Evidence notes</h2>
${run.evidence.map((e) => `<details><summary>${esc(e.upload)} (${e.evidence.facts.length} facts, ${e.evidence.lines.length} lines)</summary><p>${esc(e.evidence.summary)}</p><ul>${e.evidence.facts.map((f) => `<li>[${esc(f.topic)}] ${esc(f.statement)}${f.quote ? ` <i>“${esc(f.quote)}”</i>` : ""} <span class="src">${esc(f.location)}</span></li>`).join("")}</ul></details>`).join("\n")}
</main></body></html>`;
  writeFileSync(join(runDir, "index.html"), html);
  return `Checklist ${passed}/${scored.length} · $${usd.toFixed(2)} · ${tooSlow.length} call(s) over ${LIVE_LIMIT_S} s · ${failed.length} failed`;
}
