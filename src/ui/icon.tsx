// Line icons on a 24 grid (Lucide's shapes), and solid ones on a 12 grid for play and pause.
const Lines = {
  open: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  ghost: "M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z",
  fit: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2",
  keys: "M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10M8 12h.01M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  x: "M18 6 6 18M6 6l12 12",
  chevron: "m6 15 6-6 6 6",
  updown: "m7 15 5 5 5-5M7 9l5-5 5 5",
  check: "M20 6 9 17l-5-5",
  search: "m21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
};
const Solids = { play: "M2.5 1.2v9.6L10.5 6z", pause: "M2 1h3v10H2zM7 1h3v10H7z" };

export type IconName = keyof typeof Lines | keyof typeof Solids;

export function Icon({ name }: { name: IconName }) {
  return name in Solids
    ? <svg className="icon solid" viewBox="0 0 12 12" aria-hidden><path d={Solids[name as keyof typeof Solids]} /></svg>
    : <svg className="icon" viewBox="0 0 24 24" aria-hidden><path d={Lines[name as keyof typeof Lines]} /></svg>;
}
