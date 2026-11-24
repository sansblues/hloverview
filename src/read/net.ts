// Decode the network messages inside a Half-Life demo (protocol 48) into where every entity was, frame by frame.
// The message layouts follow hlviewer.js (MIT, Stefan Stojković), with two corrections: only entities 1 to maxclients
// use the player's delta, and a delta update applies to the frame it names, not to the latest one.

export type State = Record<string, number | string>;   // an entity's or the player's fields, by the names the demo gives them
export type Frame = (State | undefined)[] & { sequence?: number };

interface Field { name: string; bits: number; divisor: number; flags: number; post?: number }

class Bits {
  bytes: Uint8Array;
  at: number;
  limit: number;
  constructor(bytes: Uint8Array, at: number, limit: number) { this.bytes = bytes; this.at = at * 8; this.limit = limit * 8; }
  read(count: number) {
    if (this.at + count > this.limit) throw new RangeError("A message ends before its data does.");   // never read into the next message, or forever past the file
    let value = 0;
    for (let i = 0; i < count;) {
      const byte = this.bytes[this.at >> 3], offset = this.at & 7, take = Math.min(count - i, 8 - offset);
      value += ((byte >> offset) & ((1 << take) - 1)) * 2 ** i;
      this.at += take; i += take;
    }
    return value;
  }
  signed(count: number) { const negative = this.read(1); const value = this.read(count - 1); return negative ? -value : value; }
  string() { let s = ""; for (let c; (c = this.read(8));) s += String.fromCharCode(c); return s; }
  end() { return Math.ceil(this.at / 8); }
}

const Float = 4, Integer = 8, Angle = 16, Window8 = 32, Text = 128, Signed = 2 ** 31;
const Describe: Field[] = [
  { name: "flags", bits: 32, divisor: 1, flags: Integer }, { name: "name", bits: 8, divisor: 1, flags: Text },
  { name: "offset", bits: 16, divisor: 1, flags: Integer }, { name: "size", bits: 8, divisor: 1, flags: Integer },
  { name: "bits", bits: 8, divisor: 1, flags: Integer }, { name: "divisor", bits: 32, divisor: 4000, flags: Float },
  { name: "post", bits: 32, divisor: 4000, flags: Float },
];

function delta(bits: Bits, fields: Field[], into: State = {}) {
  const masks = bits.read(3), mask: number[] = [];
  for (let i = 0; i < masks; i++) mask.push(bits.read(8));
  for (let i = 0; i < masks * 8 && i < fields.length; i++) {
    if (!(mask[i >> 3] & (1 << (i & 7)))) continue;
    const f = fields[i], flags = f.flags >>> 0;
    if (flags & Text) into[f.name] = bits.string();
    else if (flags & Angle) into[f.name] = bits.read(f.bits) * 360 / 2 ** f.bits;
    else if (flags & Window8) into[f.name] = bits.signed(f.bits) / 100;
    else into[f.name] = (flags & Signed ? bits.signed(f.bits) : bits.read(f.bits)) / (f.divisor || 1) * (f.post ?? 1);   // the engine scales after dividing
  }
  return into;
}

const Fixed: Record<number, number> = { 0: 24, 1: 20, 2: 6, 3: 11, 4: 6, 5: 10, 6: 12, 7: 17, 8: 16, 9: 6, 10: 6, 11: 6, 12: 8, 14: 9, 15: 19, 17: 10, 18: 16,
  19: 24, 20: 24, 21: 24, 22: 10, 23: 11, 24: 16, 25: 19, 27: 12, 28: 16, 30: 17, 31: 17, 99: 2, 100: 10, 101: 14, 102: 12, 103: 14,
  104: 9, 105: 5, 106: 17, 107: 13, 108: 24, 109: 9, 110: 17, 111: 7, 112: 10, 113: 19, 114: 19, 115: 12, 116: 7, 117: 7, 118: 9,
  119: 16, 120: 18, 121: 5, 122: 10, 123: 13, 124: 7, 125: 1, 126: 18, 127: 15 };   // temporary effects: bytes after the type

// A world: the entities of one connection, kept per incoming sequence so deltas find the frame they build on.
export interface World {
  deltas: Record<string, Field[]>;
  baseline: (State | undefined)[];
  extra: State[];
  frames: (Frame | undefined)[];
  current: Frame;
  maxclients: number;
  player?: number;
  map?: string;
  changed?: boolean;
  hltv?: boolean;
  models: string[];
  user: Record<number, number>;
  clients: (State | undefined)[];   // the player's own data, by frame, as entities are
  client: State | null;
}

export function world(): World {
  return { deltas: { delta_description_t: Describe }, baseline: [], extra: [], frames: new Array(256), current: [], maxclients: 1, models: [], user: {},
    clients: new Array(256), client: null };
}

const kind = (w: World, number: number, custom: number) => number > 0 && number <= w.maxclients ? "entity_state_player_t" : custom ? "custom_entity_state_t" : "entity_state_t";

// Read one network message block; returns the entity states after it, or null if it carried none.
export function messages(w: World, bytes: Uint8Array, view: DataView, at: number, end: number, sequence: number): Frame | null {
  let entities: Frame | null = null;
  const string = () => { let s = ""; while (at < end && bytes[at]) s += String.fromCharCode(bytes[at++]); at++; return s; };
  while (at < end) {
    const type = bytes[at++];
    if (type >= 64) {
      const size = w.user[type];
      at += size !== undefined && size !== 255 ? size : 1 + bytes[at];
      continue;
    }
    switch (type) {
      case 1: case 19: case 27: case 28: case 30: case 42: break;   // no payload
      case 2: case 8: case 9: case 26: case 31: case 34: case 49: case 56: case 57: string(); break;
      case 3: {   // events
        const b = new Bits(bytes, at, end), count = b.read(5);
        for (let i = 0; i < count; i++) { b.read(10); if (b.read(1)) { b.read(11); if (b.read(1)) delta(b, w.deltas.event_t); } if (b.read(1)) b.read(16); }
        at = b.end(); break;
      }
      case 4: at += 4; break;
      case 5: at += 2; break;
      case 6: {   // sound
        const b = new Bits(bytes, at, end), flags = b.read(9);
        if (flags & 1) b.read(8);
        if (flags & 2) b.read(8);
        b.read(3); b.read(11); b.read(flags & 4 ? 16 : 8);
        const has = [b.read(1), b.read(1), b.read(1)];
        for (const h of has) if (h) { const whole = b.read(1), part = b.read(1); if (whole || part) { b.read(1); if (whole) b.read(12); if (part) b.read(3); } }
        if (flags & 8) b.read(8);
        at = b.end(); break;
      }
      case 7: at += 4; break;
      case 10: at += 6; break;
      case 11: {   // server info: a new map, a new world
        at += 4 + 4 + 4 + 16;
        w.maxclients = bytes[at]; w.player = bytes[at + 1] + 1; at += 3;
        string(); string(); w.map = string().replace(/^maps\//, "").replace(/\.bsp$/, ""); string(); at++;
        w.baseline = []; w.extra = []; w.frames = new Array(256); w.current = []; w.models = []; w.changed = true;
        break;
      }
      case 12: at++; string(); break;
      case 13: at += 5; string(); at += 16; break;
      case 14: {   // a delta's description
        const name = string(), count = view.getUint16(at, true), b = new Bits(bytes, at + 2, end), fields: Field[] = [];
        for (let i = 0; i < count; i++) fields.push(delta(b, Describe) as unknown as Field);
        w.deltas[name] = fields; at = b.end(); break;
      }
      case 15: {   // client data; an HLTV proxy's demo has none, the message is empty
        if (w.hltv) break;
        const b = new Bits(bytes, at, end);
        const base = b.read(1) ? w.clients[b.read(8)] || {} : {};   // built on an earlier frame's, like entities
        const data = delta(b, w.deltas.clientdata_t, Object.assign({}, base));
        data.sequence = sequence; w.clients[sequence & 255] = w.client = data;
        while (b.read(1)) { b.read(6); delta(b, w.deltas.weapon_data_t); }
        at = b.end(); break;
      }
      case 16: at += 2; break;
      case 17: { const b = new Bits(bytes, at, end); while (b.read(1)) b.read(24); at = b.end(); break; }
      case 18: at += 11; break;
      case 20: { at += 17; if (bytes[at - 1]) at += 5; break; }
      case 21: { const b = new Bits(bytes, at, end); b.read(10); delta(b, w.deltas.event_t); if (b.read(1)) b.read(16); at = b.end(); break; }
      case 22: {   // baselines
        const b = new Bits(bytes, at, end);
        for (;;) {
          const number = b.read(11);
          if (number === 2047) break;
          const type = b.read(2);
          w.baseline[number] = delta(b, w.deltas[type & 1 ? kind(w, number, 0) : "custom_entity_state_t"]);
        }
        if (b.read(5) !== 31) throw new Error("A baseline message is malformed.");
        const count = b.read(6);
        for (let i = 0; i < count; i++) w.extra.push(delta(b, w.deltas.entity_state_t));
        at = b.end(); break;
      }
      case 23: {   // a temporary effect
        const effect = bytes[at++];
        if (effect === 13) { at += 10; if (view.getInt16(at - 2, true)) at += 2; }   // a decal on an entity names it
        else if (effect === 29) {
          at += 1 + 2 + 2; const style = bytes[at++]; at += 8 + 6; if (style === 2) at += 2; string();
        } else if (Fixed[effect] !== undefined) at += Fixed[effect];
        else throw new Error(`The demo has a temporary effect of unknown type ${effect}.`);
        break;
      }
      case 24: case 25: at++; break;
      case 29: at += 14; break;
      case 32: at += 2; break;
      case 33: { string(); const maps = bytes[at++]; for (let i = 0; i < maps; i++) string(); break; }
      case 35: at += 2; break;
      case 36: at++; string(); break;
      case 37: at += 2; break;
      case 38: at += 2; break;
      case 39: { const index = bytes[at], size = bytes[at + 1]; w.user[index] = size; at += 18; break; }
      case 40: case 41: {   // where the entities are
        const b = new Bits(bytes, at, end);
        b.read(16);
        let from: Frame | undefined;
        if (type === 41) {
          from = w.frames[b.read(8)];
          if (!from || from.sequence! >= sequence || sequence - from.sequence! > 64)   // the server keeps 64 frames to build on
            throw new Error("A delta update names a frame the demo doesn't have.");
        }
        const next: Frame = from ? from.slice() : [];
        let number = 0;
        const order: number[] = [];   // the entities of this packet, in the order decoded
        for (;;) {
          if (b.read(16) === 0) break;
          b.at -= 16;
          if (type === 41) {
            const remove = b.read(1);
            number = b.read(1) ? b.read(11) : number + b.read(6);
            if (remove) { next[number] = undefined; continue; }
          } else if (b.read(1)) number++;
          else number = b.read(1) ? b.read(11) : number + b.read(6);
          const custom = b.read(1);
          let base = type === 41 ? next[number] || w.baseline[number] : w.baseline[number];
          if (type === 40) {   // the engine's header: an instanced baseline when there are any, else an earlier entity of this packet
            if (w.extra.length && b.read(1)) base = w.extra[b.read(6)];
            else if (b.read(1)) base = next[order[order.length - b.read(6)]];
          }
          order.push(number);
          next[number] = delta(b, w.deltas[kind(w, number, custom)], Object.assign({}, base || {}));
        }
        next.sequence = sequence;
        w.frames[sequence & 255] = next;
        w.current = entities = next;
        at = b.end(); break;
      }
      case 43: {   // resources: model numbers to names
        const b = new Bits(bytes, at, end), count = b.read(12);
        for (let i = 0; i < count; i++) {
          const type = b.read(4), name = b.string(), index = b.read(12);
          b.read(24);
          if (b.read(3) & 4) b.at += 128;
          if (b.read(1)) b.at += 256;
          if (type === 2) w.models[index] = name;
        }
        if (b.read(1)) while (b.read(1)) b.at += b.read(1) ? 5 : 10;
        at = b.end(); break;
      }
      case 44: at += 16 * 4 + 1 + 2 * 4 + 6 * 4; string(); break;
      case 45: at += 8; break;
      case 46: { at += 2; string(); at += 7; if (bytes[at - 1] & 4) at += 16; break; }
      case 47: at += 2; break;
      case 48: at += 4; break;
      case 50: {   // HLTV: active (recorded by a proxy), status (18 bytes of counts), listen (an address)
        const mode = bytes[at++];
        if (mode === 0) w.hltv = true;
        else if (mode === 1) at += 18;
        else if (mode === 2) string();
        break;
      }
      case 51: at += 1 + bytes[at]; break;
      case 52: string(); at++; break;
      case 53: at += 3 + view.getUint16(at + 1, true); break;
      case 54: string(); at++; break;
      case 55: at += 4; break;
      case 58: at += 4; string(); break;
      default: throw new Error(`The demo has a message of unknown type ${type}.`);
    }
  }
  return entities;
}
