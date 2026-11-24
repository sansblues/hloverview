// What each mark means: only what this map has.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { Icon } from "./ui/icon.tsx";
import { Hint } from "./ui/hint.tsx";
import { Cap, Running, refit, setLegend, shade, useMap } from "./map/engine.ts";

const View = "M16 .5 5 6l11 5.5";   // the field of view's two edges, from the box
// The route's colours, as drawn: running speeds on the left half, gained ones on the right, each half to its own scale.
const Ramp = `linear-gradient(90deg, ${shade(0)}, ${shade(Running)} 50%, ${shade(Running + 1e-6)} 50%, ${shade(Math.sqrt(Running * Cap))} 75%, ${shade(Cap)})`;
const mark = (kind: string, color?: string) => <i className={kind} style={color ? { "--c": `var(${color})` } as CSSProperties : undefined} />;

// A mark and what it stands for: the classnames it is drawn for on this map, or in words where the game has no name.
function Row({ show, mark, hint, names, children }: { show: string; mark: ReactNode; hint?: string; names?: string[]; children: string }) {
  const row = <span data-show={show}>{mark}{names?.length ? <code>{names.join("\n")}</code> : children}{show === "route" && <small>320 u/s</small>}</span>;
  return hint ? <Hint label={hint} side="left">{row}</Hint> : row;
}

export function Legend() {
  const open = useMap(s => s.legend), shows = useMap(s => s.shows), loaded = useMap(s => s.segments.length > 0), ref = useRef<HTMLDivElement>(null);
  useEffect(() => {   // what the legend covers stays clear: a fitted view moves when its width does
    const legend = ref.current;
    if (!legend) return;
    let width = -1;
    const watch = new ResizeObserver(() => { if (legend.offsetWidth !== width) { width = legend.offsetWidth; refit(); } });
    watch.observe(legend);
    return () => watch.disconnect();
  }, [loaded]);
  if (!loaded) return null;
  const has = (show: string) => shows.has(show), names = (show: string) => shows.get(show);
  return (
    <Collapsible.Root open={open} onOpenChange={setLegend} className="legend" ref={ref}>
      <Hint label={open ? "Hide the legend" : "Show the legend"} keys={["L"]} side="left">
        <Collapsible.Trigger className="toggle">Legend <Icon name="chevron" /></Collapsible.Trigger>
      </Hint>
      <Collapsible.Panel className="panel">
        <section>
          <h2>Run</h2>
          <Row show="player" mark={<i className="player"><svg viewBox="0 0 16 12"><path className="view" d={View} /><rect x="1" y="2" width="8" height="8" /></svg></i>}
            hint="Its box as the game has it, 32 × 32 units, and its field of view as the demo records it">player</Row>
          <Row show="route" mark={<i className="ramp" style={{ background: Ramp }} />}
            hint="Its speed: grey up to sv_maxspeed (320 u/s, as fast as running goes), orange past it, brighter up to sv_maxvelocity (2000 u/s)">route</Row>
          {has("ghost") && <Row show="ghost" mark={<i className="player ghost"><svg viewBox="0 0 16 12"><path className="view" d={View} /><rect x="1.75" y="2.75" width="6.5" height="6.5" /></svg></i>}
            hint="Another run, and its route dashed: the doors, people and items drawn are yours">ghost</Row>}
        </section>
        <section>
          <h2>Things</h2>
          {has("person") && <Row show="person" names={names("person")} mark={mark("fill", "--person")}>person</Row>}
          {has("enemy") && <Row show="enemy" names={names("enemy")} mark={mark("fill", "--enemy")}>enemy</Row>}
          {has("item") && <Row show="item" names={names("item")} mark={mark("fill", "--item")}>item</Row>}
          {has("object") && <Row show="object" names={names("object")} mark={mark("fill", "--object")}>object</Row>}
          {has("dead") && <Row show="dead" mark={mark("dead")}>dead</Row>}
          {has("moving") && <Row show="moving" names={names("moving")} mark={mark("box", "--mover")}>door, lift, button, breakable</Row>}
          {has("moving") && <Row show="away" mark={mark("away")}>out of sight</Row>}
        </section>
        <section>
          <h2>Map</h2>
          {has("level") && <Row show="level" names={names("level")} mark={mark("line", "--ink")}>level change</Row>}
          {has("trigger") && <Row show="trigger" names={names("trigger")} mark={mark("line faint", "--zone")}>trigger</Row>}
          {has("clip") && <Row show="clip" mark={mark("fill", "--clip")}>invisible wall</Row>}
          {has("hurt") && <Row show="hurt" names={names("hurt")} mark={mark("box", "--enemy")}>hurts</Row>}
          {has("push") && <Row show="push" names={names("push")} mark={mark("push")}>pushes</Row>}
          {has("water") && <Row show="water" mark={mark("water")}>water</Row>}
          {has("ladder") && <Row show="ladder" names={names("ladder")} mark={mark("rungs")}>ladder</Row>}
          {has("slope") && <Row show="slope" mark={mark("slope")}>steep slope</Row>}
        </section>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
