// Builds output/<run-id>/index.html: with-kit and no-kit posts side by side, the reasoning
// under each, and a scorecard for the phase 2 gate.
//
// Usage (to rebuild a page without calling the API): npm run review -- output/<run-id>
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PostRecord, Draft } from "./generate.ts";

type Run = {
  runId: string;
  brand: string;
  createdAt: string;
  models: Record<string, { model: string; effort: string; max_tokens: number }>;
  business: { name: string; line: string };
  briefs: { id: string; intent: string; goal: string; details: string }[];
  posts: PostRecord[];
  totalUsd: number;
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function rationaleList(r: Draft["rationale"] | undefined) {
  if (!r?.length) return "";
  return `<ul class="why">${r
    .map(
      (x) =>
        `<li><b>${esc(x.decision)}:</b> ${esc(x.choice)}<br><span>${esc(x.reason)}</span>${
          x.cites.length ? `<span class="cites">${x.cites.map((c) => `<code>${esc(c)}</code>`).join(" ")}</span>` : ""
        }</li>`,
    )
    .join("")}</ul>`;
}

function checksList(d: Draft) {
  return `<ul class="checks">${d.checks.map((c) => `<li class="${c.ok ? "ok" : "fail"}">${c.ok ? "✓" : "✗"} ${esc(c.check)}: ${esc(c.detail)}</li>`).join("")}</ul>`;
}

function critiqueBlock(d: Draft) {
  if (!d.critique) return "";
  const c = d.critique;
  return `<div class="crit ${c.verdict}"><b>Critique: ${c.verdict}</b> ${esc(c.summary)}${
    c.issues.length
      ? `<ul>${c.issues.map((i) => `<li><b>${esc(i.where)}</b> (${esc(i.severity.replace("_", " "))}, <code>${esc(i.rule)}</code>): ${esc(i.problem)} <i>Fix: ${esc(i.fix)}</i></li>`).join("")}</ul>`
      : ""
  }</div>`;
}

function column(p: PostRecord | undefined, label: string, side: "kit" | "nokit") {
  if (!p) return `<div class="col" data-side="${side}"><p class="muted">Not generated in this run.</p></div>`;
  if (p.error) return `<div class="col" data-side="${side}"><h3 class="label">${label}</h3><p class="err">Failed: ${esc(p.error)}</p></div>`;
  const final = p.drafts.at(-1)!;
  const earlier = p.drafts.slice(0, -1);
  const plan = p.plan;
  return `<div class="col" data-side="${side}">
    <h3 class="label">${label}</h3>
    <a href="${esc(final.png)}"><img class="post" src="${esc(final.png)}" alt=""></a>
    <p class="caption">${esc(final.slots.caption)}</p>
    <div class="details-wrap label-detail">
      <p class="meta">Template <b>${esc(plan.template)}</b>${p.photo ? ` · photo <b>${esc(p.photo.split("/").pop())}</b>` : ""}${p.drafts.length > 1 ? ` · revised once` : ""}</p>
      <p class="angle"><b>Angle:</b> ${esc(plan.angle)}</p>
      <details open><summary>Why this works</summary>${rationaleList(plan.rationale)}${rationaleList(final.rationale)}</details>
      ${critiqueBlock(final)}
      <details><summary>Automated checks</summary>${checksList(final)}</details>
      ${earlier
        .map(
          (d, i) => `<details class="draft"><summary>Draft ${i + 1} (before revision)</summary>
            <img class="post small" src="${esc(d.png)}" alt="">${critiqueBlock(d)}${checksList(d)}</details>`,
        )
        .join("")}
      ${p.warnings.length ? `<p class="warn">${p.warnings.map(esc).join("<br>")}</p>` : ""}
      ${p.chunks ? `<p class="muted small">Kit chunks loaded: ${p.chunks.generate.map((c) => `<code>${esc(c)}</code>`).join(" ")} (about ${p.chunks.generateTokens} tokens; budget ${p.chunks.budget})</p>` : ""}
    </div>
  </div>`;
}

export function writeReviewPage(runDir: string): string {
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as Run;
  const rows = run.briefs
    .map((b) => {
      const kit = run.posts.find((p) => p.briefId === b.id && p.variant === "kit");
      const nokit = run.posts.find((p) => p.briefId === b.id && p.variant === "nokit");
      return `<section class="brief" data-brief="${esc(b.id)}">
        <header>
          <h2><span class="intent">${esc(b.intent)}</span> ${esc(b.goal)}</h2>
          <p class="muted">${esc(b.details)}</p>
        </header>
        <div class="pair">${column(kit, "With kit", "kit")}${column(nokit, "No kit (baseline)", "nokit")}</div>
        <div class="score">
          <label><input type="checkbox" data-k="client:${esc(b.id)}"> I'd show the <span class="label">with-kit</span> post to a client</label>
          <span class="pick">Better post:
            <label><input type="radio" name="pick:${esc(b.id)}" value="kit" data-k="pick:${esc(b.id)}"> <span class="pick-a">With kit</span></label>
            <label><input type="radio" name="pick:${esc(b.id)}" value="nokit" data-k="pick:${esc(b.id)}"> <span class="pick-b">No kit</span></label>
          </span>
        </div>
      </section>`;
    })
    .join("\n");

  const models = Object.entries(run.models)
    .map(([step, m]) => `${esc(step)}: <code>${esc(m.model)}</code>`)
    .join(" · ");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Specs review: ${esc(run.business.name)}</title>
<style>
  :root { --bg: #f6f5f2; --card: #fff; --ink: #1d1d1b; --muted: #6b6a66; --line: #e2e0da; --ok: #2f7a3e; --bad: #b3261e; --note: #8a6d00; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --card: #20201e; --ink: #ecebe7; --muted: #a09e98; --line: #34332f; --ok: #7cc489; --bad: #f28b82; --note: #e6c35c; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1240px; margin: 0 auto; padding: 32px 16px 80px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .muted { color: var(--muted); } .small { font-size: 13px; }
  .top { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: end; margin-bottom: 24px; }
  .tally { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; }
  .tally b { font-size: 18px; }
  button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
  .brief { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px; margin: 0 0 28px; }
  .brief h2 { font-size: 18px; margin: 0 0 4px; }
  .intent { display: inline-block; text-transform: uppercase; font-size: 12px; letter-spacing: .06em; border: 1px solid var(--line); border-radius: 99px; padding: 1px 8px; margin-right: 6px; vertical-align: 2px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 16px; }
  @media (max-width: 760px) { .pair { grid-template-columns: 1fr; } }
  .col { min-width: 0; }
  .col h3 { margin: 0 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  img.post { width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--line); display: block; }
  img.post.small { width: 50%; margin: 8px 0; }
  .caption { white-space: pre-wrap; background: var(--bg); border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
  .why { padding-left: 18px; margin: 6px 0; } .why li { margin: 0 0 8px; } .why span { color: var(--muted); }
  .cites { display: block; margin-top: 2px; } code { font-size: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
  details { margin: 8px 0; } summary { cursor: pointer; font-weight: 600; }
  .checks { list-style: none; padding: 0; margin: 6px 0; font-size: 13px; } .checks .ok { color: var(--muted); } .checks .fail { color: var(--bad); font-weight: 600; }
  .crit { border-left: 3px solid var(--ok); padding: 6px 10px; margin: 10px 0; font-size: 14px; } .crit.revise { border-color: var(--note); }
  .crit ul { padding-left: 18px; margin: 4px 0 0; }
  .warn { color: var(--note); font-size: 13px; } .err { color: var(--bad); }
  .score { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
  .score label { cursor: pointer; }
  body.blind .label-detail, body.blind .col h3.label { display: none; }
  body.blind .score .label { display: none; }
</style></head>
<body><main>
  <div class="top">
    <div>
      <h1>${esc(run.business.name)}: with kit vs. no kit</h1>
      <p class="muted">Run ${esc(run.runId)} · ${run.briefs.length} briefs · ${models} · about $${run.totalUsd.toFixed(3)}</p>
      <p class="muted small">Fictional brand made for the Specs demo. Phase 2 gate: four of five with-kit posts you'd show a client, and the kit version clearly better.</p>
    </div>
    <div class="tally">
      <div>Show a client: <b id="t-client">0</b> of ${run.briefs.length}</div>
      <div>Kit picked as better: <b id="t-pick">0</b> of <span id="t-picked">0</span> picked</div>
      <div style="margin-top:8px"><button id="blind">Blind mode</button></div>
    </div>
  </div>
  ${rows}
</main>
<script>
  // Scores live in this browser only, keyed by run, so a reload keeps them.
  const KEY = "specs-review:${esc(run.runId)}";
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
  document.querySelectorAll("input[data-k]").forEach((el) => {
    const k = el.dataset.k;
    if (el.type === "checkbox") el.checked = !!state[k]; else el.checked = state[k] === el.value;
    el.addEventListener("change", () => { state[k] = el.type === "checkbox" ? el.checked : el.value; save(); tally(); });
  });
  function tally() {
    const v = Object.entries(state);
    document.getElementById("t-client").textContent = v.filter(([k, x]) => k.startsWith("client:") && x).length;
    const picks = v.filter(([k]) => k.startsWith("pick:"));
    document.getElementById("t-picked").textContent = picks.length;
    document.getElementById("t-pick").textContent = picks.filter(([, x]) => x === "kit").length;
  }
  tally();
  // Blind mode hides labels and reasoning and shuffles left and right, for a fair pick by someone else.
  document.getElementById("blind").addEventListener("click", () => {
    const on = document.body.classList.toggle("blind");
    document.getElementById("blind").textContent = on ? "Show labels" : "Blind mode";
    document.querySelectorAll(".brief").forEach((b) => {
      const pair = b.querySelector(".pair");
      const kit = pair.querySelector('[data-side="kit"]');
      const swap = on && Math.random() < 0.5;
      pair.style.direction = swap ? "rtl" : "ltr";
      pair.querySelectorAll(".col").forEach((c) => (c.style.direction = "ltr"));
      b.querySelector(".pick-a").textContent = on ? (swap ? "Right" : "Left") : "With kit";
      b.querySelector(".pick-b").textContent = on ? (swap ? "Left" : "Right") : "No kit";
    });
  });
</script>
</body></html>`;
  const file = join(runDir, "index.html");
  writeFileSync(file, html);
  return file;
}

// Run directly: rebuild the page for an existing run.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: npm run review -- output/<run-id>");
  console.log(`Wrote ${writeReviewPage(resolve(dir))}`);
}
