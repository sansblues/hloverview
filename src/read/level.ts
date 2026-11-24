// Read a Half-Life map (.bsp, version 30) into what the demo viewer draws, and the collision it needs.

export type Box = [number, number, number, number, number, number];   // low x y z, high x y z
export type Point = [number, number, number];
export type Surface = number[] & { model?: number };   // z, then x y for each corner; a wall: low z, high z, x0 y0 x1 y1

export interface Thing {   // a brush entity worth drawing
  kind: string;
  class: string;
  name: string;
  target: string;
  to: string;
  box: Box;
  model: number;
  keys: Record<string, string>;
}

export interface Level {
  floors: Surface[];
  walls: Surface[];
  water: Surface[];
  slopes: Surface[];
  things: Thing[];
  start: Point | null;
  shapes: Box[];   // every brush model's bounds, around its entity's origin
  off: Set<number>;   // models that start switched off
  blocked(x: number, y: number, z: number, hull?: number): boolean;
  invisible(z: number, bounds: [number, number, number, number], step?: number): number[];
}

const Kinds: Record<string, string> = {   // what is drawn of a map's brush entities, and as what
  trigger_once: "trigger", trigger_multiple: "trigger", trigger_changelevel: "level", trigger_teleport: "teleport",
  trigger_hurt: "hurt", trigger_push: "push", func_door: "door", func_door_rotating: "door", func_plat: "lift", func_platrot: "lift",
  func_train: "lift", func_tracktrain: "lift", func_button: "button", func_rot_button: "button", momentary_rot_button: "button",
  func_breakable: "breakable", func_pushable: "breakable", func_ladder: "ladder", func_water: "water",
  func_wall: "wall", func_wall_toggle: "wall",
};

export function level(buffer: ArrayBuffer): Level {
  const data = new DataView(buffer), bytes = new Uint8Array(buffer);
  if (data.getInt32(0, true) !== 30) throw new Error("This is not a Half-Life map (BSP version 30).");
  const lump = (i: number): [number, number] => [data.getInt32(4 + 8 * i, true), data.getInt32(8 + 8 * i, true)];
  const text = (at: number, length: number) => { let s = ""; for (let i = at; i < at + length && bytes[i]; i++) s += String.fromCharCode(bytes[i]); return s; };

  const [planes] = lump(1), [points] = lump(3), [faces] = lump(7), [edges] = lump(12), [turns] = lump(13), [infos] = lump(6), [models] = lump(14);
  const [nodes] = lump(5), [clips] = lump(9), [leaves] = lump(10);
  const [textures] = lump(2), textureCount = data.getInt32(textures, true);
  const names: string[] = [];
  for (let i = 0; i < textureCount; i++) { const at = data.getInt32(textures + 4 + 4 * i, true); names.push(at >= 0 ? text(textures + at, 16).toLowerCase() : ""); }
  const point = (i: number): Point => [data.getFloat32(points + 12 * i, true), data.getFloat32(points + 12 * i + 4, true), data.getFloat32(points + 12 * i + 8, true)];
  const model = (i: number) => {
    const at = models + 64 * i, f = (k: number) => data.getFloat32(at + 4 * k, true);
    return { box: [f(0), f(1), f(2), f(3), f(4), f(5)] as Box, first: data.getInt32(at + 56, true), count: data.getInt32(at + 60, true) };
  };

  const floors: Surface[] = [], walls: Surface[] = [], water: Surface[] = [], slopes: Surface[] = [];
  const surfaces = (number: number, [dx, dy, dz]: number[]) => {   // a model's floors, walls and liquid surfaces, placed where its entity puts it
    const shape = model(number), tag = (a: Surface) => { if (number) a.model = number; return a; };   // an entity's can go away; the world's can't
    for (let face = shape.first; face < shape.first + shape.count; face++) {
      const at = faces + 20 * face, plane = data.getUint16(at, true), back = data.getUint16(at + 2, true);
      const first = data.getInt32(at + 4, true), many = data.getUint16(at + 8, true), info = data.getUint16(at + 10, true);
      const texture = names[data.getInt32(infos + 40 * info + 32, true)];
      if (/^(sky|aaatrigger|clip)/.test(texture)) continue;
      const ring: Point[] = [];
      for (let k = first; k < first + many; k++) {
        const turn = data.getInt32(turns + 4 * k, true), [x, y, z] = point(turn >= 0 ? data.getUint16(edges + 4 * turn, true) : data.getUint16(edges + 4 * -turn + 2, true));
        ring.push([x + dx, y + dy, z + dz]);
      }
      const up = data.getFloat32(planes + 20 * plane + 8, true) * (back ? -1 : 1);
      const flat = (): Surface => [Math.round(ring.reduce((s, p) => s + p[2], 0) / ring.length), ...ring.flatMap(p => [Math.round(p[0]), Math.round(p[1])])];
      if (texture.startsWith("!")) { if (up > 0.7) water.push(tag(flat())); }   // a liquid's surface
      else if (up > 0.7) floors.push(tag(flat()));
      else if (up >= 0.3) slopes.push(tag(flat()));   // too steep to stand on: the player slides
      else if (Math.abs(up) < 0.3) {
        const line = ring.map(p => [Math.round(p[0]), Math.round(p[1])]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const [a, b] = [line[0], line[line.length - 1]];
        if (a[0] !== b[0] || a[1] !== b[1]) walls.push(tag([Math.round(Math.min(...ring.map(p => p[2]))), Math.round(Math.max(...ring.map(p => p[2]))), ...a, ...b]));
      }
    }
  };
  surfaces(0, [0, 0, 0]);
  // Brush entities the game draws, where the map puts them. Of these, func_walls (desks, rails, panels) never move,
  // so their floors and walls are drawn with the world's, tagged with their model: the game can remove or switch them off.
  const [lumpEntities, lumpEntitiesSize] = lump(0), still: [number, number[]][] = [], off: number[] = [];
  for (const block of text(lumpEntities, lumpEntitiesSize).match(/\{[^{}]*\}/g) || []) {
    const key = (name: string) => (block.match(new RegExp(`"${name}"\\s+"([^"]*)"`)) || [])[1];
    const kind = key("classname") || "", shape = /^\*(\d+)$/.exec(key("model") || "");
    if (!shape || /^trigger_|^func_ladder$/.test(kind) || +key("rendermode") > 0 && !+key("renderamt")) continue;   // never drawn
    const place: [number, number[]] = [+shape[1], (key("origin") || "0 0 0").split(/\s+/).map(Number)];
    if (kind === "func_wall_toggle" && +key("spawnflags") & 1) { off.push(place[0]); surfaces(...place); continue; }   // starts switched off
    still.push(place);
    if (kind === "func_wall" || kind === "func_wall_toggle") surfaces(...place);
  }
  floors.sort((a, b) => a[0] - b[0]);

  // Collision. Hull 1 is what a standing player's origin collides with; hull 0 is what is drawn.
  const side = (plane: number, x: number, y: number, z: number) => {
    const at = planes + 20 * plane;
    return data.getFloat32(at, true) * x + data.getFloat32(at + 4, true) * y + data.getFloat32(at + 8, true) * z - data.getFloat32(at + 12, true);
  };
  const head = (hull: number) => data.getInt32(models + 36 + 4 * hull, true);
  const blocked = (x: number, y: number, z: number, hull = 1) => {   // whether a player's origin can't be here
    let node = head(hull);
    while (node >= 0) { const at = clips + 8 * node; node = data.getInt16(at + (side(data.getInt32(at, true), x, y, z) >= 0 ? 4 : 6), true); }
    return node === -2;
  };
  const seen = (low: number[], high: number[], node = head(0)): boolean => {   // whether anything drawn (or sky) may lie inside a box; never says no wrongly
    if (node < 0) {
      const leaf = leaves + 28 * (-node - 1), contents = data.getInt32(leaf, true);
      if (contents !== -2 && contents !== -6) return false;
      if (node === -1) return true;   // leaf 0 stands for all solid space and has no bounds
      for (let a = 0; a < 3; a++) if (data.getInt16(leaf + 8 + 2 * a, true) > high[a] || data.getInt16(leaf + 14 + 2 * a, true) < low[a]) return false;
      return true;
    }
    const at = nodes + 24 * node, plane = planes + 20 * data.getInt32(at, true);
    let near = -data.getFloat32(plane + 12, true), far = near;
    for (let a = 0; a < 3; a++) { const n = data.getFloat32(plane + 4 * a, true); near += n * (n > 0 ? low[a] : high[a]); far += n * (n > 0 ? high[a] : low[a]); }
    if (near >= 0) return seen(low, high, data.getInt16(at + 4, true));
    if (far < 0) return seen(low, high, data.getInt16(at + 6, true));
    return seen(low, high, data.getInt16(at + 4, true)) || seen(low, high, data.getInt16(at + 6, true));
  };
  // Invisible walls at a height: where a standing player's origin is blocked although nothing drawn, the world's or a brush
  // entity's where the map starts it, is within the player's box.
  const invisible = (z: number, [x0, y0, x1, y1]: [number, number, number, number], step = 8) => {
    const w = Math.ceil((x1 - x0) / step) + 1, h = Math.ceil((y1 - y0) / step) + 1, solid = new Uint8Array(w * h), out: number[] = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) solid[j * w + i] = +blocked(x0 + i * step, y0 + j * step, z);
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      if (!solid[k] || solid[k - 1] && solid[k + 1] && solid[k - w] && solid[k + w]) continue;
      const x = x0 + i * step, y = y0 + j * step;
      const low = [x - 16, y - 16, z - 36], high = [x + 16, y + 16, z + 36];
      if (seen(low, high)) continue;
      if (still.some(([number, o]) => seen(low.map((v, a) => v - o[a]), high.map((v, a) => v - o[a]), data.getInt32(models + 64 * number + 36, true)))) continue;   // a desk, door or rail you can see
      out.push(x, y);
    }
    return out;
  };

  const things: Thing[] = [];
  let start: Point | null = null;
  for (const block of text(lumpEntities, lumpEntitiesSize).match(/\{[^{}]*\}/g) || []) {
    const keys: Record<string, string> = {};
    for (const [, k, v] of block.matchAll(/"([^"]*)"\s+"([^"]*)"/g)) keys[k] = v;
    const origin = (keys.origin || "0 0 0").split(/\s+/).map(Number);
    if (keys.classname === "info_player_start" && !start) start = origin as Point;
    const kind = Kinds[keys.classname];
    if (!kind || !/^\*\d+$/.test(keys.model || "")) continue;
    const box = model(+keys.model.slice(1)).box.map((v, i) => Math.round(v + origin[i % 3])) as Box;
    const hidden = +keys.rendermode > 0 && !+keys.renderamt;   // drawn fully see-through: solid, but nothing to see
    if (kind === "wall" && !hidden) continue;   // a visible wall is drawn with the world's surfaces
    things.push({ kind: kind === "wall" ? "invisible" : kind, class: keys.classname, name: keys.targetname || "", target: keys.target || "", to: keys.map || "", box, model: +keys.model.slice(1), keys });
  }
  const count = data.getInt32(8 + 8 * 14, true) / 64, shapes: Box[] = [];
  for (let i = 0; i < count; i++) shapes.push(model(i).box);
  return { floors, walls, water, slopes, things, start, shapes, off: new Set(off), blocked, invisible };
}
