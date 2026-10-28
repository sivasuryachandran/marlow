import { z } from "zod";

export const Side = z.enum(["ahead", "behind", "left", "right"]);
export type Side = z.infer<typeof Side>;
export const Compass = z.enum(["north", "east", "south", "west"]);
export type Compass = z.infer<typeof Compass>;
export const Dist = z.enum(["near", "mid", "far"]);
export type Dist = z.infer<typeof Dist>;
export type Dir = Side | "here";

export const Room = z.object({
  id: z.string(), aliases: z.array(z.string()).default([]), pos: z.tuple([z.number(), z.number()]),
  reverb: z.string(), spokenName: z.string(), footsteps: z.string().default("carpet"),
  /** Off-stage rooms exist for the guard only: Marlow can never learn of or enter them. */
  offstage: z.boolean().default(false),
});
export const Door = z.object({
  id: z.string(), aliases: z.array(z.string()).default([]), between: z.tuple([z.string(), z.string()]),
  side: z.record(Side), state: z.enum(["open", "closed", "locked"]),
  kind: z.enum(["door", "arch", "stairs"]).default("door"), spokenName: z.string().default("the door"),
});
export const Prop = z.object({
  id: z.string(), aliases: z.array(z.string()).default([]), room: z.string(), side: Side, tags: z.array(z.string()), spokenName: z.string(),
});
export const Item = z.object({ id: z.string(), aliases: z.array(z.string()).default([]), room: z.string().nullable(), spokenName: z.string() });
export const Guard = z.object({
  id: z.string(), route: z.array(z.string()).min(2), step: z.number().int().min(0),
  /** Sound reaction: while detouring he leaves his route toward a noise for up to `left` steps, then walks back to route[step]. */
  at: z.string().nullable().default(null),
  detour: z.object({ target: z.string(), left: z.number().int() }).nullable().default(null),
  returning: z.boolean().default(false),
});
export const Marlow = z.object({
  room: z.string(), facing: Compass, hidden: z.boolean(),
  carrying: z.string().nullable(), prevRoom: z.string().nullable(),
});
export const Knowledge = z.object({
  rooms: z.array(z.string()), doors: z.array(z.string()),
  props: z.array(z.string()), items: z.array(z.string()),
  guardLastHeard: z.object({ dir: z.string(), dist: Dist, turn: z.number() }).nullable(),
});
export const ScheduledEvent = z.object({ id: z.string(), turn: z.number().int(), room: z.string(), sound: z.string() });

export const WorldState = z.object({
  seed: z.number().int(), rngState: z.number().int(), turn: z.number().int(),
  alert: z.number().int(), chase: z.boolean().default(false), trust: z.number(), status: z.enum(["playing", "won", "caught"]),
  rooms: z.array(Room), doors: z.array(Door), props: z.array(Prop), items: z.array(Item),
  guard: Guard, marlow: Marlow, knowledge: Knowledge,
  objective: z.object({ item: z.string(), exitRoom: z.string() }),
  scheduled: z.array(ScheduledEvent),
  memory: z.object({ lastTrustLoss: z.string().nullable(), warned: z.boolean(), danger: z.array(z.string()).default([]) }),
});
export type WorldState = z.infer<typeof WorldState>;

/** Level file = static world; runtime fields are added by createInitialState. */
export const Level = z.object({
  rooms: z.array(Room), doors: z.array(Door), props: z.array(Prop), items: z.array(Item),
  guard: Guard.omit({ step: true }), start: z.object({ room: z.string(), facing: Compass }),
  objective: z.object({ item: z.string(), exitRoom: z.string() }),
  scheduled: z.array(ScheduledEvent).default([]),
});
export type Level = z.infer<typeof Level>;

const Stance = z.enum(["normal", "quiet"]).optional();
export const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), target: z.string(), stance: Stance }),
  z.object({ action: z.literal("peek"), target: z.string(), stance: Stance }),
  z.object({ action: z.literal("listen") }),
  z.object({ action: z.literal("wait") }),
  z.object({ action: z.literal("hide") }),
  z.object({ action: z.literal("take"), target: z.string() }),
  z.object({ action: z.literal("exit") }),
]);
export type Action = z.infer<typeof Action>;
/** The model's reply wraps an engine Action; `matched` is the exact words of the order that name the target (move/peek/take). */
export const Matched = z.object({ matched: z.string().optional() });
export const Clarify = z.object({ clarify: z.object({ candidates: z.array(z.string()).min(2) }) });
/** V1: intent reply is exactly one of these shapes. */
export const IntentReply = z.union([Action, Clarify]);
export type IntentReply = z.infer<typeof IntentReply>;

export type RefusalReason =
  | "game_over" | "unknown_target" | "not_adjacent" | "not_known" | "door_locked"
  | "not_in_room" | "no_hide_spot" | "no_item" | "not_ready_to_exit";

/** `perceived` = Marlow experienced it; only these may drive audio/speech. */
export type GameEvent = { perceived: boolean } & (
  | { type: "moved"; from: string; to: string; stance: "normal" | "quiet" }
  | { type: "door_noise"; door: string }
  | { type: "door_peeked"; door: string; sees: string; props: string[]; items: string[]; guardSeen: boolean }
  | { type: "guard_heard"; dir: Dir; dist: Dist; via: "listen" | "footsteps" | "noise" }
  | { type: "listen_quiet" }
  | { type: "waited" }
  | { type: "hid"; prop: string }
  | { type: "item_taken"; item: string }
  | { type: "warning"; dir: Dir; dist: Dist }
  | { type: "sound_heard"; sound: string; dir: Dir; dist: Dist }
  | { type: "guard_moved"; to: string }
  | { type: "guard_alerted"; dir: Dir; dist: Dist }
  | { type: "alert_changed"; alert: number }
  | { type: "trust_changed"; delta: number; reason: string }
  | { type: "spotted" }
  | { type: "caught"; reason?: "alert" | "chase" }
  | { type: "chase_started" }
  | { type: "chase_escaped" }
  | { type: "won"; alert: number }
  | { type: "refused"; reason: RefusalReason; target?: string }
);
