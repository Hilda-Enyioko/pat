import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { Boxes, Globe2, Menu, MoveRight, Wifi, WifiOff, X } from "lucide-react";
import { CLUSTER, PROGRAM_ID, RPC_URL } from "@/config";
import { shortKey } from "@/lib/format";
import { APP_VIEWS, FAUCET_URL, SOURCE_URL, type View } from "@/lib/views";
import { Logo } from "./Logo";
import { CircleButton, PillButton } from "./Pill";

const explorerUrl = `https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=${CLUSTER}`;

export function Header({
  view,
  onNavigate,
  publicKey,
  online,
  onToggleOnline,
  onConnect,
  onDisconnect,
  onHowItWorks,
}: {
  view: View;
  onNavigate: (view: View) => void;
  publicKey: string | null;
  online: boolean;
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
    if (openedByKey.current) headerRef.current?.querySelector<HTMLElement>(".panel button, .panel a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const go = (next: View) => {
    setOpen(false);
    onNavigate(next);
  };
  const cta = () => (publicKey ? go("ledger") : onConnect());
  const host = new URL(RPC_URL).host;
  const programId = PROGRAM_ID.toBase58();
  const netLabel = online ? "Online" : "Offline";

  return (
    <header className="hdr" ref={headerRef} data-open={open || undefined}>
      <div className="util">
        <a className="ph p1" href={`https://explorer.solana.com/?cluster=${CLUSTER}`} target="_blank" rel="noreferrer">
          <Globe2 aria-hidden="true" />
          <span>
            Solana network : <b>{CLUSTER}</b>
            <br />
            {host}
          </span>
        </a>
        <span className="vr" aria-hidden="true" />
        <a className="ph p2" href={explorerUrl} target="_blank" rel="noreferrer">
          <Boxes aria-hidden="true" />
          <span>
            PAT program :
            <br />
            {shortKey(programId)}
          </span>
        </a>
        <nav className="unav" aria-label="Useful links">
          <button type="button" onClick={onHowItWorks}>How it works</button>
          <a className="opt" href={FAUCET_URL} target="_blank" rel="noreferrer">Faucet</a>
          <a className="opt" href={explorerUrl} target="_blank" rel="noreferrer">
            Program
            <br />
            explorer
          </a>
          <a className="opt" href={SOURCE_URL} target="_blank" rel="noreferrer">
            Source
            <br />
            code
          </a>
          <span className="net" data-offline={!online || undefined}>
            <i aria-hidden="true" />
            {netLabel}
          </span>
        </nav>
        <button
          type="button"
          className="srch"
          data-offline={!online || undefined}
          onClick={onToggleOnline}
          aria-label={`Network mode is ${netLabel}. Switch to ${online ? "offline" : "online"} mode`}
          title={`Switch to ${online ? "offline" : "online"} mode`}
        >
          {online ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
        </button>
      </div>

      <div className="mrow">
        <Logo onClick={() => go("landing")} />
        <nav className="mnav" aria-label="Main navigation">
          {APP_VIEWS.map(({ view: v, label }, i) => (
            <Fragment key={v}>
              <button
                type="button"
                className={i === 0 ? "lead" : undefined}
                aria-current={view === v ? "page" : undefined}
                onClick={() => go(v)}
              >
                {label}
                {i === 0 && (
                  <span className="dot-circ" aria-hidden="true">
                    <MoveRight />
                  </span>
                )}
              </button>
              {i === 0 && <span className="sep" aria-hidden="true" />}
            </Fragment>
          ))}
        </nav>
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
          <CircleButton label={publicKey ? "Open your ledger" : "Connect wallet"} onClick={cta} />
        </div>
      </div>

      <div className="panel" id="site-menu">
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
          <button type="button" onClick={onToggleOnline}>
            Mode: {netLabel} (switch)
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
