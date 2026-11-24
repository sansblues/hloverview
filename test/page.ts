// The page's side of test.ts. `install` runs inside the page (test.ts sends its source), so it is self-contained: it
// reads the page through window.hloverview and leaves window.checks. Each check returns { name, ok, detail }; moments and
// spots return screen points for test.ts to move a real mouse to.
import type { debug } from "../src/map/engine.ts";
import type { Actor } from "../src/read/actors.ts";

declare const hloverview: typeof debug;
export interface Result { name: string; ok: boolean; detail: string }
export interface Target { what: string; x: number; y: number; title: string }

export function install() {
  const m = hloverview, s = m.state;
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const result = (name: string, ok: unknown, detail: unknown = ""): Result => ({ name, ok: !!ok, detail: String(detail) });
  const client = (x: number, y: number) => { const r = m.canvas.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; };
  const main = (map: string) => s.segments.reduce((best, g, i) => g.map === map && (best < 0 || g.points.length > s.segments[best].points.length) ? i : best, -1);
  const at = async (map: string, after: number) => { await m.go(main(map), after); await frame(); m.paint(); };
  const label = (item: { thing: unknown }) => { const t = item.thing as { name?: string; class?: string; type?: string }; return t?.name || t?.type || t?.class || String(item.thing); };

  // The PB's own facts and the page's reading of them.
  async function data() {
    const out: Result[] = [];
    out.push(result("PB opens first, with its seven stretches in play order",
      s.segments.map(g => g.map).join(" ") === "c1a0 c1a0d c1a0a c1a0b c1a0a c1a0b c1a0e", s.segments.map(g => g.map).join(" ")));
    const bands = document.querySelectorAll(".timeline .band"), span = +document.querySelector(".timeline")!.getAttribute("aria-valuemax")!;
    out.push(result("the timeline spans the whole run, a band per map", Math.abs(span - (m.last() - m.first())) < 0.001 && bands.length === s.segments.length, `${span} s, ${bands.length} bands`));

    // Who's who: 37 placed where the map puts them, 5 carried over a level change, 4 brought back by a save load; none
    // named by model alone. The c1a0 barney is the map's monster_barney.
    const how: Record<string, number> = {};
    for (const g of s.segments) for (const t of g.things) if (t.kind) how[t.how] = (how[t.how] || 0) + 1;
    out.push(result("identities: 37 placed, 5 carried over, 4 restored, 0 by model only", how.placed === 37 && how["carried over"] === 5 && how.restored === 4 && !how.model, JSON.stringify(how)));
    const barney = s.segments[0].things.find(t => t.model === "models/barney.mdl");
    out.push(result("the c1a0 barney is monster_barney", barney?.type === "monster_barney", barney?.type));

    // Gone: what really left the run in sight. Each one checked against the map: the suit is picked up, the CPU glass
    // (blowupcpu) breaks, a scientist is removed by kill_all_npcs, the sample fences (sample_fence) and the wall behind
    // them (sample_block_wall) are removed in the cascade. Times are from the run's start.
    const Gone = ["c1a0d item_suit 20.809", "c1a0b blowupcpu 74.930", "c1a0b blowupcpu 74.930", "c1a0e monster_scientist 138.861",
      "c1a0e sample_block_wall 253.330", "c1a0e sample_fence 258.501", "c1a0e sample_fence 258.501", "c1a0e sample_fence 258.551",
      "c1a0e sample_fence 258.551", "c1a0e sample_fence 258.551"];
    const gone: string[] = [];
    for (const g of s.segments) {
      const level = m.levels[g.map];
      for (const t of g.things) {
        const brush = t.model.startsWith("*") && level.things.find(b => b.model === +t.model.slice(1) && b.kind in m.Groups);
        if (!t.kind && !brush) continue;   // sprites and debris are not drawn
        for (let i = 7; i < t.track.length; i += 8) if (t.track[i] === -1) gone.push(`${g.map} ${t.kind ? t.type : brush ? brush.name || brush.class : ""} ${(t.track[i - 7] - m.first()).toFixed(3)}`);
      }
    }
    gone.sort((a, b) => +a.split(" ").pop()! - +b.split(" ").pop()! || a.localeCompare(b));
    out.push(result("gone: exactly what left the run in sight", gone.join() === Gone.join(), gone.join(" | ")));

    // Breaks in the route: every jump of more than 200 units between frames is one, and so is each of the four save loads
    // in c1a0e (demos 2 to 5 start where the save was made).
    let unmarked = 0;
    for (const g of s.segments) for (let i = 1; i < g.points.length / 5; i++)
      if (Math.hypot(g.points[5 * i + 1] - g.points[5 * i - 4], g.points[5 * i + 2] - g.points[5 * i - 3], g.points[5 * i + 3] - g.points[5 * i - 2]) > 200 && !g.jump[i]) unmarked++;
    out.push(result("every teleport breaks the route", !unmarked, `${unmarked} unmarked`));
    const e = s.segments[6];
    out.push(result("c1a0e breaks at each of the four save loads", e.cuts.length === 4 && e.cuts.every(c => e.jump[c]), JSON.stringify(e.cuts)));

    // Cutting away what is above: steady through jumps (walls drawn change in under 15% of 0.05 s steps; it was 36%
    // before the fix), and never cutting the player's own level, as it did when standing on lifts.
    for (const g of s.segments.filter(g => g.points.length > 500)) {
      const level = m.levels[g.map], p = g.points;
      let changes = 0, steps = 0, previous: number | null = null, cut = 0;
      for (let i = 0; i < p.length; i += 25) {
        const top = m.standing(level, [p[i + 1], p[i + 2], p[i + 3]]) + 72, walls = level.walls.filter(w => w[0] <= top).length;
        if (previous !== null) { steps++; if (walls !== previous) changes++; }
        previous = walls;
        if (top < p[i + 3]) cut++;
      }
      out.push(result(`${g.map}: what is cut away above stays steady (${(100 * changes / steps).toFixed(1)}% of steps change)`, changes / steps < 0.15));
      out.push(result(`${g.map}: the player's own level is never cut away`, !cut, `${cut} frames`));
    }

    // The legend lists what the map has, and nothing else.
    const Listed = ["person", "enemy", "item", "object", "dead", "moving", "level", "trigger", "clip", "hurt", "push", "water", "ladder", "slope"];
    for (let i = 0; i < s.segments.length; i++) {
      await m.go(i); await frame();
      const g = m.segment!, level = m.levels[g.map], want = new Set(["clip"]);
      for (const t of level.things) want.add(({ teleport: "trigger", door: "moving", lift: "moving", breakable: "moving", button: "moving", invisible: "clip" } as Record<string, string>)[t.kind] || t.kind);
      if (level.water.length) want.add("water");
      if (level.slopes.length) want.add("slope");
      for (const d of g.actors) want.add(({ critter: "object", projectile: "enemy" } as Record<string, string>)[d.kind!] || d.kind!);
      if (g.actors.some((d: Actor) => m.dead(d, d.shape.length ? d.shape[d.shape.length - 9] : 0))) want.add("dead");
      const shown = [...document.querySelectorAll<HTMLElement>(".legend [data-show]")].map(e => e.dataset.show!).filter(k => Listed.includes(k));
      const extra = shown.filter(k => !want.has(k)), missing = [...want].filter(k => k !== "dead" && Listed.includes(k) && !shown.includes(k));
      out.push(result(`${g.map} #${i}: the legend lists what the map has`, !extra.length && !missing.length, `extra ${extra} missing ${missing}`));
    }
    return out;
  }

  // A moment: everything drawn, each with a screen point where hovering picks it, and its card's title. Drawing is
  // checked too: each person, enemy, item and object covers exactly its box, whether in view, out of sight or dead.
  async function moment(map: string, after: number) {
    await at(map, after);
    const r = m.canvas.getBoundingClientRect(), ctx = m.ctx, targets: Target[] = [], ops: { x: number; y: number; w: number; h: number; color: string; line: number }[] = [];
    const original = { fill: ctx.fillRect, stroke: ctx.strokeRect };
    ctx.fillRect = function (x, y, w, h) { ops.push({ x, y, w, h, color: String(this.fillStyle), line: 0 }); return original.fill.call(this, x, y, w, h); };
    ctx.strokeRect = function (x, y, w, h) { ops.push({ x, y, w, h, color: String(this.strokeStyle), line: this.lineWidth }); return original.stroke.call(this, x, y, w, h); };
    try { m.paint(); } finally { ctx.fillRect = original.fill; ctx.strokeRect = original.stroke; }

    for (const item of m.shown) {
      let title: string;
      try { title = item.card().title; } catch (error) { targets.push({ what: label(item), x: -1, y: -1, title: `card fails: ${(error as Error).message}` }); continue; }
      const [x0, y0, x1, y1] = item.box!, candidates = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75], [0.75, 0.25], [0.1, 0.5], [0.9, 0.5], [0.5, 0.1], [0.5, 0.9]];
      for (const [u, v] of candidates) {
        const [sx, sy] = m.toScreen(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v);
        if (sx < 2 || sy < 2 || sx > r.width - 2 || sy > r.height - 2) continue;
        if (m.hit(sx, sy)?.thing !== item.thing) continue;   // covered there by something nearer the top
        const { x, y } = client(sx, sy);
        if (document.elementFromPoint(x, y) !== m.canvas) continue;   // or by the legend, the bars, a readout
        targets.push({ what: label(item), x, y, title });
        break;
      }
    }

    // Sizes: the outer edge of what is drawn for each actor is its box, to a hundredth of a pixel.
    const size: string[] = [], actors = new Set<unknown>(m.segment!.actors);
    for (const item of m.shown.filter(i => actors.has(i.thing))) {
      const [x0, y0, x1, y1] = item.box!, a = m.toScreen(x0, y1), c = m.toScreen(x1, y0), w = Math.max(c[0] - a[0], 4), h = Math.max(c[1] - a[1], 4);
      const box = [(a[0] + c[0] - w) / 2, (a[1] + c[1] - h) / 2, w, h], color = m.css(m.Kinds[(item.thing as Actor).kind!]).toLowerCase();
      const mine = ops.filter(o => Math.abs(o.x - o.line / 2 - box[0]) < 0.01 + o.line && Math.abs(o.y - o.line / 2 - box[1]) < 0.01 + o.line && o.w + o.line <= box[2] + 0.02 + o.line);
      const edges = mine.filter(o => o.color.toLowerCase() === color).map(o => o.line ? [o.x - o.line / 2, o.y - o.line / 2, o.w + o.line, o.h + o.line] : [o.x, o.y, o.w, o.h]);
      const dark = mine.some(o => o.color.toLowerCase() === m.css("--ground").toLowerCase());
      if (!edges.length || dark || edges.some(e => e.some((v, k) => Math.abs(v - box[k]) > 0.01))) size.push(`${label(item)} ${JSON.stringify(edges)} vs ${JSON.stringify(box)}${dark ? " darkened" : ""}`);
    }
    return { targets, size: result(`${map} at +${after} s: every person, enemy, item and object is drawn exactly its box`, !size.length, size.slice(0, 2).join("; ")) };
  }

  // The title of the card on screen, once the page has drawn what the mouse did.
  async function card() { await frame(); return document.querySelector(".tip strong")?.textContent ?? null; }

  // The player, and a spot of the route only the route claims.
  async function spots() {
    await at("c1a0d", 12);
    const g = m.segment!, p = g.points, k = m.index(s.now), [px, py] = m.toScreen(p[5 * k + 1], p[5 * k + 2]);
    const out: { player: { x: number; y: number }; route?: { x: number; y: number; time: number } } = { player: client(px, py) };
    for (let i = Math.floor(p.length / 10); i < p.length / 5; i += 7) {
      const [sx, sy] = m.toScreen(p[5 * i + 1], p[5 * i + 2]);
      if (sx < 20 || sy < 20 || sx > m.canvas.clientWidth - 20 || sy > m.canvas.clientHeight - 20) continue;
      if (m.hit(sx, sy)?.time === p[5 * i]) { out.route = { ...client(sx, sy), time: p[5 * i] }; break; }
    }
    return out;
  }

  // Playback runs from one map into the next by itself.
  async function playback() {
    const c1a0 = s.segments[0], end = c1a0.points[c1a0.points.length - 5];
    await m.go(0); m.seek(end - 0.2);
    m.toggle();
    await new Promise(r => setTimeout(r, 900));
    const map = m.segment!.map, pressed = String(document.querySelectorAll(".timeline .band")[1]?.classList.contains("on"));
    if (s.playing) m.toggle();
    return [result("playback crosses from c1a0 into c1a0d by itself", map === "c1a0d" && pressed === "true", `${map} ${pressed}`)];
  }

  // The ghost: chosen, drawn, and its split in c1a0d as worked out apart from the page.
  async function ghost(expected: { run: string; files: string[]; split: number }) {
    await m.compare({ name: expected.run, files: expected.files });
    await at("c1a0d", 12); await frame();
    const text = document.querySelector(".readout .split b")?.textContent, want = `${expected.split > 0 ? "+" : expected.split < 0 ? "−" : "±"}${Math.abs(expected.split).toFixed(3)}`;
    const shown = getComputedStyle(document.querySelector(".readout .split")!).visibility !== "hidden";
    return [result(`the ghost's split in c1a0d is ${want}`, shown && text === want, text), result("the ghost is drawn", !!m.ghostAt())];
  }

  // Where the ghost's marker is, at a moment it stands clear of the player.
  async function ghostSpot() {
    for (let after = 2; after < 25; after += 0.5) {
      await at("c1a0d", after);
      const there = m.ghostAt(), g = m.segment!.twin!.points, p = m.segment!.points, k = m.index(s.now);
      if (!there) continue;
      const [gx, gy] = m.toScreen(g[5 * there.at + 1], g[5 * there.at + 2]), [px, py] = m.toScreen(p[5 * k + 1], p[5 * k + 2]);
      if (Math.hypot(gx - px, gy - py) > 40 && m.hit(gx, gy)?.thing === "ghost") return client(gx, gy);
    }
    return null;
  }

  // The playhead stands in the current map's band, as far along it as the run is through that map.
  async function playhead() {
    await at("c1a0e", 50); await frame();
    const p = m.segment!.points, band = document.querySelector(".timeline .band.on")!.getBoundingClientRect(), head = document.querySelector(".timeline .head")!.getBoundingClientRect();
    const want = band.left + band.width * (s.now - p[0]) / (p[p.length - 5] - p[0]);
    return Math.abs(head.left + head.width / 2 - want) < 1.5;
  }

  // A load replaces everything: at each of the run's loads, every life from before it has ended (and there are some).
  function loads() {
    let total = 0, kept = 0;
    for (const g of s.segments) for (const loaded of g.loads) {
      for (const t of g.things) if (t.track[0] < loaded - 1e-3) { total++; const record = m.latest(t.track, loaded + 0.01); if (record && record[7] >= 0) kept++; }
    }
    return total > 0 && kept === 0;
  }

  Object.assign(window, { checks: { data, moment, card, spots, playback, ghost, ghostSpot, playhead, loads } });
}
