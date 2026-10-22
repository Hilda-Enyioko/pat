import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Copy, Menu, MoveRight, X } from "lucide-react";
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
  const [walletOpen, setWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openedByKey = useRef(false);

  useEffect(() => {
    if (!open && !walletOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (open) buttonRef.current?.focus();
        setOpen(false);
        setWalletOpen(false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setWalletOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    if (open && openedByKey.current) headerRef.current?.querySelector<HTMLElement>(".pnav button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, walletOpen]);

  // Lets the page behind the phone drawer stop scrolling while it is open.
  useEffect(() => {
    document.documentElement.classList.toggle("menu-open", open);
    return () => document.documentElement.classList.remove("menu-open");
  }, [open]);

  const go = (next: View) => {
    setOpen(false);
    setWalletOpen(false);
    onNavigate(next);
  };
  const disconnect = () => {
    setOpen(false);
    setWalletOpen(false);
    onDisconnect();
  };
  const copyAddress = async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the address is still shown in full */
    }
  };
  const netLabel = online ? "Online" : reachable ? "Offline" : "No network";

  return (
    <header className="hdr" ref={headerRef} data-open={open || undefined} data-wallet-open={walletOpen || undefined}>
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
          onClick={() => {
            setWalletOpen(false);
            setOpen((value) => !value);
          }}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          Menu
        </button>
        <div className="cta">
          {publicKey ? (
            <PillButton
              size="lg"
              text={shortKey(publicKey)}
              aria-label="Wallet menu"
              aria-haspopup="true"
              aria-expanded={walletOpen}
              aria-controls="wallet-menu"
              onClick={() => {
                setOpen(false);
                setWalletOpen((value) => !value);
              }}
            />
          ) : (
            <PillButton size="lg" text="Connect" aria-label="Connect wallet" onClick={onConnect} />
          )}
          <NetworkToggle online={online} reachable={reachable} onToggle={onToggleOnline} />
        </div>
      </div>

      {publicKey && (
        <div className="wpanel" id="wallet-menu">
          <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Connected wallet</p>
          <div className="flex items-center gap-2 rounded-[14px] bg-paper py-2 pr-2 pl-4">
            <span className="min-w-0 flex-1 truncate font-mono text-sm" title={publicKey}>
              {publicKey}
            </span>
            <button
              type="button"
              onClick={() => void copyAddress()}
              aria-label="Copy wallet address"
              className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-white text-ink"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <PillButton size="sm" text="Open ledger" className="flex-1" onClick={() => go("ledger")} />
            <PillButton size="sm" tone="light" text="Disconnect" className="flex-1" onClick={disconnect} />
          </div>
        </div>
      )}

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
        <div className="pwallet ni" style={{ "--i": 0 } as CSSProperties}>
          {publicKey ? (
            <>
              <span className="mr-auto font-mono text-sm" title={publicKey}>
                {shortKey(publicKey)}
              </span>
              <PillButton size="sm" tone="light" text="Disconnect" onClick={disconnect} />
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
        <nav className="pnav" aria-label="Main navigation">
          {APP_VIEWS.map(({ view: v, label }, i) => (
            <button
              key={v}
              type="button"
              className="ni"
              style={{ "--i": i + 1 } as CSSProperties}
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
        <div className="pmeta ni" style={{ "--i": 5 } as CSSProperties}>
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
      </div>
    </header>
  );
}
