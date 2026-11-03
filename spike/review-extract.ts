// Rebuilds an extraction run's comparison page from its run.json, e.g. after editing the
// checklist. Free: no API calls.
//
// Usage: npm run review-extract -- output/extract-<run-id>
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { brandDir } from "./lib/paths.ts";
import { writeExtractReview, type ExtractRun } from "./lib/extract-review.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: npm run review-extract -- output/extract-<run-id>");
  process.exit(2);
}
const runDir = resolve(dir);
const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as ExtractRun;
// Score against the current checklist, so a changed check applies to old runs too.
run.checks = (YAML.parse(readFileSync(join(brandDir(run.brand), "extraction-check.yaml"), "utf8")) as { checks: ExtractRun["checks"] }).checks;
console.log(writeExtractReview(runDir, run));
