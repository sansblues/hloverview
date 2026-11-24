// The bar below: play, speed, the run's timeline with its maps, and where the run is.
import { useRef, useState, type PointerEvent } from "react";
import { Select } from "@base-ui/react/select";
import { Icon } from "./ui/icon.tsx";
import { Hint } from "./ui/hint.tsx";
import { clock } from "./map/run.ts";
import { seek, setRate, toggle, useMap } from "./map/engine.ts";

const Rates = [{ value: 0.25, label: "¼×" }, { value: 0.5, label: "½×" }, { value: 1, label: "1×" }, { value: 2, label: "2×" }, { value: 4, label: "4×" }, { value: 8, label: "8×" }];
const keyboard = (type: string) => type === "keyboard";   // a mouse choice leaves focus on the page: Space plays, not reopens

export function Footer() {
  const playing = useMap(s => s.playing), loaded = useMap(s => s.segments.length > 0), rate = useMap(s => s.rate);
  return (
    <footer>
      <Hint label={playing ? "Pause" : "Play"} keys={["Space"]} side="top">
        <button type="button" className="square play" aria-label={playing ? "Pause" : "Play"} disabled={!loaded} onClick={toggle}><Icon name={playing ? "pause" : "play"} /></button>
      </Hint>
      <Select.Root items={Rates} value={rate} onValueChange={v => v !== null && setRate(v)}>
        <Hint label="Playback speed" side="top">
          <Select.Trigger className="field rate" aria-label="Playback speed"><Select.Value /><Icon name="updown" /></Select.Trigger>
        </Hint>
        <Select.Portal>
          <Select.Positioner side="top" sideOffset={4} alignItemWithTrigger={false} className="layer">
            <Select.Popup className="popup menu" finalFocus={keyboard}>
              <Select.List>
                {Rates.map(r => (
                  <Select.Item key={r.value} value={r.value} className="option">
                    <Select.ItemText>{r.label}</Select.ItemText>
                    <Select.ItemIndicator className="tick"><Icon name="check" /></Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      {loaded && <Timeline />}
      {loaded && <Readout />}
    </footer>
  );
}

// Each band is a map, as long as the run spent in it. Clicking or dragging goes anywhere in the run.
function Timeline() {
  const segments = useMap(s => s.segments), index = useMap(s => s.index), now = useMap(s => s.now);
  const ref = useRef<HTMLDivElement>(null), [hover, setHover] = useState<{ x: number; text: string } | null>(null);
  const start = segments[0].points[0], end = segments[segments.length - 1].points.at(-5)!, span = end - start;
  const length = (k: number) => segments[k].points.at(-5)! - segments[k].points[0];
  const timeAt = (x: number) => {   // the run time under a point of the timeline, and its map
    const bands = [...ref.current!.querySelectorAll(".band")];
    let k = bands.findIndex(b => x < b.getBoundingClientRect().right);
    if (k < 0) k = bands.length - 1;
    const r = bands[k].getBoundingClientRect(), p = segments[k].points;
    return { t: p[0] + Math.min(1, Math.max(0, (x - r.left) / r.width)) * length(k), k };
  };
  const down = (ev: PointerEvent) => { ref.current!.setPointerCapture(ev.pointerId); seek(timeAt(ev.clientX).t, true); };
  const move = (ev: PointerEvent) => {
    if (ref.current!.hasPointerCapture(ev.pointerId)) seek(timeAt(ev.clientX).t, true);
    if (ev.pointerType !== "mouse") return;
    const { t, k } = timeAt(ev.clientX);
    setHover({ x: ev.clientX - ref.current!.getBoundingClientRect().left, text: `${segments[k].map} ${clock(t - segments[k].points[0])} / ${clock(length(k))} · run ${clock(t - start)}` });
  };
  const at = segments[index] ?? segments[0];
  return (
    <div className="timeline" ref={ref} role="slider" tabIndex={0} aria-label="Time in the run" aria-valuemin={0} aria-valuemax={+span.toFixed(3)}
      aria-valuenow={+(now - start).toFixed(3)} aria-valuetext={`${at.map} ${clock(Math.max(0, now - at.points[0]))}`}
      onPointerDown={down} onPointerMove={move} onPointerLeave={() => setHover(null)}>
      {segments.map((s, k) => {
        const through = Math.min(1, Math.max(0, (now - s.points[0]) / Math.max(length(k), 1e-9)));
        return (
          <div key={k} className={k === index ? "band on" : "band"} style={{ flex: `${Math.max(length(k), 0) / span} 1 0` }}>
            <i className="past" style={{ width: `${100 * through}%` }} />
            <span>{length(k) / span > 0.03 ? s.map : ""}</span>
            {k === index && <i className="head" style={{ left: `${100 * through}%` }} />}
          </div>
        );
      })}
      {hover && <div className="hover" style={{ left: hover.x }}><span>{hover.text}</span></div>}
    </div>
  );
}

function Readout() {
  const segments = useMap(s => s.segments), index = useMap(s => s.index), now = useMap(s => s.now), speed = useMap(s => s.speed), split = useMap(s => s.split);
  const start = segments[0].points[0], end = segments[segments.length - 1].points.at(-5)!, at = segments[index] ?? segments[0];
  const sign = split === null ? "" : split > 0.0005 ? "behind" : split < -0.0005 ? "ahead" : "";
  return (
    <div className="readout">
      <Hint label="The demo's own clock: it runs on through loads, so it can differ from a run's timer" side="top">
        <span>demo <b className="big">{clock(now - start)}</b> / {clock(end - start)}</span>
      </Hint>
      <span>{at.map} <b>{clock(Math.max(0, now - at.points[0]))}</b></span>
      <span><b className="speed">{speed}</b> u/s</span>
      <Hint label="When you entered this map, against the ghost: + is later, − is earlier" side="top">
        <span className="split" style={{ visibility: split === null ? "hidden" : undefined }}>
          split <b className={sign}>{split === null ? "" : `${split > 0 ? "+" : split < 0 ? "−" : "±"}${Math.abs(split).toFixed(3)}`}</b>
        </span>
      </Hint>
    </div>
  );
}
