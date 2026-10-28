/** Usage: tsx tools/casefile.ts <runId>   (reads runs/<runId>.jsonl, writes casefiles/<runId>/) */
import { buildCaseFile } from "../server/src/casefile";
import { MuseImage } from "../server/src/adapters/image";
import { loadConfig } from "../server/src/config";
import { level, readRuns } from "./lib";

const id = process.argv[2];
const run = readRuns().find(r => r.id === id);
if (!run) { console.error(`no run "${id}" in runs/. Available: ${readRuns().map(r => r.id).join(", ") || "none"}`); process.exit(1); }
const cfg = loadConfig();
const out = await buildCaseFile({ runId: id, rows: run.rows, level, outDir: cfg.casefilesDir, image: new MuseImage(cfg), verify: cfg.verifyArt });
console.log(`case file: ${out.dir}/index.html (${out.panels.length} panels; sources: ${[...new Set(out.panels.map(p => p.source))].join(", ")})`);
