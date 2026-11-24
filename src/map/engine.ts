// The map: what is open, where the run is, and the canvas that shows it. React reads `state` through useMap and changes
// it only through the functions here; drawing runs outside React, once per animation frame at most.
import { useSyncExternalStore } from "react";
import type { Box, Level, Thing } from "../read/level.ts";
import { dead, box as boxOf, shapeAt, type Actor } from "../read/actors.ts";
import { decode, levels, readMap, readRun, reading, clock, Example, type Run, type Segment } from "./run.ts";
import { keys as keysOf, place, units, Movetypes, Solids, type Card } from "./cards.ts";

export interface Notice { title: string; text: string; closable?: boolean }   // `code` in text is set as code
export interface Spot { thing: unknown; box?: number[]; point?: number[]; time?: number; card: () => Card }

export const state = {
  runs: [Example] as Run[],   // the runs opened, newest first, and the example
  chosen: null as Run | null,
  ghost: null as Run | null,
  segments: [] as Segment[],
  index: -1,   // the segment shown
  now: 0,   // the run's time, in the demo's seconds
  playing: false,
  rate: 1,
  speed: 0,
  split: null as number | null,   // when this map was entered, against the ghost
  shows: new Map<string, string[]>(),   // what the legend lists: what this map has, and the classnames each mark stands for
  tip: null as { card: Card; x: number; y: number } | null,
  where: "",
  status: "",
  notice: null as Notice | null,
  legend: true,
  keys: false,
};
export type State = typeof state;

const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const emit = () => { for (const f of listeners) f(); };
const set = (patch: Partial<State>) => { Object.assign(state, patch); emit(); };
// A part of the state; a component renders again only when its part changes (fields that are objects are replaced, never changed).
export const useMap = <T>(pick: (s: State) => T) => useSyncExternalStore(subscribe, () => pick(state));

export const Groups: Record<string, string> = { trigger: "--zone", teleport: "--zone", level: "--ink", hurt: "--enemy", push: "--zone", water: "--water",
  ladder: "--zone", button: "--mover", door: "--mover", lift: "--mover", breakable: "--mover", invisible: "--clip" };
const Outlined = new Set(["trigger", "teleport", "level", "push"]);   // zones you pass through: an outline, no fill
const Moving = new Set(["door", "lift", "breakable", "button", "invisible"]);
export const Kinds: Record<string, string> = { person: "--person", enemy: "--enemy", critter: "--object", item: "--item", projectile: "--enemy", object: "--object" };   // drawn where the demo says they were
export const Living = new Set(["person", "enemy", "critter"]);

let canvas: HTMLCanvasElement, stage: HTMLElement, ctx: CanvasRenderingContext2D;
let width = 0, height = 0;   // the stage's size
const tokens: Record<string, string> = {};
export const css = (name: string) => tokens[name] ||= getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let segment: Segment | null = null, ghostRun: Segment[] | null = null, ghostFirst = 0;
let view = { x: 0, y: 0, s: 0.2 }, hovered: Spot | null = null, shown: Spot[] = [], pointer = [0, 0];
let follow = true, gliding = false, fitted = false, before = 0;

const first = () => state.segments[0].points[0];
const last = () => { const p = state.segments[state.segments.length - 1].points; return p[p.length - 5]; };
const stretchAt = (t: number) => { let k = 0; state.segments.forEach((s, i) => { if (s.points[0] <= t) k = i; }); return k; };

// ---- Opening runs

let opening = 0, comparing = 0, started = false;   // the latest choice wins, whichever finishes reading first

export function start() {
  if (started) return;
  started = true;
  open(Example);
}

// Runs given to the page join the list, and the newest opens.
export function add(runs: Run[]) {
  if (!runs.length) return set({ notice: { title: "No demos there", text: "hloverview reads Half-Life demos, `.dem` files.", closable: true } });
  set({ runs: [...runs, ...state.runs.filter(r => !runs.some(n => n.name === r.name))] });
  open(runs[0]);
}

export function open(run: Run) {
  const buffers = readRun(run);
  const mine = ++opening;
  set({ chosen: run, status: "Reading demo…" });
  (async () => {
    try {
      const segments = await decode(await buffers);
      if (mine !== opening) return;
      play(false);
      set({ segments, index: -1, notice: null });
      pair();
      segments.forEach(s => readMap(s.map).catch(() => {}));   // ready before playback reaches them
      await openSegment(0);
    } catch (error) {
      if (mine === opening) fail(run.name, (error as Error).message);
    } finally {
      if (mine === opening) set({ status: "" });
    }
  })();
}

const fail = (name: string, text: string) => set({ notice: { title: `Couldn't read ${name}`, text, closable: true } });
export const close = () => { if (state.notice?.closable) set({ notice: null }); };

// The ghost: a second run, shown on the same map at the same time since entering it.
export async function compare(run: Run | null) {
  const mine = ++comparing;
  if (!run) { ghostRun = null; set({ ghost: null, status: state.status === "Reading ghost…" ? "" : state.status }); pair(); if (segment) tick(); return; }
  set({ status: "Reading ghost…" });
  try {
    const segments = await decode(await readRun(run));
    if (mine !== comparing) return;
    ghostRun = segments; ghostFirst = segments[0].points[0];
    set({ ghost: run, status: "" });
    pair(); tick();
  } catch {
    if (mine !== comparing) return;
    set({ status: `Couldn't read ${run.name}` });
    setTimeout(() => { if (mine === comparing) set({ status: "" }); }, 4000);
  }
}
function pair() {
  for (const s of state.segments) s.twin = ghostRun?.find(g => g.map === s.map && g.visit === s.visit) || null;
  legendFor();
}

// Open a map of the run. Playing on keeps the time and the playback; choosing a map starts it from where the run enters it.
async function openSegment(i: number, playingOn = false) {
  const mine = segment = state.segments[i];
  if (!playingOn) { play(false); state.now = mine.points[0]; }
  set({ index: i });
  try { await readMap(mine.map); } catch (error) { if (segment === mine) fail(`${mine.map}.bsp`, (error as Error).message); return; }
  if (segment !== mine) return;
  const level = levels[mine.map];
  legendFor();
  set({ notice: level ? null : { title: `No map ${mine.map}`, text: "hloverview has Half-Life's own maps, and this isn't one of them." } });
  frame(); tick();
}

function legendFor() {   // the legend lists only what this map has
  if (!segment) return;
  const level = levels[segment.map];
  const shows = new Map<string, Set<string>>(), add = (row: string, name?: string) => { const names = shows.get(row) ?? new Set(); if (name) names.add(name); shows.set(row, names); };
  if (segment.twin) add("ghost");
  if (level) {
    for (const t of level.things) add(t.kind === "teleport" ? "trigger" : ["door", "lift", "breakable", "button"].includes(t.kind) ? "moving" : t.kind === "invisible" ? "clip" : t.kind, t.kind === "invisible" ? undefined : t.class);
    if (level.water.length) add("water");
    if (level.slopes.length) add("slope");
    for (const d of segment.actors) {
      add(d.kind === "critter" ? "object" : d.kind === "projectile" ? "enemy" : d.kind!, d.type || d.model);
      if (Living.has(d.kind!) && d.shape.some((_, i) => i % 9 === 0 && dead(d, d.shape[i]))) add("dead");
    }
    add("clip");
  }
  set({ shows: new Map([...shows].map(([row, names]) => [row, [...names].sort()])) });
}

// ---- Playback

export function tick(step = 1 / 60) {
  if (!segment) return;
  const k = stretchAt(state.now);
  if (state.segments[k] !== segment) { openSegment(k, true); return; }   // the run moved on to another map
  const p = segment.points, at = index(state.now);
  // The split: when this map was entered, against the ghost. Both runs start together, so the first map has none.
  const split = segment.twin && segment !== state.segments[0] ? (segment.points[0] - first()) - (segment.twin.points[0] - ghostFirst) : null;
  if (state.playing && follow) {   // keep the player in view: near an edge, the view glides until the player is central again
    const [sx, sy] = toScreen(p[5 * at + 1], p[5 * at + 2]);
    if (sx < width * 0.2 || sx > width * 0.8 || sy < height * 0.2 || sy > height * 0.8) gliding = true;
    if (gliding) {
      const ease = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 1 - Math.exp(-step / 0.15);
      view.x += (p[5 * at + 1] - view.x) * ease; view.y += (p[5 * at + 2] - view.y) * ease; fitted = false;
      if (Math.hypot(sx - width / 2, sy - height / 2) < Math.min(width, height) * 0.05) gliding = false;
    }
  }
  set({ speed: Math.round(segment.speed[at]), split });
  draw();
}

function play(on: boolean) { if (state.playing !== on) set({ playing: on }); }
function loop(stamp: number) {
  if (!state.playing) return;
  const end = last(), step = Math.max(0, stamp - before) / 1000;   // a frame can be stamped before the click
  state.now = Math.min(end, state.now + step * state.rate); before = stamp;
  if (state.now >= end) play(false);
  tick(step);
  if (state.playing) requestAnimationFrame(loop);
}
export function toggle() {
  if (!segment) return;
  if (!state.playing && state.now >= last()) state.now = first();
  play(!state.playing);
  if (state.playing) { follow = true; before = performance.now(); requestAnimationFrame(loop); }
}
export const setRate = (rate: number) => set({ rate });
export function seek(t: number, glide = false) {
  if (!segment) return;
  state.now = Math.max(first(), Math.min(last(), t));
  if (glide) { follow = true; gliding = true; }
  tick();
}

// ---- The view

export function frame() {   // the route in view: the stretch from the map's start and any other long stretch, not brief teleport visits
  if (!segment) return;
  const p = segment.points, n = p.length / 5, jump = segment.jump;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let from = 0; from < n;) {
    let to = from + 1;
    while (to < n && !jump[to]) to++;
    if (from === 0 || to - from > n * 0.1)
      for (let i = from; i < to; i++) { x0 = Math.min(x0, p[5 * i + 1]); x1 = Math.max(x1, p[5 * i + 1]); y0 = Math.min(y0, p[5 * i + 2]); y1 = Math.max(y1, p[5 * i + 2]); }
    from = to;
  }
  const open = state.legend ? (stage.querySelector<HTMLElement>(".legend")?.offsetWidth ?? 0) + 24 : 0;   // what the legend covers stays clear
  const w = width - open, sx = Math.max(x1 - x0, 400), sy = Math.max(y1 - y0, 400);
  view = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s: Math.min(w / sx, height / sy) * 0.85 };
  view.x += open / 2 / view.s;
  fitted = true; draw();
}
export const refit = () => { if (fitted && segment) frame(); };

export const setLegend = (open: boolean) => {
  set({ legend: open });
  try { localStorage.setItem("legend", open ? "open" : "closed"); } catch { /* not kept */ }
};
export const setKeys = (open: boolean) => set({ keys: open });

const index = (t: number) => {   // the last point at or before t
  const p = segment!.points; let lo = 0, hi = p.length / 5 - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (p[5 * mid] <= t) lo = mid; else hi = mid - 1; }
  return lo;
};
const toScreen = (x: number, y: number): [number, number] => [width / 2 + (x - view.x) * view.s, height / 2 - (y - view.y) * view.s];
const toWorld = (sx: number, sy: number): [number, number] => [view.x + (sx - width / 2) / view.s, view.y - (sy - height / 2) / view.s];

let pending = false;
function draw() { if (!pending && ctx) { pending = true; requestAnimationFrame(() => { pending = false; paint(); }); } }

// Speed to colour, on the game's own scale. Up to sv_maxspeed (320 u/s, as fast as running goes) a quiet grey; past it,
// speed the runner gained, in the run's orange, brighter up to sv_maxvelocity (2000 u/s, the engine's cap) on a log scale.
export const Running = 320, Cap = 2000;
export function shade(v: number) {
  if (v <= Running) return `hsl(205 8% ${30 + 20 * v / Running}%)`;
  const k = Math.min(Math.log(v / Running) / Math.log(Cap / Running), 1);
  return `hsl(36 ${72 + 28 * k}% ${44 + 26 * k}%)`;
}

// Where the player's origin would be standing on the floor below them. Unlike their height, it holds still through a jump,
// so what is cut away above them does not flicker. The world's floor is looked for no further down than a jump reaches:
// below that the player stands on something that moves (a lift, a platform), which the world does not have.
const Jump = 72;
export function standing(level: Level | undefined, [x, y, z]: number[] | Float32Array) {
  if (!level || level.blocked(x, y, z)) return z;
  let free = 0;
  while (free < Jump && !level.blocked(x, y, z - free - 8)) free += 8;
  if (free >= Jump) return z - Jump;
  let blocked = free + 8;
  while (blocked - free > 0.5) { const middle = (free + blocked) / 2; if (level.blocked(x, y, z - middle)) blocked = middle; else free = middle; }
  return z - free;
}

function lastSeen(track: Float32Array, t: number) {   // when it left view: the first record no longer shown after one shown
  let left: number | null = null;
  for (let i = 8; i < track.length && track[i] <= t; i += 8) if (track[i + 7] !== 1 && track[i - 1] === 1) left = track[i];
  return left ?? t;
}

// The outline from above of a brush model turned and placed as the game does it (AngleVectors: forward, left, up),
// and its lowest point.
function footprint(b: Box, origin: number[], [pitch, yaw, roll]: number[]): [number[][], number] {
  const r = Math.PI / 180, [sp, cp, sy, cy, sr, cr] = [pitch, pitch, yaw, yaw, roll, roll].map((a, i) => (i % 2 ? Math.cos : Math.sin)(a * r));
  const f = [cp * cy, cp * sy, -sp], l = [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, sr * cp], u = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];
  const points: number[][] = [];
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]])
    points.push([0, 1, 2].map(a => origin[a] + x * f[a] + y * l[a] + z * u[a]));
  const bottom = Math.min(...points.map(q => q[2]));
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);   // the convex hull of the eight corners (monotone chain)
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), hull: number[][] = [];
  for (const pass of [points, [...points].reverse()]) {
    const start = hull.length;
    for (const q of pass) { while (hull.length >= start + 2 && cross(hull[hull.length - 2], hull[hull.length - 1], q) <= 0) hull.pop(); hull.push(q); }
    hull.pop();
  }
  return [hull, bottom];
}

// The last record of a track at or before a time: [time, x, y, z, pitch, yaw, roll, seen], or null.
export function latest(track: Float32Array | undefined, t: number) {
  if (!track) return null;
  let lo = 0, hi = track.length / 8 - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (track[8 * mid] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found < 0 ? null : track.subarray(8 * found, 8 * found + 8);
}
// Gone: vanished in sight and still not sent 0.2 s later (a frame or two of absence is not removal).
// Ended (-2): replaced by what a load brought back.
const isGone = (record: Float32Array) => record[7] === -2 || record[7] === -1 && state.now - record[0] >= 0.2;

// Whether a wall the map gives as an entity is there now: until the demo shows it, as the map starts it;
// then as the demo shows it, gone once removed or switched off.
function present(level: Level, model: number) {
  const record = latest(segment!.brushes.get(model), state.now);
  return record ? !isGone(record) : !level.off.has(model);
}

// Invisible walls where the player is, worked out once for each 8 units of height.
const clips = new WeakMap<Level, { bounds: [number, number, number, number]; at: Map<number, number[]> }>();
function invisible(level: Level, z: number) {
  const key = Math.round(z / 8) * 8;
  let known = clips.get(level);
  if (!known) {
    const xs = level.floors.flatMap(f => f.filter((_, i) => i % 2)), ys = level.floors.flatMap(f => f.filter((_, i) => i && i % 2 === 0));
    clips.set(level, known = { bounds: [Math.min(...xs) - 32, Math.min(...ys) - 32, Math.max(...xs) + 32, Math.max(...ys) + 32], at: new Map() });
  }
  let cells = known.at.get(key);
  if (!cells) known.at.set(key, cells = level.invisible(key, known.bounds));
  return cells;
}

// The player and the ghost as the game has them: the 32 × 32 box it collides with, which never turns, and the field of
// view the demo records, as its two edges. Never smaller than 8 px, so it stays findable.
function body(x: number, y: number, yaw: number, fov: number, color: string, solid: boolean) {
  const half = Math.max(16 * view.s, 4), reach = Math.max(44, 96 * view.s), look = -yaw * Math.PI / 180, spread = fov * Math.PI / 360;
  const edge = (a: number): [number, number] => [x + Math.cos(a) * reach, y + Math.sin(a) * reach];
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(...edge(look - spread)); ctx.arc(x, y, reach, look - spread, look + spread); ctx.closePath();
  ctx.fillStyle = color + (solid ? "1a" : "12"); ctx.fill();
  ctx.beginPath(); ctx.moveTo(...edge(look - spread)); ctx.lineTo(x, y); ctx.lineTo(...edge(look + spread));
  ctx.strokeStyle = color + (solid ? "99" : "80"); ctx.lineWidth = 1; ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = solid ? css("--ground") : color; ctx.fillStyle = solid ? color : css("--ground");   // the view starts at the box
  ctx.fillRect(x - half, y - half, 2 * half, 2 * half);
  ctx.strokeRect(x - half, y - half, 2 * half, 2 * half);
}
const fovAt = (s: Segment, t: number) => { let v = 90; for (let i = 0; i < s.fov.length && s.fov[i] <= t; i += 2) v = s.fov[i + 1] || 90; return v; };

// Steep slopes are hatched: the player slides down them.
let pattern: CanvasPattern | null = null;
function hatch() {
  if (pattern) return pattern;
  const tile = document.createElement("canvas"); tile.width = tile.height = 6;
  const t = tile.getContext("2d")!; t.strokeStyle = "rgba(231, 227, 217, 0.28)"; t.lineWidth = 1;
  t.beginPath(); t.moveTo(0, 6); t.lineTo(6, 0); t.moveTo(-1, 1); t.lineTo(1, -1); t.moveTo(5, 7); t.lineTo(7, 5); t.stroke();
  return pattern = ctx.createPattern(tile, "repeat")!;
}

// Where the ghost is now: the same time after entering this map as the player, or where it left the map.
function ghostAt() {
  const twin = segment?.twin;
  if (!twin) return null;
  const p = twin.points, t = Math.min(twin.points[0] + (state.now - segment!.points[0]), p[p.length - 5]);
  let lo = 0, hi = p.length / 5 - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (p[5 * mid] <= t) lo = mid; else hi = mid - 1; }
  return { at: lo, left: state.now - segment!.points[0] > p[p.length - 5] - p[0] };
}

function paint() {
  const ratio = devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = css("--ground"); ctx.fillRect(0, 0, width, height);
  if (!segment) return;
  const now = state.now, p = segment.points, at = index(now), me = [p[5 * at + 1], p[5 * at + 2], p[5 * at + 3]];
  const level = levels[segment.map], stand = standing(level, me), top = stand + 72;   // floors above a standing player's head are hidden
  const path = (f: number[]) => { ctx.beginPath(); for (let i = 1; i < f.length; i += 2) { const [x, y] = toScreen(f[i], f[i + 1]); if (i === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y); } };

  if (level) {
    const heights = level.floors.map(f => f[0]), low = heights[0], span = Math.max(1, heights[heights.length - 1] - low);
    for (const f of level.floors) {
      if (f[0] > top || f.model && !present(level, f.model)) continue;
      const k = (f[0] - low) / span, near = Math.max(0, 1 - Math.abs(f[0] - stand + 36) / 400);
      ctx.fillStyle = `hsl(205 10% ${14 + k * 6 + near * 4}%)`;
      path(f); ctx.fill();
    }
    ctx.fillStyle = hatch();
    for (const f of level.slopes) {
      if (f[0] > top || f.model && !present(level, f.model)) continue;
      path(f); ctx.fill();
    }
    ctx.lineWidth = 1;   // walls fade with distance from the player's level, in a few steps
    const steps: number[][] = [[], [], [], [], []];
    for (const w of level.walls) {
      const [bottom, , x0, y0, x1, y1] = w;
      if (bottom > top || w.model && !present(level, w.model)) continue;
      steps[Math.round(Math.max(0, 1 - Math.abs(bottom - stand + 36) / 400) * 4)].push(x0, y0, x1, y1);
    }
    steps.forEach((lines, k) => {
      ctx.strokeStyle = `rgba(229, 226, 219, ${0.08 + 0.22 * k / 4})`; ctx.beginPath();
      for (let i = 0; i < lines.length; i += 4) { ctx.moveTo(...toScreen(lines[i], lines[i + 1])); ctx.lineTo(...toScreen(lines[i + 2], lines[i + 3])); }
      ctx.stroke();
    });
    ctx.fillStyle = css("--water"); ctx.globalAlpha = 0.35;
    for (const f of level.water) {
      if (f[0] > top || f.model && !present(level, f.model)) continue;
      path(f); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const cells = invisible(level, stand), size = Math.max(8 * view.s, 1.5);
    ctx.fillStyle = css("--clip");
    for (let i = 0; i < cells.length; i += 2) { const [x, y] = toScreen(cells[i], cells[i + 1]); ctx.fillRect(x - size / 2, y - size / 2, size, size); }
    shown = [];
    for (const t of level.things) {   // what never moves, from the map
      const group = Groups[t.kind];
      if (!group || Moving.has(t.kind) || t.box[2] > top) continue;
      const a = toScreen(t.box[0], t.box[4]), b = toScreen(t.box[3], t.box[1]), color = css(group);
      const bw = Math.max(b[0] - a[0], 3), bh = Math.max(b[1] - a[1], 3);
      const lit = t === hovered?.thing;
      ctx.globalAlpha = lit ? 1 : t.kind === "trigger" || t.kind === "teleport" ? 0.35 : 0.85;
      ctx.fillStyle = t.kind === "ladder" ? color : color + "38"; ctx.strokeStyle = color; ctx.lineWidth = lit ? 2 : 1.25;
      if (t.kind === "ladder") {   // rungs, so a ladder never looks like an object
        ctx.beginPath(); for (let y = a[1] + 2; y < a[1] + bh; y += 4) { ctx.moveTo(a[0], y); ctx.lineTo(a[0] + bw, y); } ctx.lineWidth = 1; ctx.stroke();
      } else if (!Outlined.has(t.kind)) ctx.fillRect(a[0], a[1], bw, bh);
      ctx.strokeRect(a[0], a[1], bw, bh);
      const [cx, cy] = [a[0] + bw / 2, a[1] + bh / 2];
      if (t.kind === "level" && t.to) {   // where it leads
        ctx.globalAlpha = 1; ctx.font = `500 11px ${css("--mono")}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineWidth = 3; ctx.strokeStyle = css("--ground"); ctx.strokeText(`→ ${t.to}`, cx, cy); ctx.fillStyle = css("--ink"); ctx.fillText(`→ ${t.to}`, cx, cy);
        ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      }
      if (t.kind === "push") {   // which way it pushes
        const angle = +t.keys.angle, yaw = (t.keys.angles || "0 0 0").split(/\s+/).map(Number)[1];
        ctx.fillStyle = color; ctx.font = `500 12px ${css("--mono")}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        if (angle === -1 || angle < -1) ctx.fillText(angle === -1 ? "↑ up" : "↓ down", cx, cy);
        else {
          const r = (isNaN(angle) ? yaw : angle) * Math.PI / 180, len = Math.min(14, Math.max(bw, bh) / 3);
          ctx.beginPath(); ctx.moveTo(cx - Math.cos(r) * len, cy + Math.sin(r) * len); ctx.lineTo(cx + Math.cos(r) * len, cy - Math.sin(r) * len); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx + Math.cos(r) * len, cy - Math.sin(r) * len, 2.5, 0, 7); ctx.fill();
        }
        ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      }
      shown.push({ thing: t, box: [t.box[0], t.box[1], t.box[3], t.box[4]], card: () => ({ title: t.class, name: t.name, rows: keysOf(t) }) });
    }
    for (const t of level.things) {   // what moves, where the demo says it was; faded where the player could not see it
      if (!Moving.has(t.kind)) continue;
      const track = segment.brushes.get(t.model), record = latest(track, now);
      if (record && isGone(record)) continue;   // broken, removed
      const origin = record ? [record[1], record[2], record[3]] : (t.keys.origin || "0 0 0").split(" ").map(Number), seen = record?.[7] === 1;   // never seen: where the map puts it
      const [corners, bottom] = footprint(level.shapes[t.model], origin, record ? [record[4], record[5], record[6]] : [0, 0, 0]);
      if (bottom > top) continue;
      const color = css(Groups[t.kind]);
      ctx.globalAlpha = t === hovered?.thing ? 1 : seen ? 0.9 : 0.35;
      ctx.setLineDash(seen ? [] : [4, 3]); ctx.strokeStyle = color; ctx.fillStyle = color + "40"; ctx.lineWidth = t === hovered?.thing ? 2 : 1.25;
      ctx.beginPath(); corners.forEach((q, i) => { const [x, y] = toScreen(q[0], q[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath();
      if (seen) ctx.fill();
      ctx.stroke();
      const xs = corners.map(q => q[0]), ys = corners.map(q => q[1]);
      shown.push({ thing: t, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], card: () => moverCard(t, record, origin, seen, track) });
    }
    ctx.setLineDash([]);
    for (const d of segment.actors) {   // people, enemies, items and objects at their true size, while the player could see them
      const record = latest(d.track, now);
      if (!record || isGone(record) || record[3] - 36 > top) continue;
      const away = record[7] !== 1, box = boxOf(d, now), corpse = dead(d, now), living = Living.has(d.kind!);
      const color = css(Kinds[d.kind!]), [x, y] = toScreen(record[1], record[2]), turn = record[5] * Math.PI / 180;
      const [x0, y0, x1, y1] = box ? [record[1] + box[0], record[2] + box[1], record[1] + box[2], record[2] + box[3]] : [record[1] - 6, record[2] - 6, record[1] + 6, record[2] + 6];
      const a = toScreen(x0, y1), c = toScreen(x1, y0), w = Math.max(c[0] - a[0], 4), h = Math.max(c[1] - a[1], 4), left = (a[0] + c[0] - w) / 2, up = (a[1] + c[1] - h) / 2;
      ctx.globalAlpha = 1; ctx.lineWidth = d === hovered?.thing ? 2 : 1.25; ctx.strokeStyle = color; ctx.fillStyle = color;
      const inset = ctx.lineWidth / 2;   // outlines inside the box, so every state is drawn exactly the box's size
      if (away) {   // out of sight: where it was last seen
        ctx.globalAlpha = 0.5; ctx.setLineDash([3, 2]); ctx.strokeRect(left + inset, up + inset, w - 2 * inset, h - 2 * inset); ctx.setLineDash([]);
      } else if (corpse) {   // a corpse: its outline, crossed out
        ctx.globalAlpha = 0.6; ctx.strokeRect(left + inset, up + inset, w - 2 * inset, h - 2 * inset);
        ctx.beginPath(); ctx.moveTo(left, up); ctx.lineTo(left + w, up + h); ctx.moveTo(left + w, up); ctx.lineTo(left, up + h); ctx.stroke();
      } else {
        ctx.fillRect(left, up, w, h);
        if (living) { const r = Math.max(w, h) / 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(turn) * (r + Math.max(r, 6)), y - Math.sin(turn) * (r + Math.max(r, 6))); ctx.stroke(); }
      }
      shown.push({ thing: d, box: [x0, y0, x1, y1], card: () => actorCard(d, record, away) });
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // The route: ahead of the player faint, behind in speed colours, broken at teleports.
  ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const n = p.length / 5, jump = segment.jump, speed = segment.speed;
  const trace = (from: number, to: number, colour?: string) => {
    let last: [number, number] | null = null, current = null;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const s = toScreen(p[5 * i + 1], p[5 * i + 2]);
      if (jump[i]) last = null;
      if (last && i < to && !jump[i + 1] && Math.abs(s[0] - last[0]) + Math.abs(s[1] - last[1]) < 1.5) continue;
      const c = colour || shade(speed[i]);
      if (!last) ctx.moveTo(...s);
      else {
        if (c !== current) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(...last); }
        ctx.lineTo(...s);
      }
      ctx.strokeStyle = current = c;
      last = s;
    }
    ctx.stroke();
  };
  const twin = segment.twin, there = ghostAt();
  if (twin) {   // the ghost's whole route in this map, faint, then where it is
    ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5; ctx.strokeStyle = css("--ghost"); ctx.setLineDash([5, 4]); ctx.beginPath();
    let lifted = true;
    for (let i = 0, g = twin.points; i < g.length / 5; i++) { const q = toScreen(g[5 * i + 1], g[5 * i + 2]); if (twin.jump[i]) lifted = true; if (lifted) ctx.moveTo(...q); else ctx.lineTo(...q); lifted = false; }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineWidth = 2.2;
  }
  ctx.lineWidth = 1; trace(at, n - 1, "rgba(229, 226, 219, 0.14)"); ctx.lineWidth = 2.2;
  trace(0, at);

  const [x, y] = toScreen(me[0], me[1]);
  if (twin && there) {   // the ghost, hollow, so the player stays the solid one
    const g = twin.points, [gx, gy] = toScreen(g[5 * there.at + 1], g[5 * there.at + 2]);
    ctx.globalAlpha = there.left ? 0.4 : 1;
    body(gx, gy, g[5 * there.at + 4], fovAt(twin, g[5 * there.at]), css("--ghost"), false);
    ctx.globalAlpha = 1;
  }
  body(x, y, p[5 * at + 4], fovAt(segment, now), css("--run"), true);

  if (hovered?.point) {   // the inspected spot of the route
    const [x, y] = toScreen(hovered.point[0], hovered.point[1]);
    ctx.strokeStyle = css("--ink"); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.stroke();
  }
  if (hovered) hovered = hit(pointer[0], pointer[1]);   // keep the card true while the run plays under a still pointer
  if (hovered || state.tip) set({ tip: hovered && { card: hovered.card(), x: pointer[0], y: pointer[1] } });
}

function moverCard(t: Thing, record: Float32Array | null, origin: number[], seen: boolean, track: Float32Array | undefined): Card {
  const start = (t.keys.origin || "0 0 0").split(/\s+/).map(Number), from = (t.keys.angles || "0 0 0").split(/\s+/).map(Number);   // where the map puts it
  const rows: [string, string][] = [], moved = Math.hypot(origin[0] - start[0], origin[1] - start[1], origin[2] - start[2]);
  const turned = record ? Math.max(...[4, 5, 6].map((i, a) => Math.abs(((record[i] - from[a] + 180) % 360 + 360) % 360 - 180))) : 0;
  if (!record) rows.push(["now", "not seen yet"]);
  else if (!seen) rows.push(["last seen", clock(lastSeen(track!, state.now) - first())]);
  else rows.push(["now", moved > 0.5 ? `moved ${units(moved)}` : turned > 0.5 ? `turned ${Math.round(turned)}°` : "where it starts"]);
  return { title: t.class, name: t.name, rows: [...rows, ...keysOf(t)] };
}

// A person, monster, item or object as the server last sent it: its entity fields, by the engine's names.
function actorCard(d: Actor, record: Float32Array, away: boolean): Card {
  const s = shapeAt(d, state.now), rows: [string, string][] = [];
  if (away) rows.push(["last seen", clock(lastSeen(d.track, state.now) - first())]);
  rows.push(["origin", place(record[1], record[2], record[3])], ["angles", place(record[4], record[5], record[6])]);
  if (s) rows.push(["mins", place(s[1], s[2], s[3])], ["maxs", place(s[4], s[5], s[6])], ["solid", Solids[s[7]] ?? String(s[7])], ["movetype", Movetypes[s[8]] ?? String(s[8])]);
  if (d.type) rows.push(["model", d.model]);
  return { title: d.type || d.model, name: d.name, rows };
}

// What is under the pointer: the player, the ghost, a person, the route, then the smallest box, then an invisible wall.
function hit(sx: number, sy: number): Spot | null {
  if (!segment) return null;
  const s = segment, p = s.points, n = p.length / 5, at = index(state.now), [px, py] = toScreen(p[5 * at + 1], p[5 * at + 2]);
  if (Math.hypot(sx - px, sy - py) <= Math.max(16 * view.s, 8)) {
    const before = Math.max(0, at - 1), dt = p[5 * at] - p[5 * before];
    return { thing: "player", card: () => ({ title: "player", rows: [
      ["origin", place(p[5 * at + 1], p[5 * at + 2], p[5 * at + 3])], ["yaw", `${Math.round(p[5 * at + 4])}`], ["fov", `${fovAt(s, state.now)}`],
      ["speed", `${Math.round(s.speed[at])} u/s`], ["vertical", `${dt > 0 && !s.jump[at] ? Math.round((p[5 * at + 3] - p[5 * before + 3]) / dt) : 0} u/s`]] }) };
  }
  const there = ghostAt(), twin = s.twin;
  if (there && twin) {
    const g = twin.points, k = there.at, [gx, gy] = toScreen(g[5 * k + 1], g[5 * k + 2]);
    if (Math.hypot(sx - gx, sy - gy) <= Math.max(16 * view.s, 8)) return { thing: "ghost", card: () => ({ title: "ghost", name: state.ghost?.name, rows: [
      ["in map", clock(g[5 * k] - g[0])], ["origin", place(g[5 * k + 1], g[5 * k + 2], g[5 * k + 3])], ["yaw", `${Math.round(g[5 * k + 4])}`], ["speed", `${Math.round(twin.speed[k])} u/s`],
      ["left the map", there.left ? clock(g[g.length - 5] - g[0]) : "not yet"]] }) };
  }
  const [x, y] = toWorld(sx, sy), pad = 4 / view.s, actors = new Set<unknown>(s.actors);
  const inside = (box: number[]) => x >= box[0] - pad && x <= box[2] + pad && y >= box[1] - pad && y <= box[3] + pad;
  for (const item of shown) if (actors.has(item.thing) && inside(item.box!)) return item;
  let near = -1, best = 7;
  for (let i = 0; i < n; i++) {
    const [qx, qy] = toScreen(p[5 * i + 1], p[5 * i + 2]), d = Math.abs(qx - sx) + Math.abs(qy - sy);
    if (d < best) { best = d; near = i; }
  }
  if (near >= 0) return { thing: `route ${near}`, point: [p[5 * near + 1], p[5 * near + 2]], time: p[5 * near], card: () => ({
    title: "route",
    rows: [["run", clock(p[5 * near] - first())], ["in map", clock(p[5 * near] - p[0])], ["origin", place(p[5 * near + 1], p[5 * near + 2], p[5 * near + 3])], ["yaw", `${Math.round(p[5 * near + 4])}`], ["speed", `${Math.round(s.speed[near])} u/s`]],
    note: "Click to go to this moment." }) };
  let found: Spot | null = null, area = Infinity;
  for (const item of shown) {
    if (actors.has(item.thing) || !inside(item.box!)) continue;
    const [x0, y0, x1, y1] = item.box!, size = (x1 - x0) * (y1 - y0);
    if (size < area) { found = item; area = size; }
  }
  if (found) return found;
  const level = levels[s.map];
  if (level) {
    const z = standing(level, [p[5 * at + 1], p[5 * at + 2], p[5 * at + 3]]), cells = invisible(level, z);
    for (let i = 0; i < cells.length; i += 2) if (Math.abs(cells[i] - x) <= 4 + pad && Math.abs(cells[i + 1] - y) <= 4 + pad)
      return { thing: `clip ${i}`, card: () => ({ title: "invisible wall", rows: [["x y z", place(cells[i], cells[i + 1], z)]],
        note: "Hull 1 is solid here, so a standing player is blocked, and nothing within the player's box is drawn." }) };
  }
  return null;
}

// Where the pointer is, in the game's units, and the height of the floor there.
function whereIs(sx: number, sy: number) {
  const level = segment && levels[segment.map];
  if (!segment || !level) return "";
  const [x, y] = toWorld(sx, sy), p = segment.points, at = index(state.now), top = standing(level, p.subarray(5 * at + 1, 5 * at + 4)) + 72;
  let floor: number | null = null;
  for (const f of level.floors) {
    if (f[0] > top || (floor !== null && f[0] <= floor) || f.model && !present(level, f.model)) continue;
    let inside = false;
    for (let i = 1, j = f.length - 2; i < f.length; j = i, i += 2)
      if ((f[i + 1] > y) !== (f[j + 1] > y) && x < (f[j] - f[i]) * (y - f[i + 1]) / (f[j + 1] - f[i + 1]) + f[i]) inside = !inside;
    if (inside) floor = f[0];
  }
  return `x ${Math.round(x)}  y ${Math.round(y)}${floor === null ? "" : `  floor ${floor}`}`;
}

function zoom(by: number, sx: number, sy: number) { const [x, y] = toWorld(sx, sy); view.s *= by; const [x2, y2] = toWorld(sx, sy); view.x += x - x2; view.y += y - y2; draw(); }

// ---- Input

// The canvas and the stage it fills; returns what undoes it.
export function attach(map: HTMLCanvasElement, around: HTMLElement) {
  canvas = map; stage = around; ctx = canvas.getContext("2d")!;
  width = stage.clientWidth; height = stage.clientHeight;
  const pointers = new Map<number, number[]>();
  let pinch: number | null = null, moved = 0;
  const down = (ev: PointerEvent) => { canvas.setPointerCapture(ev.pointerId); pointers.set(ev.pointerId, [ev.offsetX, ev.offsetY]); moved = 0; canvas.classList.add("dragging"); };
  const move = (ev: PointerEvent) => {
    const last = pointers.get(ev.pointerId);
    if (!last) {
      if (ev.pointerType !== "mouse") return;
      pointer = [ev.offsetX, ev.offsetY]; hovered = hit(ev.offsetX, ev.offsetY);
      canvas.style.cursor = hovered?.time !== undefined ? "pointer" : "";
      set({ where: whereIs(ev.offsetX, ev.offsetY) }); draw(); return;
    }
    const at = [ev.offsetX, ev.offsetY]; pointers.set(ev.pointerId, at);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoom(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch = d; return;
    }
    moved += Math.abs(at[0] - last[0]) + Math.abs(at[1] - last[1]);
    if (moved >= 6) follow = fitted = false;
    view.x -= (at[0] - last[0]) / view.s; view.y += (at[1] - last[1]) / view.s; draw();
  };
  const release = (ev: PointerEvent) => {
    if (ev.type === "pointerup" && pointers.size === 1 && pointers.has(ev.pointerId) && moved < 6) {   // a click or a tap, not a drag
      pointer = [ev.offsetX, ev.offsetY];
      const item = hit(ev.offsetX, ev.offsetY);
      if (item?.time !== undefined && ev.pointerType === "mouse") seek(item.time);
      else { hovered = item; draw(); }
    }
    pointers.delete(ev.pointerId); pinch = null; if (!pointers.size) canvas.classList.remove("dragging");
  };
  const leave = (ev: PointerEvent) => { if (ev.pointerType === "mouse") { set({ where: "" }); if (hovered) { hovered = null; draw(); } } };
  const wheel = (ev: WheelEvent) => { ev.preventDefault(); follow = fitted = false; zoom(Math.exp(-ev.deltaY * 0.0015), ev.offsetX, ev.offsetY); };
  const double = () => frame();
  const resized = new ResizeObserver(() => {
    width = stage.clientWidth; height = stage.clientHeight;
    if (fitted && segment) frame(); else draw();
  });
  canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", release); canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", leave); canvas.addEventListener("dblclick", double);
  canvas.addEventListener("wheel", wheel, { passive: false });
  resized.observe(stage);
  try { const kept = localStorage.getItem("legend"); if (kept === "closed" || !kept && matchMedia("(max-width: 760px)").matches) set({ legend: false }); } catch { /* not kept */ }
  draw();
  return () => {
    canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", release); canvas.removeEventListener("pointercancel", release);
    canvas.removeEventListener("pointerleave", leave); canvas.removeEventListener("dblclick", double);
    canvas.removeEventListener("wheel", wheel);
    resized.disconnect();
  };
}

export function key(ev: KeyboardEvent) {
  const typing = ev.target instanceof Element && ev.target.closest(ev.key === " " ? "input, [role=listbox], [aria-haspopup]" : "input, [role=listbox]");   // Space opens a focused trigger
  if (!segment || typing || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.key === " ") { ev.preventDefault(); toggle(); }
  else if (ev.key === "Home" || ev.key === "End") { ev.preventDefault(); seek(ev.key === "Home" ? first() : last()); }
  else if (ev.key === "f" || ev.key === "F") frame();
  else if (ev.key === "l" || ev.key === "L") setLegend(!state.legend);
  else if (ev.key === "?") setKeys(!state.keys);
  else if (ev.key === "Escape") { set({ notice: state.notice?.closable ? null : state.notice }); setKeys(false); }
  else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") { ev.preventDefault(); seek(state.now + (ev.shiftKey ? 0.1 : 1) * (ev.key === "ArrowRight" ? 1 : -1)); }
}

// What the tests look at: the page's own reading of the run, and ways to put it at a moment.
export const debug = {
  state, levels, reading, css, compare, seek, tick, toggle,
  get segment() { return segment; }, get view() { return view; }, get shown() { return shown; }, get ctx() { return ctx; }, get canvas() { return canvas; },
  first, last, index, toScreen, hit, paint, standing, latest, ghostAt, clock, dead, Groups, Kinds,
  go: async (i: number, after?: number) => { await openSegment(i); if (after !== undefined) seek(segment!.points[0] + after); },
};
