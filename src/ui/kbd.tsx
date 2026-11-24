// A key as it is on the keyboard. Arrows and shift are drawn in the system font: Geist Mono has none.
export function Kbd({ children }: { children: string }) {
  return <kbd className={/^[←→↑↓⇧]$/.test(children) ? "glyph" : undefined}>{children}</kbd>;
}

export const Keys = ({ keys }: { keys: string[] }) => <span className="keys">{keys.map(k => <Kbd key={k}>{k}</Kbd>)}</span>;
