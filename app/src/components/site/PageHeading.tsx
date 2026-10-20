import type { ReactNode } from "react";

/** Oversized editorial heading used at the top of every app screen. */
export function PageHeading({ eyebrow, lines, lede, aside }: { eyebrow: string; lines: string[]; lede?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-10 grid items-end gap-8 md:mb-14 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="m-0 inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em]">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-red" />
          {eyebrow}
        </p>
        <h1 className="display-h mt-5 text-[clamp(46px,8.4vw,112px)]">
          {lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>
        {lede && <p className="mt-5 mb-0 max-w-xl text-[17px] leading-relaxed text-ink/80">{lede}</p>}
      </div>
      {aside ?? <TileStack />}
    </div>
  );
}

function TileStack() {
  return (
    <div aria-hidden="true" className="hidden items-end gap-2 md:flex">
      <span className="grainy h-24 w-[72px] rounded-[16px] bg-red" />
      <span className="grainy h-32 w-[72px] rounded-[16px] bg-yellow" />
      <span className="grainy h-20 w-[72px] rounded-[16px] bg-blue" />
    </div>
  );
}
