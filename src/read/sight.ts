// Which entities a Half-Life server sends: the potentially visible set (PVS) around the player's eye, as the engine and
// game decide it (ReHLDS sv_main.cpp SV_FatPVS / SV_CheckVisibility, world.cpp SV_FindTouchedLeafs; HLSDK client.cpp
// SetupVisibility / AddToFullPack, cbase.cpp SetObjectCollisionBox).

export type Vec = ArrayLike<number>;
export type Bounds = [number[], number[]];   // low, high
export interface Sight { view(eye: Vec): Uint8Array; sees(set: Uint8Array, low: Vec, high: Vec): boolean; inSight(eyes: Vec[], bounds: Bounds): boolean }

type Plane = [number, number, number, number, number];   // normal, distance, type
const Solid = -2;

export function sight(buffer: ArrayBuffer): Sight {
  const data = new DataView(buffer), bytes = new Uint8Array(buffer);
  const lump = (i: number) => [data.getInt32(4 + 8 * i, true), data.getInt32(8 + 8 * i, true)];
  const [planes] = lump(1), [vis, visSize] = lump(4), [nodes] = lump(5), [leaves] = lump(10), [models] = lump(14);
  const visleafs = data.getInt32(models + 52, true), row = (visleafs + 7) >> 3;

  const plane = (i: number): Plane => { const at = planes + 20 * i; return [data.getFloat32(at, true), data.getFloat32(at + 4, true), data.getFloat32(at + 8, true), data.getFloat32(at + 12, true), data.getInt32(at + 16, true)]; };
  const child = (node: number, side: number) => data.getInt16(nodes + 24 * node + 4 + 2 * side, true);   // >= 0 a node, else leaf -1 - child
  const contents = (leaf: number) => data.getInt32(leaves + 28 * leaf, true);

  // A leaf's PVS: run-length coded, a 0 byte followed by how many 0 bytes it stands for. No data: everything is visible.
  const rows = new Map<number, Uint8Array>();
  function pvs(leaf: number) {
    const known = rows.get(leaf);
    if (known) return known;
    const out = new Uint8Array(row), at = data.getInt32(leaves + 28 * leaf + 4, true);
    if (at < 0 || !visSize) out.fill(255);
    else for (let p = vis + at, o = 0; o < row;) {
      if (bytes[p]) out[o++] = bytes[p++];
      else { o += bytes[p + 1]; p += 2; }
    }
    rows.set(leaf, out);
    return out;
  }

  // What the server sees from an eye: every leaf within 8 units of it, merged (the "fat" PVS).
  function view(eye: Vec) {
    const out = new Uint8Array(row);
    (function add(node: number) {
      while (node >= 0) {
        const [nx, ny, nz, dist] = plane(data.getInt32(nodes + 24 * node, true)), d = nx * eye[0] + ny * eye[1] + nz * eye[2] - dist;
        if (d > 8) node = child(node, 0);
        else if (d < -8) node = child(node, 1);
        else { add(child(node, 0)); node = child(node, 1); }
      }
      const leaf = -1 - node;
      if (contents(leaf) !== Solid) { const p = pvs(leaf); for (let i = 0; i < row; i++) out[i] |= p[i]; }
    })(0);
    return out;
  }

  // Which sides of a plane a box is on: 1 front, 2 back, 3 both (BOX_ON_PLANE_SIDE).
  function sides([nx, ny, nz, dist, type]: Plane, low: Vec, high: Vec) {
    if (type < 3) return dist <= low[type] ? 1 : dist >= high[type] ? 2 : 3;
    const n = [nx, ny, nz];
    let far = 0, near = 0;
    for (let a = 0; a < 3; a++) { far += n[a] * (n[a] >= 0 ? high[a] : low[a]); near += n[a] * (n[a] >= 0 ? low[a] : high[a]); }
    return (far >= dist ? 1 : 0) | (near < dist ? 2 : 0);
  }

  // Whether an entity with this box is sent to an eye that sees `set`. The engine lists the box's leaves; past 48 it
  // keeps only the first node the box straddles and asks whether any leaf below that node is visible.
  function sees(set: Uint8Array, low: Vec, high: Vec) {
    const visible = (leaf: number) => leaf - 1 < visleafs && !!(set[(leaf - 1) >> 3] & (1 << ((leaf - 1) & 7)));
    const touched: number[] = [];
    let top = -1;
    (function walk(node: number) {
      if (node < 0) { const leaf = -1 - node; if (contents(leaf) !== Solid) touched.push(leaf); return; }
      const s = sides(plane(data.getInt32(nodes + 24 * node, true)), low, high);
      if (s === 3 && top < 0) top = node;
      if (s & 1) walk(child(node, 0));
      if (s & 2) walk(child(node, 1));
    })(0);
    if (touched.length <= 48) return touched.some(visible);
    return (function any(node: number): boolean {   // CM_HeadnodeVisible
      if (node < 0) { const leaf = -1 - node; return contents(leaf) !== Solid && visible(leaf); }
      return any(child(node, 0)) || any(child(node, 1));
    })(top);
  }

  // Whether a box is in view from every eye given. An entity that stops being sent while its last box is in view from
  // that frame's eye and the next one's vanished in sight: removed, or made invisible. Otherwise it only left sight.
  const inSight = (eyes: Vec[], [low, high]: Bounds) => eyes.every(e => sees(view(e), low, high));

  return { view, sees, inSight };
}

// The box an entity is linked by: origin + mins/maxs, or a cube around the origin for a turned solid brush (SOLID_BSP
// only: a non-solid one keeps its unturned box); 1 unit wider on every side (SetObjectCollisionBox). Brush mins/maxs
// are the BSP model's bounds, 1 unit wider (Mod_LoadSubmodels).
export function linked(origin: number[], angles: number[], mins: number[], maxs: number[], solidBrush: boolean): Bounds {
  if (solidBrush && (angles[0] || angles[1] || angles[2])) {
    const r = Math.max(...mins.map(Math.abs), ...maxs.map(Math.abs));
    return [origin.map(v => v - r - 1), origin.map(v => v + r + 1)];
  }
  return [origin.map((v, a) => v + mins[a] - 1), origin.map((v, a) => v + maxs[a] + 1)];
}
