/** One real Spark call per sample order (dev check). Usage: node --env-file=.env --import tsx tools/live-spark.ts */
import { knowledgeList } from "../packages/game/src/index";
import { createInitialState, revealRoom } from "../packages/engine/src/index";
import { MetaSparkIntent, BasetenSparkOpenIntent } from "../server/src/adapters/intent";
import { loadConfig } from "../server/src/config";
import { level } from "./lib";

const s = createInitialState(level, 1);
s.marlow.room = "hall"; revealRoom(s, "hall", true);
const a = (process.env.LIVE === "baseten" ? new BasetenSparkOpenIntent(loadConfig()) : new MetaSparkIntent(loadConfig()));
for (const t of ["peek the left door quietly", "go through that door", "grab the thing in the office", "sneak into the gallery"]) {
  const t0 = performance.now();
  try {
    const r = await a.infer({ turnId: 1, transcript: t, currentRoom: "hall", knowledge: knowledgeList(s) });
    console.log(`${Math.round(performance.now() - t0)}ms  "${t}" ->`, JSON.stringify(r.reply));
  } catch (e) { console.log(`"${t}" FAILED`, String(e).slice(0, 300)); }
}
