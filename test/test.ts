// hloverview's tests: what it reads from demos and maps, checked against facts, and the built page driven like a person would.
//
// usage: pnpm test   with, optionally, DEMOS (a demos folder with the ghost run and a cut-off one), STEAM (a Steam legacy
// valve folder with lambda.dem) and DUMPS (the engine's own entity dumps for lambda.dem); checks that need them skip without.
//
// Facts come from the game's files (counts read once and kept here; a change means the reading changed), the PB itself
// (its official time, the harness's record of when it entered each map), and the engine (its entity dumps).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { demo, type Stretch } from "../src/read/demo.ts";
import { level } from "../src/read/level.ts";
import { group } from "../src/map/run.ts";
import { install, type Result, type Target } from "./page.ts";

const Here = import.meta.dirname, Maps = path.join(Here, "../public/maps"), PB = path.join(Here, "../public/example");
const { DEMOS: Demos, STEAM: Steam, DUMPS: Dumps } = process.env, Ghost = "2026-11-15 22.05.20 AM-IL";
const skip = (what: string, needs: string) => console.log(`skip  ${what}: set ${needs}`);

let failed = 0, passed = 0;
function check(name: string, ok: unknown, detail = "") {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
}
const read = (file: string) => { const b = fs.readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const pb = [1, 2, 3, 4, 5].map(i => `${PB}/AM-IL_${i}.dem`);
const shape = (d: Stretch[]) => d.map(s => [s.map, s.points.length / 5, +s.points[0].toFixed(3), +s.points[s.points.length - 5].toFixed(3)]);

function decoding() {
  // The PB as the decoder read it when every check below was made: map, points, first and last time of each stretch.
  // A player point takes the time of the server frame it shows, one frame before its own (412,011 of 412,011 moving
  // frames in 113 runs agree), so the player and the world share one clock.
  const Expected = [
    [["c1a0", 1389, 0, 13.875], ["c1a0d", 2429, 14.096, 40.784], ["c1a0a", 2168, 40.992, 62.668], ["c1a0b", 35, 62.889, 63.229],
     ["c1a0a", 34, 63.433, 63.763], ["c1a0b", 2360, 63.986, 87.583], ["c1a0e", 17625, 87.84, 266.906]],
    [["c1a0e", 44, 0, 0.42]], [["c1a0e", 35, 0, 0.33]], [["c1a0e", 41, 0, 0.39]], [["c1a0e", 121, 0, 1.19]]];
  const decoded = pb.map(f => demo(read(f)));
  decoded.forEach((d, i) => check(`PB demo ${i + 1}: its maps, frames and times`, JSON.stringify(shape(d)) === JSON.stringify(Expected[i]), JSON.stringify(shape(d))));

  // The official time (4:28.522) lies between the time spent inside maps and the demos' whole length: the timer counts
  // some of the loading the stretches leave out.
  const inside = decoded.flat().reduce((t, s) => t + s.points[s.points.length - 5] - s.points[0], 0);
  const whole = decoded.reduce((t, d) => t + d[d.length - 1].points[d[d.length - 1].points.length - 5], 0);
  check("PB: the official 268.522 s lies between time in maps and the demos' length", inside <= 268.522 && 268.522 <= whole, `${inside} … ${whole}`);

  const points = decoded.flat().flatMap(s => { const out = []; for (let i = 0; i < s.points.length; i += 5) out.push(s.points.subarray(i, i + 5)); return out; });
  check("PB: no point at 0 0 0 (a level loading, not a place)", !points.some(p => !p[1] && !p[2] && !p[3]));
  check("PB: every stretch has the player's eye for every frame", decoded.flat().every(s => s.eyes.length / 4 >= s.points.length / 5));

  // Lives: when the game reuses an entity's slot for something else, both keep their tracks, and the first ends unseen.
  // The PB reuses none; the Steam demo reuses two.
  const lives = decoded[0].reduce((n, s) => n + s.things.length, 0);
  check("PB demo 1: 399 lives", lives === 399, `${lives}`);

  // The harness's own record of when it entered each map (game seconds): the demo's clock starts no earlier and gains a
  // little at each load (0.2 s over four).
  const Entered = { c1a0d: 15.682, c1a0a: 64.195, c1a0b: 111.097, c1a0e: 178.723 };
  const lambda = Steam ? demo(read(`${Steam}/lambda.dem`)) : null;
  if (lambda) {
    let reused = 0, open = 0;
    for (const s of lambda) {
      const bySlot = new Map<number, Stretch["things"]>();
      for (const t of s.things) bySlot.set(t.number, [...(bySlot.get(t.number) || []), t]);
      for (const list of bySlot.values()) for (let i = 0; i + 1 < list.length; i++) { reused++; if (list[i].track[list[i].track.length - 1] === 1) open++; }
    }
    check("Steam demo: 2 slots reused, and each earlier occupant ends unseen", reused === 2 && open === 0, `${reused} reused, ${open} left seen`);
    check("Steam demo: maps in order", lambda.map(s => s.map).join(" ") === "c1a0 c1a0d c1a0a c1a0b c1a0e c1a0c", lambda.map(s => s.map).join(" "));
    check("Steam demo: each map starts when the harness entered it, at most 0.25 s later",
      Object.entries(Entered).every(([map, t]) => { const s = lambda.find(x => x.map === map)!; return s.points[0] >= t && s.points[0] - t <= 0.25; }));
  } else skip("the Steam demo", "STEAM");
  // Before a demo starts playing, its frames carry the engine's own clock (92 s into the PB, 267 s into its second demo):
  // read as 0, every track only goes forward. A full update may build an entity on one earlier in the same packet:
  // read as such, no entity is left without a model.
  const forward = (d: Stretch[]) => d.every(s => s.things.every(t => { for (let i = 8; i < t.track.length; i += 8) if (t.track[i] < t.track[i - 8]) return false; return true; }));
  check("every entity's times only go forward", decoded.every(forward) && (!lambda || forward(lambda)));
  const modelless = [...decoded.flat(), ...lambda ?? []].reduce((n, s) => n + s.things.filter(t => !t.model).length, 0);
  check("every entity has a model", !modelless, `${modelless} without`);

  // A demo the game never finished writing (a crash or quit mid-run) reads up to where it stops.
  if (Demos) {
    let cut: unknown = null;
    try { cut = shape(demo(read(`${Demos}/2026-11-23 22.07.53 AM-IL/AM-IL_1.dem`))); } catch (error) { cut = (error as Error).message; }
    check("cut-off demo: read up to where it stops", JSON.stringify(cut) === JSON.stringify([["c1a0", 1459, 0, 14.576], ["c1a0d", 235, 14.795, 18.159]]), JSON.stringify(cut));
  } else skip("the cut-off demo", "DEMOS");

  // Damage: bytes changed at random never hang the reader nor escape as a programming error.
  const original = new Uint8Array(read(pb[1])), bad: string[] = [];
  let seed = 1;
  const random = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for (let trial = 0; trial < 60; trial++) {
    const copy = original.slice();
    for (let k = 0; k < 1 + trial % 8; k++) copy[544 + Math.floor(random() * (copy.length - 544))] = Math.floor(random() * 256);
    const start = Date.now();
    try { demo(copy.buffer); } catch (error) { if (error instanceof TypeError || (error as Error).constructor !== Error) bad.push(`${trial}: ${(error as Error).constructor.name} ${(error as Error).message}`); }
    if (Date.now() - start > 2000) bad.push(`${trial}: took ${Date.now() - start} ms`);
  }
  check("damaged demos: 60 corruptions, each read or refused with a plain message", !bad.length, bad.slice(0, 3).join("; "));
}

function mapping() {
  // Counts as read when every check was made: floors, walls, steep slopes, water, brush entities drawn, models.
  // Things include the solid see-through func_walls: stew2 in c1a0d, sample_block_wall in c1a0e.
  const Expected = { c1a0: [648, 1722, 10, 0, 40, 77], c1a0d: [674, 1958, 30, 0, 59, 95], c1a0a: [526, 1348, 69, 0, 62, 92],
    c1a0b: [603, 1725, 97, 0, 49, 102], c1a0e: [476, 1073, 102, 0, 57, 95] };
  for (const [name, counts] of Object.entries(Expected)) {
    const m = level(read(`${Maps}/${name}.bsp`)), got = [m.floors.length, m.walls.length, m.slopes.length, m.water.length, m.things.length, m.shapes.length];
    check(`${name}: floors, walls, slopes, water, things, models`, got.join() === counts.join(), got.join());
    // Every invisible wall, checked by a reader of its own: the standing player is blocked there, and nothing drawn
    // (the world, or a brush entity the game draws where the map puts it) lies in the player's box, sampled every 2 units.
    const hull = Hull(read(`${Maps}/${name}.bsp`)), xs = m.floors.flatMap(f => f.filter((_, i) => i % 2)), ys = m.floors.flatMap(f => f.filter((_, i) => i && i % 2 === 0));
    const bounds: [number, number, number, number] = [Math.min(...xs) - 32, Math.min(...ys) - 32, Math.max(...xs) + 32, Math.max(...ys) + 32], wrong: string[] = [];
    let cells = 0;
    for (const z of [m.start![2], ...new Set(m.floors.map(f => f[0] + 36))].slice(0, 12)) {
      const found = m.invisible(z, bounds);
      for (let i = 0; i < found.length; i += 2) {
        cells++;
        const [x, y] = [found[i], found[i + 1]];
        if (!hull.blocked(x, y, z)) wrong.push(`${x} ${y} ${z} not blocked`);
        else if (hull.drawnNear(x, y, z)) wrong.push(`${x} ${y} ${z} next to something drawn`);
      }
    }
    check(`${name}: every invisible wall at 12 heights is blocked and has nothing drawn near (${cells} cells)`, !wrong.length, wrong.slice(0, 3).join("; "));
  }
}

// A second, independent reader of a map's collision: point contents in hull 0 (drawn) and hull 1 (standing player).
function Hull(buffer: ArrayBuffer) {
  const data = new DataView(buffer), lump = (i: number) => [data.getInt32(4 + 8 * i, true), data.getInt32(8 + 8 * i, true)];
  const [planes] = lump(1), [nodes] = lump(5), [clips] = lump(9), [leaves] = lump(10), [models] = lump(14), [text, size] = lump(0);
  const side = (plane: number, p: number[]) => { const a = planes + 20 * plane; return data.getFloat32(a, true) * p[0] + data.getFloat32(a + 4, true) * p[1] + data.getFloat32(a + 8, true) * p[2] - data.getFloat32(a + 12, true); };
  const drawn = (model: number, p: number[]) => {   // solid or sky in hull 0 of a model
    let node = data.getInt32(models + 64 * model + 36, true);
    while (node >= 0) node = data.getInt16(nodes + 24 * node + (side(data.getInt32(nodes + 24 * node, true), p) >= 0 ? 4 : 6), true);
    const contents = data.getInt32(leaves + 28 * (-node - 1), true);
    return contents === -2 || contents === -6;
  };
  const bounds = (m: number) => [0, 1, 2, 3, 4, 5].map(k => data.getFloat32(models + 64 * m + 4 * k, true)), brushes: [number, number[], number[]][] = [];
  for (const block of Buffer.from(buffer, text, size).toString("latin1").match(/\{[^{}]*\}/g) || []) {
    const key = (k: string) => (block.match(new RegExp(`"${k}"\\s+"([^"]*)"`)) || [])[1], model = /^\*(\d+)$/.exec(key("model") || "");
    if (!model || /^trigger_|^func_ladder$/.test(key("classname")) || +key("rendermode") > 0 && !+key("renderamt")) continue;
    const origin = (key("origin") || "0 0 0").split(/\s+/).map(Number), b = bounds(+model[1]);
    brushes.push([+model[1], origin, [b[0] + origin[0], b[1] + origin[1], b[2] + origin[2], b[3] + origin[0], b[4] + origin[1], b[5] + origin[2]]]);
  }
  return {
    blocked(x: number, y: number, z: number) {
      let node = data.getInt32(models + 40, true);
      while (node >= 0) node = data.getInt16(clips + 8 * node + (side(data.getInt32(clips + 8 * node, true), [x, y, z]) >= 0 ? 4 : 6), true);
      return node === -2;
    },
    drawnNear(x: number, y: number, z: number) {   // a brush entity is only looked into if its bounds reach the box
      const near = brushes.filter(([, , b]) => b[0] <= x + 16 && b[3] >= x - 16 && b[1] <= y + 16 && b[4] >= y - 16 && b[2] <= z + 36 && b[5] >= z - 36);
      for (let i = -16; i <= 16; i += 2) for (let j = -16; j <= 16; j += 2) for (let k = -36; k <= 36; k += 2) {
        const p = [x + i, y + j, z + k];
        if (drawn(0, p) || near.some(([model, o]) => drawn(model, [p[0] - o[0], p[1] - o[1], p[2] - o[2]]))) return true;
      }
      return false;
    },
  };
}

// The engine's own entity dumps from the harness replaying the same route: every decoded position is the engine's,
// at the matched moment or one frame either side (a dump is taken between frames). Skipped without DUMPS.
function engine() {
  if (!Dumps || !Steam) return skip("engine truth", "DUMPS and STEAM");
  const d = demo(read(`${Steam}/lambda.dem`));
  let checks = 0, off = 0;
  for (const file of fs.readdirSync(Dumps)) {
    const x = fs.readFileSync(path.join(Dumps, file)), v = new DataView(x.buffer, x.byteOffset, x.byteLength);
    const [n, size, vars, , free] = [0, 4, 8, 12, 16].map(o => v.getInt32(o, true)), edict = (i: number) => 20 + i * size;
    const origin = (i: number) => [8, 12, 16].map(o => v.getFloat32(edict(i) + vars + o, true)), me = origin(1);
    let stretch: Stretch | null = null, time = 0, first: number | null = null;   // the dump's moment: where the player stands exactly, if only one moment
    for (const s of d) for (let i = 0; i < s.points.length; i += 5)
      if ([0, 1, 2].every(a => Math.abs(s.points[i + 1 + a] - me[a]) < 0.01)) { stretch = s; time = s.points[i]; first ??= s.points[i]; }
    if (!stretch || time - first! > 0.003) continue;
    for (const t of stretch.things) {
      if (t.number >= n || v.getInt32(edict(t.number) + free, true)) continue;
      let k = -1;
      for (let i = 0; i < t.track.length; i += 8) if (t.track[i] <= time + 1e-4) k = i;
      if (k < 0 || t.track[k + 7] !== 1) continue;
      const truth = origin(t.number), near = (j: number) => j >= 0 && j < t.track.length && [0, 1, 2].every(a => Math.abs(t.track[j + 1 + a] - truth[a]) <= 0.13);
      checks++;
      if (!near(k) && !near(k - 8) && !near(k + 8)) off++;
    }
  }
  check(`engine truth: ${checks} positions equal the engine's, at the moment or a frame apart`, checks > 8000 && off === 0, `${off} off`);
}

// A folder of demos as the page lists it: a run's numbered demos together and in play order, named by its folder.
function grouping() {
  const at = (path: string, time = 0) => ({ file: new File([], path.split("/").pop()!, { lastModified: time }), path });
  const one = group(["PB/AM-IL_3.dem", "PB/AM-IL_1.dem", "PB/AM-IL_10.dem", "PB/AM-IL_2.dem"].map(p => at(p)));
  check("a folder with one run: one run, named by the folder, its demos in play order",
    one.length === 1 && one[0].name === "PB" && one[0].files.map(f => (f as File).name).join() === "AM-IL_1.dem,AM-IL_2.dem,AM-IL_3.dem,AM-IL_10.dem");
  const two = group([at("x/a_1.dem", 1), at("x/b.dem", 2), at("x/notes.txt", 3)]);
  check("a folder with two runs: each by its own name, newest first, only demos", two.map(r => r.name).join() === "b,a", two.map(r => r.name).join());
}

// The built page, driven through Chrome's DevTools protocol: real mouse events, console errors caught. It is served as
// GitHub Pages serves it, under /hloverview/, and the ghost's demos under /ghost/.
async function page() {
  const Types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const server = http.createServer((request, response) => {
    const url = decodeURIComponent(new URL(request.url!, "http://localhost").pathname);
    const [root, rest] = url.startsWith("/hloverview/") ? [path.join(Here, "../dist"), url.slice(12) || "index.html"] : url.startsWith("/ghost/") && Demos ? [path.join(Demos, Ghost), url.slice(7)] : ["", ""];
    const file = path.resolve(root, rest);
    if (!root || !file.startsWith(root) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": Types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  }).listen(8123);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hloverview-chrome-"));
  const chrome = spawn("google-chrome", ["--headless=new", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1440,900", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let target: { webSocketDebuggerUrl: string } | null = null;
    for (let i = 0; i < 50 && !target; i++) {
      target = await fetch("http://127.0.0.1:9333/json/list").then(r => r.json()).then((list: { type: string; webSocketDebuggerUrl: string }[]) => list.find(t => t.type === "page") ?? null, () => null);
      if (!target) await new Promise(r => setTimeout(r, 200));
    }
    const socket = new WebSocket(target!.webSocketDebuggerUrl), waiting = new Map<number, (m: any) => void>(), errors: string[] = [];
    let id = 0;
    await new Promise(r => socket.addEventListener("open", r));
    socket.addEventListener("message", ({ data }) => {
      const m = JSON.parse(data as string);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); }
      if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) errors.push(m.params.args.map((a: any) => a.value ?? a.description).join(" "));
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
    });
    const send = (method: string, params = {}) => new Promise<any>(r => { waiting.set(++id, r); socket.send(JSON.stringify({ id, method, params })); });
    const run = async <T = any>(expression: string): Promise<T> => {
      const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text);
      return m.result.result.value;
    };
    const mouse = (type: string, x: number, y: number) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
    await send("Runtime.enable"); await send("Log.enable");
    await send("Page.navigate", { url: "http://localhost:8123/hloverview/" });
    await run(`(async () => { while (!window.hloverview?.segment) await new Promise(r => setTimeout(r, 200)); await Promise.all(Object.values(hloverview.reading)); })()`);
    await run(`(${install})()`);   // the checks that read the page's own state; Node has already stripped their types

    for (const result of await run<Result[]>("checks.data()")) check(result.name, result.ok, result.detail);

    // Hover everything drawn at four moments, with real mouse events: each shows its card.
    for (const [map, after] of [["c1a0", 8.5], ["c1a0b", 8], ["c1a0e", 30], ["c1a0e", 139.5]] as const) {
      const { targets, size } = await run<{ targets: Target[]; size: Result }>(`checks.moment(${JSON.stringify(map)}, ${after})`), missing: string[] = [];
      check(size.name, size.ok, size.detail);
      for (const t of targets) {
        if (t.x < 0) { missing.push(`${t.what}: ${t.title}`); continue; }   // its card can't even be built
        await mouse("mouseMoved", t.x, t.y);
        const title = await run<string | null>("checks.card()");
        if (!title || (t.title && title !== t.title)) missing.push(`${t.what}: ${title || "no card"}`);
      }
      check(`${map} at +${after} s: every one of ${targets.length} drawn things shows its card on hover`, !missing.length, missing.slice(0, 4).join("; "));
    }

    // The player, the route (a click there goes to its moment), the ghost.
    const spots = await run<{ player: { x: number; y: number }; route: { x: number; y: number; time: number } }>("checks.spots()");
    await mouse("mouseMoved", spots.player.x, spots.player.y);
    check("the player shows its card", await run("checks.card()") === "player");
    await mouse("mouseMoved", spots.route.x, spots.route.y);
    check("the route shows its card", await run("checks.card()") === "route");
    await mouse("mousePressed", spots.route.x, spots.route.y); await mouse("mouseReleased", spots.route.x, spots.route.y);
    const went = await run<number>("hloverview.state.now");
    check("a click on the route goes to that moment", Math.abs(went - spots.route.time) < 1e-6, `${went} vs ${spots.route.time}`);

    for (const result of await run<Result[]>("checks.playback()")) check(result.name, result.ok, result.detail);
    if (Demos) {
      for (const result of await run<Result[]>(`checks.ghost(${JSON.stringify(ghostSplit(Demos))})`)) check(result.name, result.ok, result.detail);
      const ghost = await run<{ x: number; y: number } | null>("checks.ghostSpot()");
      if (ghost) { await mouse("mouseMoved", ghost.x, ghost.y); check("the ghost shows its card", await run("checks.card()") === "ghost"); }
      else check("the ghost is on the map", false);
    } else skip("the ghost", "DEMOS");

    check("the playhead marks where the run is", await run("checks.playhead()"));
    check("a minute boundary reads 1:00.000", await run("hloverview.clock(59.9996)") === "1:00.000");
    check("at every load, everything from before it ends", await run("checks.loads()"));
    check("no errors or warnings in the page's console", !errors.length, errors.slice(0, 3).join(" | "));
  } finally {
    chrome.kill();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });   // Chrome may still be writing as it exits
  }
}

// The ghost's split in c1a0d, worked out apart from the page: when each run entered it, from its own start.
function ghostSplit(demos: string) {
  const entered = (files: string[]) => {
    let offset = 0;
    for (const f of files) {
      const d = demo(read(f)), s = d.find(x => x.map === "c1a0d");
      if (s) return s.points[0] + offset;
      offset += d[d.length - 1].points[d[d.length - 1].points.length - 5];
    }
    return NaN;
  };
  const names = fs.readdirSync(path.join(demos, Ghost)).filter(f => f.endsWith(".dem")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const ghost = names.map(f => path.join(demos, Ghost, f));
  return { run: Ghost, files: names.map(f => `../ghost/${f}`), split: entered(pb) - demo(read(pb[0]))[0].points[0] - (entered(ghost) - demo(read(ghost[0]))[0].points[0]) };
}

decoding();
mapping();
grouping();
engine();
await page();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
