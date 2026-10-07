import { useCallback, useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { Providers } from "./components/Providers";
import { ReserveForm } from "./components/ReserveForm";
import { LedgerPanel } from "./components/LedgerPanel";
import { listLedgers, type OfflineLedger } from "./lib/ledger";
import { useOnline } from "./hooks/useOnline";

function Home() {
  const { publicKey } = useWallet();
  const online = useOnline();
  const [ledgers, setLedgers] = useState<OfflineLedger[]>([]);

  const reload = useCallback(async () => {
    setLedgers(publicKey ? await listLedgers(publicKey.toBase58()) : []);
  }, [publicKey]);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <main>
      <header>
        <div>
          <h1>PAT</h1>
          <p className="muted">Reserve while connected. Spend while disconnected. Settle when reconnected.</p>
        </div>
        <div className="row">
          <span className={`pill ${online ? "Active" : "Releasable"}`}>{online ? "online" : "offline"}</span>
          <WalletMultiButton />
        </div>
      </header>
      <ReserveForm onCreated={reload} />
      <h2>2. Offline ledger</h2>
      {ledgers.length === 0 && <p className="muted">No reservations on this device yet. The ledger loads from local storage, so it works offline.</p>}
      {ledgers.map((l) => <LedgerPanel key={l.reservation} ledger={l} online={online} onChange={reload} />)}
    </main>
  );
}

export default function App() {
  return <Providers><Home /></Providers>;
}
