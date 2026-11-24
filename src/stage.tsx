// The map, and what sits over it: the legend, fit and keys, where the pointer is, the card of what it points at, states.
import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import { Popover } from "@base-ui/react/popover";
import { Icon } from "./ui/icon.tsx";
import { Hint } from "./ui/hint.tsx";
import { Keys } from "./ui/kbd.tsx";
import { Legend } from "./legend.tsx";
import { attach, close, frame, setKeys, useMap } from "./map/engine.ts";

export function Stage({ dropping }: { dropping: boolean }) {
  const stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const status = useMap(s => s.status);
  useEffect(() => attach(canvas.current!, stage.current!), []);
  return (
    <div className="stage" ref={stage}>
      <canvas ref={canvas} aria-label="The map from above, with the run's route" />
      <Legend />
      <div className="where">
        <Hint label="Fit the route" keys={["F"]} side="top">
          <button type="button" className="square" aria-label="Fit the route" onClick={frame}><Icon name="fit" /></button>
        </Hint>
        <Shortcuts />
        <Where />
      </div>
      <Tip />
      {status && <div className="status">{status}</div>}
      <Notice />
      {dropping && <div className="drop">Drop demos to open them</div>}
    </div>
  );
}

const Where = () => <span>{useMap(s => s.where)}</span>;

const List: [string[], string][] = [
  [["Space"], "play, pause"], [["←", "→"], "back, ahead 1 s"], [["⇧", "←", "→"], "back, ahead 0.1 s"], [["Home", "End"], "start, end"],
  [["F"], "fit the route"], [["L"], "legend"], [["?"], "these keys"], [["Esc"], "close"],
];

function Shortcuts() {
  const open = useMap(s => s.keys);
  return (
    <Popover.Root open={open} onOpenChange={setKeys}>
      <Hint label="Keys" keys={["?"]} side="top">
        <Popover.Trigger className="square" aria-label="Keys"><Icon name="keys" /></Popover.Trigger>
      </Hint>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="layer">
          <Popover.Popup className="popup shortcuts" initialFocus={false} finalFocus={false}>
            <dl>
              {List.map(([keys, what]) => <Fragment key={what}><dt><Keys keys={keys} /></dt><dd>{what}</dd></Fragment>)}
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// The card for what is inspected, beside the pointer and inside the map.
function Tip() {
  const tip = useMap(s => s.tip), ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card || !tip) return;
    const { clientWidth: w, clientHeight: h } = card.parentElement!, { offsetWidth: tw, offsetHeight: th } = card;
    card.style.left = `${Math.max(8, Math.min(tip.x + 14, w - tw - 8))}px`;
    card.style.top = `${tip.y + 14 + th > h - 8 ? Math.max(8, tip.y - th - 10) : tip.y + 14}px`;
  });
  if (!tip) return null;
  const { title, name, rows, note } = tip.card;
  return (
    <div className="tip" ref={ref}>
      <strong>{title}</strong>
      {name && <small>{name}</small>}
      <dl>{rows.map(([name, value], i) => <Fragment key={i}><dt>{name}</dt><dd>{value}</dd></Fragment>)}</dl>
      {note && <p>{note}</p>}
    </div>
  );
}

function Notice() {
  const notice = useMap(s => s.notice);
  if (!notice) return null;
  return (
    <div className="notice" onClick={close}>
      <div>
        <strong>{notice.title}</strong>
        <span>{notice.text.split("`").map((part, i) => i % 2 ? <code key={i}>{part}</code> : part)}</span>
        {notice.closable && <small>Click or press Esc to close</small>}
      </div>
    </div>
  );
}
