// What a control does, and its key, shown on hover or focus.
import type { ReactElement } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import { Keys } from "./kbd.tsx";

export function Hint({ label, keys, children, side = "bottom" }: { label: string; keys?: string[]; children: ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6} className="layer">
          <Tooltip.Popup className="hint">{label}{keys && <Keys keys={keys} />}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
