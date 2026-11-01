/**
 * One-off generator for the story illustrations shown in the cockpit when a story beat fires.
 * Real Muse Image calls (one per missing file, ~12 s each); results are committed under assets/art/story/.
 *
 *   npm run story-art -- --dry        # list what would be generated, send nothing
 *   npm run story-art                 # generate missing images only
 *   npm run story-art -- --only=tape  # one image
 *   npm run story-art -- --force      # regenerate everything
 *   npm run story-art -- --set=ui     # the interface art (poster, cast portraits, paper and blueprint textures) into assets/art/ui/
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

/** Interface art for the 1960s caper-film theme. Portraits and poster share one look; textures are flat and plain. */
const POSTER = "1960s Hollywood heist film poster painting, gouache and screen-print look, limited palette of near-black, warm cream, oxblood red and brass gold, visible film grain, dramatic chiaroscuro, no text, no letters, no numbers, no logos, no signatures. ";
const TEXTURE = "Seamless flat texture photographed top-down with even soft lighting, fills the whole frame, no objects, no text, no letters, no numbers. ";
export const UI_ART: Record<string, string> = {
  poster: POSTER + "A rain-slicked city street at night outside a grand art-deco gallery with a glowing blank marquee canopy, a parked panel van with a thin radio antenna in the foreground, two small silhouettes, searchlight beams crossing the sky, wide cinematic composition with a large dark empty sky at the top.",
  owl: POSTER + "Head-and-shoulders portrait of a distinguished blind man in his fifties wearing dark round glasses and a tweed overcoat, old radio headphones around his neck, lit from below by the warm glow of a radio dial inside a dark van, 1960s film still.",
  marlow: POSTER + "Head-and-shoulders portrait of a young woman cat burglar with short dark hair in a black turtleneck, alert eyes, half her face in shadow, a small earpiece in one ear, 1960s film still.",
  ines: POSTER + "Head-and-shoulders portrait of an elegant woman in her fifties in a camel trench coat and pearls, holding a black telephone receiver, a cool knowing smile, rain-streaked window behind her, 1960s film still.",
  halloran: POSTER + "Portrait of a heavy-set night watchman in a peaked cap with a large ring of keys on his belt, leaning on a cane, flashlight beam cutting through a dark marble corridor, 1960s film still.",
  hale: POSTER + "Head-and-shoulders portrait of a heavy-set bald art dealer in his sixties with a thick grey walrus moustache and round wire spectacles, plump cheeks, wearing a velvet smoking jacket and a cravat, holding a magnifying loupe, gilded oil paintings blurred behind him, an ordinary unfamiliar face, 1960s film still.",
  paper: TEXTURE + "Aged cream manila paper with soft fibers, faint coffee rings and gentle creases, warm and even.",
  blueprint: TEXTURE + "Old architectural blueprint paper, deep prussian blue, faint fine square grid, slightly worn, a few soft folds, no drawings.",
  // floors for the seer's top-down map, matched to each room's footstep sound in level.json
  floor_lobby: TEXTURE + "Top-down view of a polished black and white checkerboard marble floor, art-deco hotel lobby, slight reflections, square tiles.",
  floor_marble: TEXTURE + "Top-down view of a polished cream and grey veined marble floor with large square slabs and thin brass inlay lines, museum hall.",
  floor_carpet: TEXTURE + "Top-down view of a deep oxblood red wool carpet with a small repeating gold art-deco pattern, private office.",
  floor_metal: TEXTURE + "Top-down view of worn dark steel diamond-plate flooring, industrial stairwell, scuffed.",
  floor_street: TEXTURE + "Top-down view of wet black asphalt at night with puddles reflecting warm amber street light.",
};

const args = process.argv.slice(2);
const dry = args.includes("--dry"), force = args.includes("--force"), only = args.find(a => a.startsWith("--only="))?.split("=")[1];
const set = args.find(a => a.startsWith("--set="))?.split("=")[1] ?? "story";
const SET: Record<string, string> = set === "ui" ? UI_ART : Object.fromEntries(Object.entries(ART).map(([k, v]) => [k, STYLE + v]));
const dir = set === "ui" ? "assets/art/ui" : "assets/art/story";
mkdirSync(dir, { recursive: true });
const todo = Object.keys(SET).filter(id => (!only || id === only) && (force || !existsSync(`${dir}/${id}.jpg`)));
console.log(`${todo.length} of ${Object.keys(SET).length} ${set} images to generate${dry ? " (DRY RUN: nothing sent)" : ""}: ${todo.join(", ") || "none"}`);
if (dry || !todo.length) process.exit(0);

const cfg = loadConfig(); const img = new MuseImage(cfg);
for (const id of todo) {
  const t0 = performance.now();
  try {
    const r = await img.render(SET[id]);
    writeFileSync(`${dir}/${id}.jpg`, r.data as Uint8Array);
    console.log(`  ${id}: ${(((r.data as Uint8Array).length) / 1024).toFixed(0)} KB in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) { console.log(`  ${id}: FAILED ${(e as Error).message}`); }
}
