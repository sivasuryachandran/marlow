/**
 * One-off generator for the story illustrations shown in the cockpit when a story beat fires.
 * Real Muse Image calls (one per missing file, ~12 s each); results are committed under assets/art/story/.
 *
 *   npm run story-art -- --dry        # list what would be generated, send nothing
 *   npm run story-art                 # generate missing images only
 *   npm run story-art -- --only=tape  # one image
 *   npm run story-art -- --force      # regenerate everything
 *
 * The art is illustration only. It never carries game facts: the engine decides what happens, these only set the mood.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../server/src/config";
import { MuseImage } from "../server/src/adapters/image";

export const STYLE = "Graphic-novel noir illustration, heavy rain, teal and amber palette, cinematic lighting, painterly, wide shot, no text, no letters, no captions, no logos. ";
export const ART: Record<string, string> = {
  title: "A parked surveillance van on a wet city street at night, the cabin glowing amber, a blind man in dark glasses wearing headphones leaning toward a radio, a gallery with lit windows across the street.",
  lobby: "The marble lobby of an art gallery at night, tall rain-streaked windows, a young woman in dark clothes standing still by a heavy door, listening.",
  hall: "A long gallery hall lined with oil portraits of smug wealthy men, dim amber lamps, polished marble floor reflecting light, quiet and tense.",
  limp: "A dark metal stairwell seen from below, the silhouette of a heavy night guard with a limp coming down, a ring of keys catching the light at his belt.",
  guestbook: "A gallery guest book open on a wooden stand under a single pool of lamplight, a pen beside it, a small music box on a shelf in the shadows, an empty room behind.",
  office: "A private office at night, an open empty wall safe, and on the desk a large old ledger lying open under a green banker's lamp, rain on the window.",
  machine: "A vintage answering machine on a desk in a dark office, its red light blinking, a rotary phone beside it, long shadows.",
  tape: "Gloved hands lifting the back cover of an old ledger to reveal a cassette tape taped inside it, lamplight, dust, a handwritten label on the tape.",
  chase: "A heavy guard running down a long marble hall straight toward the viewer with a flashlight, a young woman in dark clothes ducking toward a doorway, motion blur, alarm red glow.",
  ines: "An elegant woman in a long trench coat standing in a dim room holding a telephone, her face half in shadow, rain on the window behind her, an uneasy smile.",
  burn: "A cassette tape burning in a metal bin in a rainy alley at night beside a parked van, sparks rising, a young woman watching the flames.",
  send: "A city skyline at dawn with radio towers and satellite dishes, a hand holding a cassette tape in the foreground, light breaking through clouds.",
};

const args = process.argv.slice(2);
const dry = args.includes("--dry"), force = args.includes("--force"), only = args.find(a => a.startsWith("--only="))?.split("=")[1];
const dir = "assets/art/story";
mkdirSync(dir, { recursive: true });
const todo = Object.keys(ART).filter(id => (!only || id === only) && (force || !existsSync(`${dir}/${id}.jpg`)));
console.log(`${todo.length} of ${Object.keys(ART).length} images to generate${dry ? " (DRY RUN: nothing sent)" : ""}: ${todo.join(", ") || "none"}`);
if (dry || !todo.length) process.exit(0);

const cfg = loadConfig(); const img = new MuseImage(cfg);
for (const id of todo) {
  const t0 = performance.now();
  try {
    const r = await img.render(STYLE + ART[id]);
    writeFileSync(`${dir}/${id}.jpg`, r.data as Uint8Array);
    console.log(`  ${id}: ${(((r.data as Uint8Array).length) / 1024).toFixed(0)} KB in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) { console.log(`  ${id}: FAILED ${(e as Error).message}`); }
}
