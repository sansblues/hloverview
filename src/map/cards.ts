// What each thing says when inspected, in the game's own words: its classname, its targetname, and the keys the map
// gives it, with the value the game uses where it fills one in, and its spawnflags by their HLSDK names.
import type { Thing } from "../read/level.ts";

export interface Card { title: string; name?: string; rows: [string, string][]; note?: string }

// The spawnflags each class reads, as the HLSDK names them (doors.h, buttons.cpp, triggers.cpp, util.h, plats.cpp,
// trains.h, func_break.h, bmodels.cpp, common/const.h).
const Door: [number, string][] = [[1, "SF_DOOR_START_OPEN"], [8, "SF_DOOR_PASSABLE"], [16, "SF_DOOR_ONEWAY"], [32, "SF_DOOR_NO_AUTO_RETURN"],
  [256, "SF_DOOR_USE_ONLY"], [512, "SF_DOOR_NOMONSTERS"], [0x80000000, "SF_DOOR_SILENT"]];
const Turning: [number, string][] = [[2, "SF_DOOR_ROTATE_BACKWARDS"], [64, "SF_DOOR_ROTATE_Z"], [128, "SF_DOOR_ROTATE_X"]];
const Trigger: [number, string][] = [[1, "SF_TRIGGER_ALLOWMONSTERS"], [2, "SF_TRIGGER_NOCLIENTS"]];
const Flags: Record<string, [number, string][]> = {
  trigger_once: [...Trigger, [4, "SF_TRIGGER_PUSHABLES"]], trigger_multiple: [...Trigger, [4, "SF_TRIGGER_PUSHABLES"]], trigger_teleport: Trigger,
  trigger_changelevel: [[2, "SF_CHANGELEVEL_USEONLY"]],
  trigger_hurt: [[1, "SF_TRIGGER_HURT_TARGETONCE"], [2, "SF_TRIGGER_HURT_START_OFF"], [8, "SF_TRIGGER_HURT_NO_CLIENTS"],
    [16, "SF_TRIGGER_HURT_CLIENTONLYFIRE"], [32, "SF_TRIGGER_HURT_CLIENTONLYTOUCH"]],
  trigger_push: [[1, "SF_TRIG_PUSH_ONCE"], [2, "SF_TRIGGER_PUSH_START_OFF"]],
  func_door: Door, func_water: Door, func_door_rotating: [...Door, ...Turning],
  func_plat: [[1, "SF_PLAT_TOGGLE"]], func_platrot: [[1, "SF_PLAT_TOGGLE"], ...Turning.slice(1)],
  func_train: [[1, "SF_TRAIN_WAIT_RETRIGGER"], [8, "SF_TRACKTRAIN_PASSABLE"]],
  func_tracktrain: [[1, "SF_TRACKTRAIN_NOPITCH"], [2, "SF_TRACKTRAIN_NOCONTROL"], [4, "SF_TRACKTRAIN_FORWARDONLY"], [8, "SF_TRACKTRAIN_PASSABLE"]],
  func_button: [[1, "SF_BUTTON_DONTMOVE"], [32, "SF_BUTTON_TOGGLE"], [64, "SF_BUTTON_SPARK_IF_OFF"], [256, "SF_BUTTON_TOUCH_ONLY"]],
  func_rot_button: [[1, "SF_ROTBUTTON_NOTSOLID"], [32, "SF_BUTTON_TOGGLE"], [256, "SF_BUTTON_TOUCH_ONLY"], ...Turning],
  momentary_rot_button: [[1, "SF_MOMENTARY_DOOR"], ...Turning.slice(1)],
  func_breakable: [[1, "SF_BREAK_TRIGGER_ONLY"], [2, "SF_BREAK_TOUCH"], [4, "SF_BREAK_PRESSURE"], [256, "SF_BREAK_CROWBAR"]],
  func_pushable: [[128, "SF_PUSH_BREAKABLE"]],
  func_wall_toggle: [[1, "SF_WALL_START_OFF"]],
};
const Materials = ["matGlass", "matWood", "matMetal", "matFlesh", "matCinderBlock", "matCeilingTile", "matComputer", "matUnbreakableGlass", "matRocks", "matNone"];   // func_break.h

// What the game uses when the map leaves a key out or at 0 (triggers.cpp:1075,1826; doors.cpp:302,852; buttons.cpp:479;
// plats.cpp:301,563,848).
const Waits: Record<string, number> = { trigger_multiple: 0.2, func_button: 1, func_rot_button: 1 };
const Speeds: Record<string, number> = { func_door: 100, func_door_rotating: 100, func_water: 100, trigger_push: 100, func_plat: 150, func_platrot: 150, func_train: 100 };

// The engine's names for how a thing moves and how it is solid (common/const.h).
export const Movetypes: Record<number, string> = { 0: "MOVETYPE_NONE", 3: "MOVETYPE_WALK", 4: "MOVETYPE_STEP", 5: "MOVETYPE_FLY", 6: "MOVETYPE_TOSS", 7: "MOVETYPE_PUSH",
  8: "MOVETYPE_NOCLIP", 9: "MOVETYPE_FLYMISSILE", 10: "MOVETYPE_BOUNCE", 11: "MOVETYPE_BOUNCEMISSILE", 12: "MOVETYPE_FOLLOW", 13: "MOVETYPE_PUSHSTEP" };
export const Solids = ["SOLID_NOT", "SOLID_TRIGGER", "SOLID_BBOX", "SOLID_SLIDEBOX", "SOLID_BSP"];

export const units = (v: number) => `${Math.round(v)} u`;
export const place = (x: number, y: number, z: number) => `${Math.round(x)} ${Math.round(y)} ${Math.round(z)}`;

export function spawnflags(type: string, value: number) {
  let rest = value >>> 0;
  const names = (Flags[type] || []).filter(([bit]) => rest & bit).map(([bit, name]) => { rest = (rest & ~bit) >>> 0; return name; });
  return rest ? [...names, String(rest)] : names;   // bits this class doesn't read, as they are
}

export function keys(t: Thing) {
  const k = t.keys, rows: [string, string][] = [], add = (key: string, value: string | undefined) => { if (value !== undefined && value !== "") rows.push([key, value]); };
  const given = (key: string) => k[key] !== undefined && k[key] !== "" && +k[key] ? +k[key] : undefined;
  const filled = (key: string, fallback: number | undefined, unit: string) => {
    const value = given(key);
    return value !== undefined ? `${value} ${unit}` : fallback !== undefined ? `${fallback} ${unit} (default)` : undefined;
  };
  add("target", k.target); add("killtarget", k.killtarget); add("map", k.map); add("landmark", k.landmark); add("master", k.master);
  add("delay", given("delay") !== undefined ? `${k.delay} s` : undefined);
  if (t.class !== "trigger_once") add("wait", filled("wait", Waits[t.class], "s"));
  add("speed", filled("speed", Speeds[t.class], t.class === "func_door_rotating" || t.class === "func_rot_button" || t.class === "momentary_rot_button" ? "°/s" : "u/s"));
  if (t.kind === "hurt") { add("dmg", k.dmg && `${k.dmg} /s`); add("damage", k.damage && `${k.damage} /s`); }
  add("health", given("health") !== undefined ? k.health : undefined);   // 0, as maps write it, is none
  if (k.material !== undefined) add("material", `${k.material} ${Materials[+k.material] ?? ""}`.trim());
  add("friction", k.friction);
  if (t.kind === "push") { add("angle", k.angle); add("angles", k.angles); }
  const flags = spawnflags(t.class, +k.spawnflags || 0);
  if (flags.length) add("spawnflags", flags.join("\n"));
  const b = t.box;
  add("size", `${Math.round(b[3] - b[0])} × ${Math.round(b[4] - b[1])} × ${Math.round(b[5] - b[2])} u`);
  return rows;
}
