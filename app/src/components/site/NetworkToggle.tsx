import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Wifi, WifiOff } from "lucide-react";

const SHOW_MS = 1500;

/**
 * Round online/offline switch. Whenever the mode changes, by a click or because
 * the connection dropped or came back, it stretches sideways to announce the
 * new state, then shrinks back to the icon.
 */
export function NetworkToggle({ online, reachable, onToggle }: { online: boolean; reachable: boolean; onToggle: () => void }) {
  const [flash, setFlash] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const previous = useRef(online);

  const announce = () => {
    setFlash(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(false), SHOW_MS);
  };

  useEffect(() => {
    if (previous.current === online) return;
    previous.current = online;
    announce();
  }, [online]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const label = online ? "Online" : reachable ? "Offline" : "No network";

  return (
    <span className="net-slot">
      <button
        type="button"
        className="net-btn"
        data-offline={!online || undefined}
        data-nonet={!reachable || undefined}
        data-flash={flash || undefined}
        style={{ "--open-w": reachable ? "146px" : "176px" } as CSSProperties}
        aria-label={
          reachable
            ? `Network mode: ${label}. Switch to ${online ? "offline" : "online"} mode`
            : "No network connection. PAT is offline until it returns"
        }
        title={reachable ? `Switch to ${online ? "offline" : "online"} mode` : "No network connection"}
        onClick={() => {
          onToggle();
          // With no network the mode can't change, so the effect won't fire: announce anyway.
          if (!reachable) announce();
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
