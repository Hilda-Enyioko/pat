import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";

const SHOW_MS = 1500;

/** Round online/offline switch: on click it stretches sideways to announce the new mode, then shrinks back. */
export function NetworkToggle({ online, onToggle }: { online: boolean; onToggle: () => void }) {
  const [flash, setFlash] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const label = online ? "Online" : "Offline";

  return (
    <span className="net-slot">
      <button
        type="button"
        className="net-btn"
        data-offline={!online || undefined}
        data-flash={flash || undefined}
        aria-label={`Network mode: ${label}. Switch to ${online ? "offline" : "online"} mode`}
        title={`Switch to ${online ? "offline" : "online"} mode`}
        onClick={() => {
          onToggle();
          setFlash(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setFlash(false), SHOW_MS);
        }}
      >
        <span className="ic" aria-hidden="true">
          <Wifi className="on" />
          <WifiOff className="off" />
        </span>
        <span className="lbl" aria-live="polite">
          {label}
        </span>
      </button>
    </span>
  );
}
