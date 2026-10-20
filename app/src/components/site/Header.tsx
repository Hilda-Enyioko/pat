import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Menu, MoveRight, X } from "lucide-react";
import { CLUSTER, PROGRAM_ID } from "@/config";
import { shortKey } from "@/lib/format";
import { APP_VIEWS, FAUCET_URL, SOURCE_URL, type View } from "@/lib/views";
import { Logo } from "./Logo";
import { NetworkToggle } from "./NetworkToggle";
import { PillButton } from "./Pill";

const explorerUrl = `https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=${CLUSTER}`;

export function Header({
  view,
  onNavigate,
  publicKey,
  online,
  reachable,
  onToggleOnline,
  onConnect,
  onDisconnect,
  onHowItWorks,
}: {
  view: View;
  onNavigate: (view: View) => void;
  publicKey: string | null;
  online: boolean;
  reachable: boolean;
  onToggleOnline: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onHowItWorks: () => void;
}) {
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openedByKey = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    if (openedByKey.current) headerRef.current?.querySelector<HTMLElement>(".pnav button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Lets the page behind the phone drawer stop scrolling while it is open.
  useEffect(() => {
    document.documentElement.classList.toggle("menu-open", open);
    return () => document.documentElement.classList.remove("menu-open");
  }, [open]);

  const go = (next: View) => {
    setOpen(false);
    onNavigate(next);
  };
  const cta = () => (publicKey ? go("ledger") : onConnect());
  const netLabel = online ? "Online" : reachable ? "Offline" : "No network";

  return (
    <header className="hdr" ref={headerRef} data-open={open || undefined}>
      <div className="mrow">
        <Logo onClick={() => go("landing")} />
        <button
          ref={buttonRef}
          type="button"
          className="menu-btn"
          aria-expanded={open}
          aria-controls="site-menu"
          onKeyDown={(event) => {
            openedByKey.current = event.key === "Enter" || event.key === " ";
          }}
          onPointerDown={() => {
            openedByKey.current = false;
          }}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          Menu
        </button>
        <div className="cta">
          <PillButton size="lg" text={publicKey ? shortKey(publicKey) : "Connect"} onClick={cta} aria-label={publicKey ? "Open your ledger" : "Connect wallet"} />
          <NetworkToggle online={online} reachable={reachable} onToggle={onToggleOnline} />
        </div>
      </div>

      <div className="scrim" aria-hidden="true" onClick={() => setOpen(false)} />
      <div className="panel" id="site-menu">
        <div className="phead">
          <span>Menu</span>
          <button
            type="button"
            className="pclose"
            aria-label="Close menu"
            onClick={() => {
              setOpen(false);
              buttonRef.current?.focus();
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <nav className="pnav" aria-label="Main navigation">
          {APP_VIEWS.map(({ view: v, label }, i) => (
            <button
              key={v}
              type="button"
              className="ni"
              style={{ "--i": i } as CSSProperties}
              aria-current={view === v ? "page" : undefined}
              onClick={() => go(v)}
            >
              <span className="ix">0{i + 1}</span>
              <span className="lb">{label}</span>
              <span className="dot-circ" aria-hidden="true">
                <MoveRight />
              </span>
            </button>
          ))}
        </nav>
        <div className="pmeta ni" style={{ "--i": 4 } as CSSProperties}>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onHowItWorks();
            }}
          >
            How it works
          </button>
          <button type="button" onClick={onToggleOnline} disabled={!reachable}>
            {reachable ? `Mode: ${netLabel} (switch)` : "No network: offline"}
          </button>
          <a href={FAUCET_URL} target="_blank" rel="noreferrer">Devnet faucet</a>
          <a href={explorerUrl} target="_blank" rel="noreferrer">Program explorer</a>
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">Source code</a>
        </div>
        <div className="pwallet ni" style={{ "--i": 5 } as CSSProperties}>
          {publicKey ? (
            <>
              <span className="mr-auto font-mono text-sm">{shortKey(publicKey)}</span>
              <PillButton
                size="sm"
                tone="light"
                text="Disconnect"
                onClick={() => {
                  setOpen(false);
                  onDisconnect();
                }}
              />
            </>
          ) : (
            <>
              <span className="mr-auto text-sm text-muted-foreground">No wallet connected</span>
              <PillButton
                size="sm"
                text="Connect"
                onClick={() => {
                  setOpen(false);
                  onConnect();
                }}
              />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
