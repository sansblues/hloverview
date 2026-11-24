// A run: one demo, or the numbered demos a run was split into at each load, played one after another. Each map it
// visits is one segment, numbered by visit, so two runs can be paired map by map.
import { demo, type Stretch } from "../read/demo.ts";
import { level, type Level } from "../read/level.ts";
import { identify, type Actor } from "../read/actors.ts";
import { sight, linked, type Sight } from "../read/sight.ts";

export interface Segment {
  map: string;
  points: Float32Array;   // the player: time, x, y, z, yaw
  eyes: Float32Array;
  fov: Float32Array;
  things: Actor[];
  cuts: number[];   // points where a load broke the route
  loads: number[];   // times of those loads
  jump: Uint8Array;   // 1 where the route breaks: a teleport, a level change, a load
  speed: Float32Array;
  visit: number;
  brushes: Map<number, Float32Array>;   // brush entities' tracks, by model number
  actors: Actor[];   // everything else with a model of its own and a kind
  twin: Segment | null;   // the ghost's same visit of this map
}

// Each map is fetched and read once, whoever asks first: its file (naming the people in it needs it) and what is drawn.
export const files: Record<string, ArrayBuffer> = {}, levels: Record<string, Level> = {};
export const reading: Record<string, Promise<void>> = {};
const sights: Record<string, Sight> = {};
export function readMap(name: string) {
  return reading[name] ||= fetch(`maps/${name}.bsp.gz`).then(async response => {
    if (!response.ok) return;
    const bytes = await response.arrayBuffer();   // gzipped, unless the server already unpacked it
    files[name] = new Uint8Array(bytes)[0] === 0x1f ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer() : bytes;
    levels[name] = level(files[name]);
  }).catch(error => { delete reading[name]; throw error; });   // a failed read can be tried again
}

// A run: a name, and its demos in play order, as files given to the page or paths on the site.
export interface Run { name: string; files: (File | string)[] }

export const Example: Run = { name: "2026-11-12 19.10.45 AM-IL", files: [1, 2, 3, 4, 5].map(i => `example/AM-IL_${i}.dem`) };   // a speedrun, to open on

export const readRun = (run: Run) => Promise.all(run.files.map(f => typeof f !== "string" ? f.arrayBuffer() : fetch(encodeURI(f)).then(r => {
  if (!r.ok) throw new Error(`${f} couldn't be fetched.`);
  return r.arrayBuffer();
})));

// Demos by run: a folder and a name less its _number, the numbered demos in play order, the newest run first. A folder
// holding one run is named by it; one holding several, by each run's name.
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
export function group(found: { file: File; path: string }[]): Run[] {
  const runs = new Map<string, { folder: string; stem: string; files: File[] }>();
  for (const { file, path } of found) {
    if (!/\.dem$/i.test(file.name)) continue;
    const folder = path.slice(0, path.lastIndexOf("/") + 1), stem = file.name.replace(/\.dem$/i, "").replace(/_\d+$/, "");
    const run = runs.get(folder + stem) ?? { folder, stem, files: [] };
    run.files.push(file);
    runs.set(folder + stem, run);
  }
  const shared = (folder: string) => [...runs.values()].filter(r => r.folder === folder).length > 1;
  const newest = (files: File[]) => Math.max(...files.map(f => f.lastModified));
  return [...runs.values()].sort((a, b) => newest(b.files) - newest(a.files)).map(r => ({
    name: r.folder && !shared(r.folder) ? r.folder.split("/").at(-2)! : r.stem,
    files: r.files.sort((a, b) => natural(a.name, b.name)),
  }));
}

// A jump of more than 200 units between two frames is a teleport or a level change, never a move.
function jumps(p: Float32Array) {
  const n = p.length / 5, out = new Uint8Array(n);
  for (let i = 1; i < n; i++) out[i] = +(Math.hypot(p[5 * i + 1] - p[5 * i - 4], p[5 * i + 2] - p[5 * i - 3], p[5 * i + 3] - p[5 * i - 2]) > 200);
  return out;
}

// Speeds along the ground, each over at least 20 ms either side and never across a teleport, so single frames make no noise.
function speeds(p: Float32Array, jump: Uint8Array) {
  const n = p.length / 5, out = new Float32Array(n);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    if (a > i || jump[i]) a = i;
    while (a < i && p[5 * i] - p[5 * (a + 1)] >= 0.02) a++;
    if (b < i) b = i;
    while (b < n - 1 && !jump[b + 1] && p[5 * b] - p[5 * i] < 0.02) b++;
    let first = a;
    for (let k = a + 1; k <= i; k++) if (jump[k]) first = k;
    const dt = p[5 * b] - p[5 * first];
    out[i] = dt > 0 ? Math.hypot(p[5 * b + 1] - p[5 * first + 1], p[5 * b + 2] - p[5 * first + 2]) / dt : i ? out[i - 1] : 0;
  }
  return out;
}

// The game stops sending what the player can't see, and what no longer exists. Which it was is decided the moment
// something stops being sent: if its last box was in view from that frame's eye and the next one's, it vanished in
// sight (broken, removed, picked up) and its track marks that with -1; otherwise it only left sight (0).
function vanished(stretch: Stretch, sight: Sight) {
  const eyes = stretch.eyes, frames = eyes.length / 4;
  const eyeAt = (t: number) => { let lo = 0, hi = frames - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (eyes[4 * mid] <= t) lo = mid; else hi = mid - 1; } return lo; };
  for (const t of stretch.things) {
    const track = t.track, shape = t.shape;
    for (let i = 8; i < track.length; i += 8) {
      if (track[i + 7] !== 0 || track[i - 1] !== 1) continue;
      const k = eyeAt(track[i]);
      if (!frames || eyes[4 * k] !== track[i] || k + 1 >= frames) continue;
      let size = -1;
      for (let j = 0; j < shape.length && shape[j] <= track[i]; j += 9) size = j;
      if (size < 0) continue;
      const box = linked([track[i + 1], track[i + 2], track[i + 3]], [track[i + 4], track[i + 5], track[i + 6]],
        [shape[size + 1], shape[size + 2], shape[size + 3]], [shape[size + 4], shape[size + 5], shape[size + 6]],
        t.model.startsWith("*") && shape[size + 7] === 4);   // only a solid brush is boxed as a cube when turned
      // A brush that has turned is never called gone: the server tests the leaves it was last linked into, which turning in
      // place doesn't refresh (AngularMoveDone sets the final angles without relinking).
      const turned = t.model.startsWith("*") && [4, 5, 6].some(a => { for (let j = 0; j <= i; j += 8) if (track[j + a] !== track[a]) return true; return false; });
      // A moving thing is sent until its new place, which the demo never gets, leaves view: test one more step of its
      // last movement too, so walking out of view is not taken for removal.
      const step = i >= 16 ? [1, 2, 3].map(a => track[i - 8 + a] - track[i - 16 + a]) : [0, 0, 0];
      const ahead = box.map(corner => corner.map((v, a) => v + step[a])) as typeof box;
      const eyesNow = [eyes.subarray(4 * k + 1, 4 * k + 4), eyes.subarray(4 * k + 5, 4 * k + 8)];
      if (!turned && sight.inSight(eyesNow, box) && sight.inSight(eyesNow, ahead)) track[i + 7] = -1;
    }
  }
}

function merge(a: Float32Array, b: Float32Array) {   // two tracks of one model, in time order
  const records: Float32Array[] = [];
  for (const t of [a, b]) for (let i = 0; i < t.length; i += 8) records.push(t.subarray(i, i + 8));
  records.sort((x, y) => x[0] - y[0]);
  const out = new Float32Array(records.length * 8);
  records.forEach((r, i) => out.set(r, 8 * i));
  return out;
}

const join = (a: Float32Array, b: Float32Array) => { const out = new Float32Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

export async function decode(buffers: ArrayBuffer[]): Promise<Segment[]> {
  const stretches: (Stretch & { start: number })[] = [];
  let offset = 0;
  for (const buffer of buffers) {
    const decoded = demo(buffer);
    for (const s of decoded) {
      for (let i = 0; i < s.points.length; i += 5) s.points[i] += offset;
      for (let i = 0; i < s.eyes.length; i += 4) s.eyes[i] += offset;
      for (let i = 0; i < s.fov.length; i += 2) s.fov[i] += offset;
      for (const t of s.things) {
        for (let i = 0; i < t.track.length; i += 8) t.track[i] += offset;
        for (let i = 0; i < t.shape.length; i += 9) t.shape[i] += offset;
      }
      stretches.push(Object.assign(s, { start: offset }));   // where this demo's clock begins in the run
    }
    const end = decoded[decoded.length - 1];
    if (end) offset = Math.max(end.points[end.points.length - 5], end.eyes.length ? end.eyes[end.eyes.length - 4] : -Infinity);   // its last frame of any kind
  }
  await Promise.all([...new Set(stretches.map(s => s.map))].map(name => readMap(name).catch(() => readMap(name)).catch(() => {})));   // naming needs the maps: a failed read is tried once more
  identify(stretches, files);   // who each is: a save restores, a level change carries over, so all in play order
  for (const s of stretches) if (files[s.map]) vanished(s, sights[s.map] ||= sight(files[s.map]));

  type Joined = Pick<Segment, "map" | "points" | "eyes" | "fov" | "things" | "cuts" | "loads">;
  const joined: Joined[] = [];
  for (const s of stretches) {
    const last = joined[joined.length - 1], things = s.things as Actor[];
    if (last && last.map === s.map) {   // the same map again after a load: one segment, with the entities of both, broken where it loaded
      last.cuts.push(last.points.length / 5);
      last.points = join(last.points, s.points); last.eyes = join(last.eyes, s.eyes); last.fov = join(last.fov, s.fov);
      for (const t of last.things) {   // a load replaces everything: what was there before ends where it loaded
        const k = t.track.length - 8;
        if (k < 0 || t.track[k + 7] < 0) continue;   // in view or out of sight alike; already gone stays gone
        const track = new Float32Array(t.track.length + 8); track.set(t.track); track.set(t.track.subarray(k, k + 8), k + 8);
        track[k + 8] = s.start; track[k + 15] = -2; t.track = track;
      }
      last.loads.push(s.start);
      last.things.push(...things);
    } else joined.push({ map: s.map, points: s.points, eyes: s.eyes, fov: s.fov, things, cuts: [], loads: [] });
  }
  const kept = joined.filter(s => s.points[s.points.length - 5] - s.points[0] >= 0.1);   // a map left the moment it loaded is not part of the run
  if (!kept.length) throw new Error("It has no frames with the player in them.");
  const visits: Record<string, number> = {};
  return kept.map(s => {
    const jump = jumps(s.points), brushes = new Map<number, Float32Array>(), actors: Actor[] = [];
    for (const c of s.cuts) jump[c] = 1;
    for (const t of s.things) {
      if (t.model.startsWith("*")) {
        const number = +t.model.slice(1), had = brushes.get(number);
        brushes.set(number, had ? merge(had, t.track) : t.track);
      } else if (t.kind) actors.push(t);   // sprites and debris have no kind
    }
    return { ...s, jump, speed: speeds(s.points, jump), visit: visits[s.map] = (visits[s.map] ?? -1) + 1, brushes, actors, twin: null };
  });
}

// 61.5 s reads 1:01.500. Rounded to the millisecond first, so a minute's end never reads 0:60.000.
export const clock = (t: number) => { const ms = Math.round(t * 1000); return `${Math.floor(ms / 60000)}:${(ms % 60000 / 1000).toFixed(3).padStart(6, "0")}`; };

// "2026-11-12 19.10.45 AM-IL - PB 4.28.522" reads as AM-IL, PB 4:28.522, 12 Nov 19:10:45; other names stay as they are.
const Months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function named(name: string) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d)\.(\d\d)\.(\d\d) (.+?)(?: - (PB|WR) (\d+)\.(\d\d\.\d+))?$/.exec(name);
  if (!m) return { what: name, best: "", day: "", time: "" };
  const [, , month, day, hour, minute, second, what, best, minutes, seconds] = m;
  return { what, best: best ? `${best} ${minutes}:${seconds}` : "", day: `${+day} ${Months[+month - 1]}`, time: `${hour}:${minute}:${second}` };
}
export const title = (name: string) => { const n = named(name); return [n.what, n.best, n.day && `${n.day} ${n.time.slice(0, 5)}`].filter(Boolean).join(" · "); };
