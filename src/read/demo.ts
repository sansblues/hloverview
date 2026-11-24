// Read a Half-Life demo (.dem, protocol 5) into the stretches of the run it holds: one per map visited.
import { messages, world, type Frame } from "./net.ts";

// Every other entity of a stretch, one life per occupant of an entity slot: its model, where the map spawned it, and
// two tracks written whenever anything in them changes:
//   track  (time, x, y, z, pitch, yaw, roll, seen), stride 8; seen is 1 sent, 0 not sent (the page adds -1 gone, -2 ended)
//   shape  (time, mins xyz, maxs xyz, solid, movetype), stride 9
export interface Life {
  number: number;
  model: string;
  spawn: number[] | null;
  track: Float32Array;
  shape: Float32Array;
}

export interface Stretch {
  map: string;
  points: Float32Array;   // the player: time, x, y, z, yaw, stride 5
  eyes: Float32Array;     // where the server looked from, each network frame: time, x, y, z, stride 4
  fov: Float32Array;      // the field of view, when it changes: time, degrees, stride 2
  things: Life[];
}

interface Building { number?: number; model: number; track: number[]; shape: number[]; spawn: number[] | null }

const Fields = ["origin[0]", "origin[1]", "origin[2]", "angles[0]", "angles[1]", "angles[2]"];
const Shape = ["mins[0]", "mins[1]", "mins[2]", "maxs[0]", "maxs[1]", "maxs[2]", "solid", "movetype"];

// A demo is a directory of segments, each a run of frames. Frames of type 4 carry the player's origin and view every
// frame; network frames carry everything else the game sent. Times are the game's, in seconds.
export function demo(buffer: ArrayBuffer): Stretch[] {
  const data = new DataView(buffer), bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  if (magic !== "HLDEMO") throw new Error("This is not a Half-Life demo.");
  if (data.getInt32(8, true) !== 5) throw new Error(`This demo uses protocol ${data.getInt32(8, true)}; only protocol 5 is read.`);
  if (data.getInt32(12, true) < 45)   // before 1.1.0.8 the frame header had another size; no such demo has been checked
    throw new Error(`This demo is from a Half-Life older than 1.1.0.8 (network protocol ${data.getInt32(12, true)}), which isn't read.`);
  const w = world();
  type Open = { map: string; points: number[]; eyes: number[]; fov: number[]; things: Map<number, Building>; lives: Building[]; models: string[] };
  const maps: Open[] = [];
  let stretch: Open | null = null, last: Frame = [];
  const open = () => { stretch = { map: w.map!, points: [], eyes: [], fov: [], things: new Map(), lives: [], models: w.models }; maps.push(stretch); last = []; };
  // A demo the game finished writing ends in a directory of its segments. One cut off by a crash or a quit has none:
  // its frames then run from the header to wherever the file stops.
  let directory = data.getInt32(540, true), ranges: [number, number][] = [];
  const count = directory > 544 && directory + 4 <= buffer.byteLength ? data.getInt32(directory, true) : -1;
  if (count >= 1 && count <= 1024 && directory + 4 + 92 * count <= buffer.byteLength)
    for (let entry = 0; entry < count; entry++) {
      const at = directory + 4 + 92 * entry, start = data.getInt32(at + 84, true), length = data.getInt32(at + 88, true);
      if (start < 544 || length < 0 || start + length > directory) { ranges = []; break; }   // a directory that points outside the frames is no directory
      ranges.push([start, start + length]);
    }
  if (!ranges.length) { directory = 0; ranges.push([544, buffer.byteLength]); }

  // A client frame shows the server state of the network frame before it (server is that frame's time), and before its
  // first start frame a demo stamps the engine's own clock: those frames count as 0.
  let cut = false, server: number | null = null, started = false;
  for (const [start, end] of ranges) {
    let p = start;
    server = null;   // each segment keeps its own clock
    try {
      while (p + 9 <= end && !cut) {
        const type = bytes[p];
        if (type === 2) started = true;
        const time = started ? data.getFloat32(p + 1, true) : 0;
        p += 9;
        if (type === 0 || type === 1) {
          const sequence = data.getInt32(p + 436, true), length = data.getInt32(p + 464, true);
          if (p + 468 + length > end) { cut = true; break; }   // the file stops inside this frame
          let entities: Frame | null;
          w.client = null;
          try { entities = messages(w, bytes, data, p + 468, p + 468 + length, sequence); }
          catch (error) { if (directory > 544) throw error; cut = true; break; }
          if (w.changed) { w.changed = false; open(); }
          const s = stretch as Open | null, c = w.client as Record<string, number> | null;
          if (c && s) s.eyes.push(time, c["origin[0]"] || 0, c["origin[1]"] || 0,   // where the server looks from: the PVS sent
            (c["origin[2]"] || 0) + (c["view_ofs[2]"] || 0) - ((c.flags || 0) & 1 << 14 ? 18 : 0));   // FL_DUCKING
          if (entities && s) {
            s.models = w.models;
            const size = Math.max(entities.length, last.length);
            for (let n = 1; n < size; n++) {   // 0 is the world; the recording player has better data of its own
              const e = entities[n] as Record<string, number> | undefined, before = last[n];
              if (e === before || n === (w.player || 1)) continue;
              let thing = s.things.get(n);
              if (e && thing && thing.model !== e.modelindex && thing.track[thing.track.length - 1])   // the one before left in this very frame
                thing.track.push(time, ...thing.track.slice(-7, -1), 0);
              if (e && (!thing || thing.model !== e.modelindex)) {   // a new occupant of the slot; the one before keeps its own track
                const base = w.baseline[n] as Record<string, number> | undefined;   // the slot as the map loaded: where the map placed it, if it is the same thing
                thing = { model: e.modelindex, track: [], shape: [], spawn: base && base.modelindex === e.modelindex ? [0, 1, 2].map(a => base[`origin[${a}]`] || 0) : null };
                s.things.set(n, thing); s.lives.push(Object.assign(thing, { number: n }));
              }
              if (!thing) continue;
              if (e) {   // its box, solidity and way of moving: what it is and whether it is dead
                const shape = thing.shape, k = shape.length - 9;
                let same = k >= 0;
                for (let i = 0; same && i < 8; i++) same = shape[k + 1 + i] === (e[Shape[i]] || 0);
                if (!same) { shape.push(time); for (const f of Shape) shape.push(e[f] || 0); }
              }
              const track = thing.track, shown = e ? 1 : 0, values = e ? Fields.map(f => e[f] || 0) : track.slice(-7, -1);
              const k = track.length - 8;
              if (k >= 0 && track[k + 7] === shown && values.every((v, i) => track[k + 1 + i] === v)) continue;
              track.push(time, ...values, shown);
            }
            last = entities;
          }
          server = time;
          p += 468 + length;
        } else if (type === 2) {
        } else if (type === 3) p += 64;
        else if (type === 4) {
          const f = (k: number) => data.getFloat32(p + 4 * k, true), s = stretch as Open | null;
          if (s && (f(0) || f(1) || f(2))) {   // exactly 0 0 0 is a level loading, not a place
            s.points.push(server ?? time, f(0), f(1), f(2), f(4));
            if (s.fov[s.fov.length - 1] !== f(7)) s.fov.push(server ?? time, f(7));
          }
          p += 32;
        } else if (type === 5) { if (directory > 544) break; server = null; }   // a segment ends; the next keeps its own clock
        else if (type === 6) p += 84;
        else if (type === 7) p += 8;
        else if (type === 8) p += 8 + data.getInt32(p + 4, true) + 16;
        else if (type === 9) p += 4 + data.getInt32(p, true);
        else if (directory > 544) throw new Error(`The demo has a frame of unknown type ${type}.`);
        else cut = true;
      }
    } catch (error) {   // a cut-off file ends mid-frame; a damaged one has a frame that reads past its end
      if (!(error instanceof RangeError)) throw error;
      if (directory > 544) throw new Error("The demo is damaged: a frame runs past where it should end.");
      cut = true;
    }
  }
  return maps.filter(m => m.points.length).map(m => ({
    map: m.map, points: Float32Array.from(m.points), eyes: Float32Array.from(m.eyes), fov: Float32Array.from(m.fov),
    things: m.lives.map(t => ({ number: t.number!, model: m.models[t.model] || "", spawn: t.spawn, track: Float32Array.from(t.track), shape: Float32Array.from(t.shape) })),
  }));
}
