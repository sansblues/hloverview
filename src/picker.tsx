// Choose a run: a searchable list that opens from its trigger, for the run itself and for the ghost.
import type { ReactNode } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Icon } from "./ui/icon.tsx";
import { Hint } from "./ui/hint.tsx";
import { named, title } from "./map/run.ts";
import type { Run } from "./map/run.ts";

const same = (a: Run, b: Run) => a.name === b.name;
const keyboard = (type: string) => type === "keyboard";   // a mouse choice leaves focus on the page: Space plays, not reopens

export function Picker({ label, name, hint, runs, value, onChange, className, children }: {
  label: string; name?: string; hint?: string; runs: Run[]; value: Run | null; onChange: (run: Run) => void; className?: string; children: ReactNode;
}) {
  const trigger = <Combobox.Trigger className={className} aria-label={name}>{children}</Combobox.Trigger>;
  return (
    <Combobox.Root items={runs} value={value} onValueChange={run => run && !(value && same(run, value)) && onChange(run)} itemToStringLabel={(run: Run) => title(run.name)} isItemEqualToValue={same} autoHighlight>
      {hint ? <Hint label={hint}>{trigger}</Hint> : trigger}
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={4} className="layer">
          <Combobox.Popup className="popup picker" aria-label={label} finalFocus={keyboard}>
            <label className="search"><Icon name="search" /><Combobox.Input placeholder="Find a run" aria-label={label} /></label>
            <Combobox.Empty className="empty">No run matches.</Combobox.Empty>
            <Combobox.List className="list">
              {(run: Run) => (
                <Combobox.Item key={run.name} value={run} className="option run-option">
                  <Run name={run.name} />
                  <Combobox.ItemIndicator className="tick"><Icon name="check" /></Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

// A run as the list shows it: what it is, its best time if it was one, and when, to the second, since runs come minutes apart.
function Run({ name }: { name: string }) {
  const { what, best, day, time } = named(name);
  return <><span>{what}{best && <em>{best}</em>}</span><time>{day} {time}</time></>;
}
