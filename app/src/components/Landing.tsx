import { useLayoutEffect, useRef, type ReactNode } from "react";
import { MoveRight } from "lucide-react";
import { playEntrance } from "@/lib/entrance";
import { Mosaic } from "./site/Mosaic";
import { CircleButton, PillButton } from "./site/Pill";

export function Landing({
  header,
  connected,
  onStart,
  onHowItWorks,
}: {
  header: ReactNode;
  connected: boolean;
  onStart: () => void;
  onHowItWorks: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (stage.current) playEntrance(stage.current);
  }, []);

  const cta = connected ? "Open ledger" : "Connect";

  return (
    <div className="stage" ref={stage}>
      <Mosaic />
      {header}
      <main className="hero">
        <h1 className="masking">
          {["Reserve", "online.", "Pay", "offline."].map((line) => (
            <span key={line} className="ln">
              <span>{line}</span>
            </span>
          ))}
        </h1>
        <div className="acts">
          <div className="tk">
            <PillButton size="lg" text={cta} onClick={onStart} />
            <CircleButton label={cta} onClick={onStart} />
          </div>
          <button type="button" className="lk" onClick={onHowItWorks}>
            How it works
            <span className="ac" aria-hidden="true">
              <MoveRight />
            </span>
          </button>
        </div>
      </main>
    </div>
  );
}
