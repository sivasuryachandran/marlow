import { Session, InMemoryStore, MockIntent } from "../packages/game/src/index";
import { bank, beats, level } from "./lib";
const mem = new InMemoryStore();
const run = async (seed: number, cmds: string[]) => {
  const s = new Session({ level, bank, beats, intent: new MockIntent(), seed, memory: mem });
  console.log(`--- run ${s.runNumber} seed ${seed}`);
  for (const l of s.start().lines) console.log(`   ${l.speaker}: ${l.text}`);
  for (const c of cmds) {
    const o = await s.submit(c);
    console.log(`> ${c}  [${o?.kind}, turn ${s.state.turn}, alert ${s.state.alert}, trust ${s.state.trust}]`);
    for (const x of o!.cues) console.log(`   cue: ${x.caption}`);
    for (const l of o!.lines) console.log(`   ${l.speaker}: ${l.text}`);
  }
  console.log("status", s.state.status);
};
await run(9, ["peek the vault door", "listen", "go to the hall", "peek the door", "quietly go to the office", "hide", "listen", "take the ledger", "go to the hall", "go to the lobby", "exit"]);
await run(10, ["listen", "wait"]);
