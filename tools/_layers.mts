import { engineFuzz, generatorFuzz, parserFuzz, pipelineFuzz, relayLoad } from "./stress-lib";
const scale = Number(process.argv[2] ?? 1);
for (const [n, f] of [["engine", engineFuzz], ["parser", parserFuzz], ["generator", generatorFuzz], ["pipeline", pipelineFuzz], ["relay", relayLoad]] as const) {
  const t = performance.now(); const r = await f(scale);
  process.stderr.write(`${n}: ${r.checks} checks, ${r.findings.length} findings, ${((performance.now() - t) / 1000).toFixed(1)}s | ${r.notes.join(" | ")}\n`);
  for (const x of r.findings.slice(0, 4)) process.stderr.write(`    FINDING ${x.what} [${(x.repro ?? "").slice(0, 140)}]\n`);
}
process.exit(0);
