import { Fragment, useMemo } from "react";
import { CircleCheckBig, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Solid = "red" | "yellow" | "blue" | "cream" | "dark";
type Art = "qr" | "amount" | "confirmed" | "nosignal";
type Tile = Solid | Art;

// Same column recipe as the reference mosaic; the four photo slots are
// replaced by graphic tiles that each show one moment of a PAT payment.
const COLUMNS: { cls: string; tiles: Tile[] }[] = [
  { cls: "x3", tiles: ["amount", "blue", "dark", "qr", "yellow"] },
  { cls: "x2", tiles: ["yellow", "nosignal", "cream", "red", "confirmed"] },
  { cls: "x1", tiles: ["blue", "amount", "red", "qr", "cream"] },
  { cls: "c1", tiles: ["red", "qr", "amount", "blue", "confirmed"] },
  { cls: "c2", tiles: ["yellow", "confirmed", "dark", "nosignal", "red"] },
  { cls: "c3", tiles: ["blue", "cream", "nosignal", "yellow", "qr"] },
];

const AMOUNTS = ["0.25", "1.20", "0.08", "0.50"];
const SOLIDS = new Set<Tile>(["red", "yellow", "blue", "cream", "dark"]);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A decorative QR-like glyph: three finder squares and seeded modules. */
function QrGlyph({ seed }: { seed: number }) {
  const cells = useMemo(() => {
    const n = 21;
    const rand = mulberry32(seed);
    const finder = (x: number, y: number) =>
      (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
    const out: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!finder(x, y) && rand() > 0.52) out.push([x, y]);
    return out;
  }, [seed]);
  const eye = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x + 0.5} y={y + 0.5} width={6} height={6} fill="none" stroke="currentColor" strokeWidth={1} />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="currentColor" />
    </g>
  );
  return (
    <svg viewBox="0 0 21 21" shapeRendering="crispEdges" aria-hidden="true">
      {eye(0, 0)}
      {eye(14, 0)}
      {eye(0, 14)}
      {cells.map(([x, y]) => (
        <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}

function Cell({ tile, n }: { tile: Tile; n: number }) {
  if (SOLIDS.has(tile)) return <div className={cn("cell solid", tile)} />;
  switch (tile) {
    case "qr":
      return (
        <div className="cell art a-qr">
          <span className="cap">Payment intent</span>
          <QrGlyph seed={n * 97 + 13} />
          <span className="cap">230 B · signed offline</span>
        </div>
      );
    case "amount":
      return (
        <div className="cell art a-amt">
          <span className="cap">Offline accepted</span>
          <span className="big">
            {AMOUNTS[n % AMOUNTS.length]}
            <small>SOL</small>
          </span>
        </div>
      );
    case "confirmed":
      return (
        <div className="cell art a-ok">
          <CircleCheckBig aria-hidden="true" />
          <span>
            <span className="big block">Confirmed</span>
            <span className="cap mt-2 block opacity-85">settle() · on-chain</span>
          </span>
        </div>
      );
    default:
      return (
        <div className="cell art a-sig">
          <WifiOff aria-hidden="true" />
          <span>
            <span className="big block">No signal</span>
            <span className="cap mt-2 block opacity-70">still paying</span>
          </span>
        </div>
      );
  }
}

export function Mosaic({ className }: { className?: string }) {
  return (
    <div className={cn("mosaic", className)} aria-hidden="true">
      {COLUMNS.map(({ cls, tiles }, ci) => (
        <div key={cls} className={cn("col", cls)}>
          {/* Two copies so the 50% translate loops seamlessly. */}
          {[0, 1].map((copy) => (
            <Fragment key={copy}>
              {tiles.map((tile, i) => (
                <Cell key={`${copy}-${i}`} tile={tile} n={ci * tiles.length + i} />
              ))}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
