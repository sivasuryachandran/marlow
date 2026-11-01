import type { MissionSpec } from "./mission";

/** A spec like Spark would write: a small museum, entrance at the bottom. */
export const fixtureSpec = (): MissionSpec => ({
  title: "The Quiet Frames", tagline: "Nobody notices an empty wall.", clientName: "Vera Lusk", guardName: "Otto Brandt", ownerName: "Cyril Haddon",
  guardSound: "a squeaking shoe and a radio",
  rooms: [
    { id: "foyer", name: "the foyer", aliases: ["entrance"], floor: "marble", x: 0, y: 0, cover: "", describe: "" },
    { id: "rotunda", name: "the rotunda", aliases: ["round room"], floor: "marble", x: 0, y: 1, cover: "", describe: "A round room under a glass dome. Rain on the glass." },
    { id: "salon", name: "the salon", aliases: ["painting room"], floor: "carpet", x: -1, y: 1, cover: "a velvet sofa", describe: "Empty frames on the walls, boss. Someone has done this before." },
    { id: "archive", name: "the archive", aliases: ["records room"], floor: "carpet", x: 1, y: 1, cover: "a filing cabinet", describe: "Shelves of boxes. The catalogue is open on the table." },
    { id: "landing", name: "the landing", aliases: ["stairs"], floor: "metal", x: 0, y: 2, cover: "", describe: "A cold landing. A radio is playing somewhere above." },
  ],
  links: [{ a: "foyer", b: "rotunda", kind: "door" }, { a: "rotunda", b: "salon", kind: "arch" }, { a: "rotunda", b: "archive", kind: "door" }, { a: "rotunda", b: "landing", kind: "door" }],
  item: { id: "catalogue", name: "the catalogue", aliases: ["book", "register"], room: "archive" },
  guardPost: { name: "the guard room", attachTo: "landing" },
  patrol: ["landing", "rotunda", "salon", "rotunda", "archive", "rotunda", "landing"],
  lines: {
    clientIntro: ["Owl. It's Vera.", "The catalogue in the archive. Bring it to me.", "Don't read it."], marlowIntro: "In the foyer, boss. One door ahead.",
    guardFirstHeard: "A squeak, a squeak, and a radio. That's Brandt.", take: "Got the catalogue. There's a photograph tucked inside.", clientAfterTake: "Good. Now out.",
    clientCheckin: "Owl. Where are we?", outro: "We're out, boss.", evidence: "Keep the night man busy until the frames are empty.", evidenceAsk: "That's her voice. Burn it, or send it?",
    burn: "Burning it.", send: "Sending it.", clientAfterBurn: "Thank you, Owl.", clientAfterSend: "Owl, please.",
  },
  lore: [
    { topic: "client", when: "start", text: "Vera hired us for the catalogue." }, { topic: "client", when: "end", text: "Vera planned the night the frames went empty." },
    { topic: "guard", when: "guard", text: "Brandt squeaks when he walks." }, { topic: "item", when: "item", text: "The catalogue lists what was on every wall." },
  ],
});

