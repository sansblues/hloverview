// Who is who among the entities a demo shows with models of their own: what the map calls each, what it is to a runner,
// its true box, and whether it is dead.
import type { Life, Stretch } from "./demo.ts";

export type Kind = "person" | "enemy" | "critter" | "item" | "projectile" | "object";

export interface Actor extends Life {
  type: string | null;   // the map's classname, if known
  name: string;   // the map's targetname, if it has one
  kind: Kind | null;   // null for what is not drawn: sprites, debris
  how: string;   // what the identity rests on
}

// Models a runner can meet, by file name: what each is. Anything else is an object; debris is left out.
export const Models: Record<string, Kind> = {
  scientist: "person", barney: "person", gman: "person", construction: "person",
  holo: "person", player: "person", doctor: "person",
  headcrab: "enemy", baby_headcrab: "enemy", zombie: "enemy", houndeye: "enemy",
  bullsquid: "enemy", islave: "enemy", agrunt: "enemy", hgrunt: "enemy",
  hassassin: "enemy", controller: "enemy", garg: "enemy", babygarg: "enemy",
  big_mom: "enemy", icky: "enemy", barnacle: "enemy", tentacle2: "enemy",
  nihilanth: "enemy", apache: "enemy", osprey: "enemy", sentry: "enemy",
  turret: "enemy", miniturret: "enemy", kingpin: "enemy", archer: "enemy",
  snapbug: "enemy", floater: "enemy", gasbag: "enemy", w_squeak: "enemy",
  roach: "critter", bigrat: "critter", leech: "critter", boid: "critter",
  aflock: "critter", chumtoad: "critter",
  grenade: "projectile", rpgrocket: "projectile", crossbow_bolt: "projectile", hornet: "projectile",
  w_battery: "item", w_medkit: "item", w_suit: "item", w_longjump: "item",
  w_security: "item", w_antidote: "item", w_crowbar: "item", w_9mmhandgun: "item",
  w_9mmar: "item", w_357: "item", w_shotgun: "item", w_crossbow: "item", w_rpg: "item",
  w_gauss: "item", w_egon: "item", w_hgun: "item", w_grenade: "item",
  w_satchel: "item", w_sqknest: "item", w_9mmclip: "item", w_9mmarclip: "item",
  w_argrenade: "item", w_shotbox: "item", w_357ammo: "item", w_357ammobox: "item",
  w_crossbow_clip: "item", w_rpgammo: "item", w_gaussammo: "item", w_chainammo: "item",
  w_isotopebox: "item", w_weaponbox: "item",
};
const Debris = /gib|^shell$|^shotgunshell$|^shrapnel$/;
const Living = new Set<Kind | null>(["person", "enemy", "critter"]);

interface Placed { keys: Record<string, string>; at: number[]; class: string }

// world_items makes the item its type names and removes itself (HLSDK items.cpp CWorldItem::Spawn).
const WorldItems: Record<string, string> = { 42: "item_antidote", 43: "item_security", 44: "item_battery", 45: "item_suit" };
// The map's point entities that can carry a model of their own: everything but logic, lights, sounds and markers.
export const placed = (buffer: ArrayBuffer): Placed[] => points(buffer).filter(p => p.keys.origin && !(p.keys.model || "").startsWith("*") &&
  /^(monster_|item_|weapon_|ammo_|world_items|weaponbox|cycler|xen_)/.test(p.keys.classname || ""))
  .map(p => ({ ...p, class: p.keys.classname === "world_items" ? WorldItems[p.keys.type] || "world_items" : p.keys.classname }));

function landmarks(buffer: ArrayBuffer) {   // info_landmark name to position
  const marks: Record<string, number[]> = {};
  for (const p of points(buffer)) if (p.keys.classname === "info_landmark" && p.keys.targetname) marks[p.keys.targetname] = p.at;
  return marks;
}
function points(buffer: ArrayBuffer) {
  const data = new DataView(buffer), bytes = new Uint8Array(buffer), at = data.getInt32(4, true), length = data.getInt32(8, true);
  let text = "";
  for (let i = at; i < at + length; i++) text += String.fromCharCode(bytes[i]);
  return (text.match(/\{[^{}]*\}/g) || []).map(block => {
    const keys: Record<string, string> = {};
    for (const [, k, v] of block.matchAll(/"([^"]*)"\s+"([^"]*)"/g)) keys[k] = v;
    return { keys, at: (keys.origin || "0 0 0").split(/\s+/).map(Number) };
  });
}

const stem = (model: string) => model.replace(/^models\//i, "").replace(/\.mdl$/i, "").toLowerCase();   // maps write MODELS/ too

// What a placed class is to a runner, when its model alone would say less.
function kindOf(type: string, model: string): Kind {
  const byModel = Models[stem(model)];
  if (/^monster_.*_dead$/.test(type)) return byModel || "person";
  if (/^(item_|weapon_|ammo_|world_items|weaponbox)/.test(type)) return "item";
  if (type === "xen_tree") return "enemy";   // it strikes whoever comes near
  if (/^(cycler|monster_furniture|monster_generic|xen_)/.test(type)) return byModel === "person" ? "person" : "object";   // holograms, cutscene actors, props
  if (/^monster_(cockroach|rat|leech|flyer)/.test(type)) return "critter";
  if (/^monster_(scientist|sitting_scientist|barney|gman)$/.test(type)) return "person";
  return byModel || (type.startsWith("monster_") ? "enemy" : "object");
}

// Name every life in a run's stretches, in play order: a level change carries lives over, a loaded save restores them.
// `maps` gives each map's file. Each life gains { type, name, kind, how }.
export function identify(stretches: Stretch[], maps: Record<string, ArrayBuffer>) {
  let before: Stretch | null = null;
  const known: [string, Actor][] = [];   // lives identified so far, with their map: a loaded save restores them where they were when it was made
  for (const stretch of stretches) {
    const buffer = maps[stretch.map], placedHere = buffer ? placed(buffer) : [], makers = buffer ? points(buffer).filter(p => p.keys.classname === "monstermaker" && p.keys.monstertype) : [];
    const offset = shift(before, stretch, maps);
    for (const life of stretch.things as Actor[]) {
      if (life.model.startsWith("*")) continue;
      const model = stem(life.model), byKind = Models[model];
      if (!/\.mdl$/i.test(life.model) || Debris.test(model)) { Object.assign(life, { type: null, name: "", kind: null, how: "not drawn" }); continue; }
      const from = inherit(life, before, offset);
      if (from) { Object.assign(life, { type: from.type, name: from.name, kind: from.kind, how: "carried over" }); continue; }
      const saved = restored(life, stretch.map, known);
      if (saved) { Object.assign(life, { type: saved.type, name: saved.name, kind: saved.kind, how: "restored" }); continue; }
      const at = life.spawn && match(life, placedHere);
      if (at) { Object.assign(life, { type: at.class, name: at.keys.targetname || "", kind: kindOf(at.class, life.model), how: "placed" }); continue; }
      const maker = made(life, makers);
      if (maker) { const type = maker.keys.monstertype; Object.assign(life, { type, name: maker.keys.netname || "", kind: kindOf(type, life.model), how: "made" }); continue; }   // named by its maker's netname (monstermaker.cpp:223)
      const thrown = byKind === "item" && [5, 9, 10].includes(life.shape[8]);   // flies or bounces: a thrown satchel, not one to pick up
      Object.assign(life, { type: null, name: "", kind: thrown ? "projectile" : byKind || "object", how: "model" });
    }
    for (const life of stretch.things as Actor[]) if (life.kind) known.push([stretch.map, life]);
    before = stretch;
  }
  return stretches;
}

// A monster a monstermaker made: it appears where the maker stands, as the maker's monstertype, if that class wears this model.
// Made out of sight, it is first seen elsewhere and stays unnamed.
function made(life: Life, makers: { keys: Record<string, string>; at: number[] }[]) {
  if (life.spawn || !life.track.length) return null;
  const [x, y, z] = [life.track[1], life.track[2], life.track[3]];
  const found = makers.filter(m => Math.abs(m.at[0] - x) < 1 && Math.abs(m.at[1] - y) < 1 && Math.abs(m.at[2] - z) < 64 && wears(m.keys.monstertype, life.model));
  return found.length === 1 ? found[0] : null;
}
const Wears: Record<string, string> = { monster_scientist: "scientist", monster_barney: "barney", monster_headcrab: "headcrab", monster_zombie: "zombie",
  monster_houndeye: "houndeye", monster_bullchicken: "bullsquid", monster_alien_slave: "islave", monster_alien_grunt: "agrunt",
  monster_human_grunt: "hgrunt", monster_human_assassin: "hassassin", monster_alien_controller: "controller", monster_snark: "w_squeak",
  monster_cockroach: "roach", monster_rat: "bigrat", monster_leech: "leech", monster_babycrab: "baby_headcrab", monster_ichthyosaur: "icky",
  monster_gargantua: "garg", monster_babygarg: "babygarg", monster_bigmomma: "big_mom", monster_apache: "apache", monster_osprey: "osprey" };
const wears = (type: string, model: string) => !Wears[type] || Wears[type] === stem(model);   // a class not listed: trust the position

// A life a loaded save brought back: on the same map earlier, a life with the same model stood exactly where this one
// spawned. Several may have, which is fine when they agree on what it is.
function restored(life: Life, map: string, known: [string, Actor][]) {
  if (!life.spawn) return null;
  const [x, y, z] = life.spawn, found = new Map<string, Actor>();
  for (const [where, t] of known) {
    if (where !== map || t.model !== life.model) continue;
    for (let i = 0; i < t.track.length; i += 8)
      if (Math.abs(t.track[i + 1] - x) < 0.2 && Math.abs(t.track[i + 2] - y) < 0.2 && Math.abs(t.track[i + 3] - z) < 0.2) { found.set(`${t.type}|${t.name}|${t.kind}`, t); break; }
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

// The placed entity a life spawned as: same x and y as the map gives (monsters drop to the floor, so z only falls,
// or rises a little for sitting ones), and a class that can wear the model.
function match(life: Life, placedHere: Placed[]) {
  const [x, y, z] = life.spawn!, name = stem(life.model);
  const near = placedHere.filter(p => Math.abs(p.at[0] - x) < 0.5 && Math.abs(p.at[1] - y) < 0.5 && p.at[2] - z > -1 && p.at[2] - z < 256);
  const fits = near.filter(p => fitting(p.class, name) && (!p.keys.model || p.keys.model.toLowerCase() === life.model.toLowerCase()));   // props name their model
  if (fits.length < 2) return fits[0] || null;
  const gap = (p: Placed) => Math.abs(p.at[2] - z), best = Math.min(...fits.map(gap)), closest = fits.filter(p => gap(p) === best);
  return closest.length === 1 ? closest[0] : null;   // still a tie: say nothing rather than guess
}
function fitting(type: string, name: string) {
  if (type.startsWith("env_")) return false;
  if (/^(item_|weapon_|ammo_|world_items|weaponbox)/.test(type)) return name.startsWith("w_");
  return !name.startsWith("w_") || /^monster_(snark|tripmine|satchel)/.test(type);
}

// An entity that crossed a level change: in the stretch before, a life with the same model whose last place,
// moved by the landmark both maps share, is where this one spawned.
function shift(before: Stretch | null, stretch: Stretch, maps: Record<string, ArrayBuffer>) {
  if (!before) return null;
  if (before.map === stretch.map) return [0, 0, 0];
  if (!maps[before.map] || !maps[stretch.map]) return null;
  const old = landmarks(maps[before.map]), now = landmarks(maps[stretch.map]);
  const shared = Object.keys(now).filter(k => old[k]);
  return shared.length === 1 ? now[shared[0]].map((v, a) => v - old[shared[0]][a]) : null;   // more than one: ambiguous, say nothing
}
function inherit(life: Life, before: Stretch | null, offset: number[] | null) {
  if (!before || !offset || !life.spawn) return null;
  const spawn = life.spawn;
  const found = (before.things as Actor[]).filter(t => t.model === life.model && t.kind !== undefined && t.track.length &&
    [1, 2, 3].every(a => Math.abs(t.track[t.track.length - 8 + a] + offset[a - 1] - spawn[a - 1]) < 1));
  return found.length === 1 ? found[0] : null;
}

export function shapeAt(life: Life, t: number) {   // the last shape record at or before a time
  const s = life.shape;
  let lo = 0, hi = s.length / 9 - 1, k = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[9 * mid] <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  return k < 0 ? null : s.subarray(9 * k, 9 * k + 9);
}

// Whether a life is dead at a time, dying included: at death the game makes a monster fall as a body (toss, 6) and,
// once the animation ends, flattens its box; a scripted death fixes it flat instead (none, 0). Living things walk
// (step), fly or swim; a barnacle is fixed but tall.
export function dead(life: Actor, t: number) {
  const s = Living.has(life.kind) && shapeAt(life, t);
  return !!s && (s[8] === 6 || s[8] === 0 && s[6] - s[3] <= 2);
}

// The box around the origin at a time, [minx, miny, maxx, maxy], or null where the game gives it no size.
export function box(life: Life, t: number): [number, number, number, number] | null {
  const s = shapeAt(life, t);
  return s && s[4] > s[1] ? [s[1], s[2], s[4], s[5]] : null;
}
