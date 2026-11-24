// The bar above: the run, a folder of demos to open, and a run to compare with.
import { useRef } from "react";
import { Icon } from "./ui/icon.tsx";
import { Hint } from "./ui/hint.tsx";
import { Picker } from "./picker.tsx";
import { group, title } from "./map/run.ts";
import { add, compare, open, useMap } from "./map/engine.ts";

export function Header() {
  const runs = useMap(s => s.runs), chosen = useMap(s => s.chosen), ghost = useMap(s => s.ghost);
  const folder = useRef<HTMLInputElement>(null);
  return (
    <header>
      <img className="logo" src="icon.svg" alt="hloverview" />
      <Picker label="Find a run" runs={runs} value={chosen} onChange={run => open(run)} className="field run">
        <span>{chosen ? title(chosen.name) : "Choose a run"}</span><Icon name="updown" />
      </Picker>
      <Hint label="Open a folder of demos">
        <button type="button" className="square" aria-label="Open a folder of demos" onClick={() => folder.current?.click()}><Icon name="open" /></button>
      </Hint>
      <input ref={folder} type="file" hidden {...{ webkitdirectory: "" }} onChange={ev => {
        add(group([...ev.target.files ?? []].map(file => ({ file, path: file.webkitRelativePath }))));
        ev.target.value = "";
      }} />
      <span className="grow" />
      <div className={ghost ? "compare on" : "compare"}>
        <Picker label="Compare with" name={ghost ? `Comparing with ${title(ghost.name)}` : "Compare with a run"} hint={ghost ? "Compare with another run" : "Compare with a run"} runs={runs} value={ghost} onChange={run => compare(run)} className="chip">
          <Icon name="ghost" />{ghost && <span className="name">{title(ghost.name)}</span>}
        </Picker>
        {ghost && <Hint label="Stop comparing"><button type="button" className="clear" aria-label="Stop comparing" onClick={() => compare(null)}><Icon name="x" /></button></Hint>}
      </div>
    </header>
  );
}
