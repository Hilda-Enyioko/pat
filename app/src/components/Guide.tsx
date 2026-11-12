import { useEffect, type ReactNode } from "react";
import { MessageSquare, Phone, QrCode, ShieldAlert, Store, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { USSD_SERVICE_CODE } from "../config";
import { PageHeading } from "./site/PageHeading";
import { PillButton } from "./site/Pill";
import { DialCode } from "./site/DialCode";

// The USSD screens below are copied from gateway/src/ussd.ts. Update them whenever that menu changes.
const USSD_SCREENS: { you: string; screen: string }[] = [
  { you: `Dial ${USSD_SERVICE_CODE}`, screen: "PAT\n1. Pay merchant\n2. Balance" },
  { you: "1", screen: "Merchant code:" },
  { you: "4242", screen: "Amount (USDC):" },
  { you: "5", screen: "Pay 5 USDC to merchant 4242.\nEnter PIN:" },
  { you: "Your PIN", screen: "Payment of 5 USDC to merchant 4242 submitted. You will get an SMS." },
];
const USSD_SMS = "PAT: paid 5 USDC to merchant 4242. Ref 5Hq3…";
const BALANCE_SCREENS: { you: string; screen: string }[] = [
  { you: "2", screen: "Enter PIN:" },
  { you: "Your PIN", screen: "Available: 15 USDC\nExpires: 2026-11-10 18:00 UTC" },
];

function Card({ tone = "bg-white", title, icon, children, className }: { tone?: string; title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[22px] p-5 sm:p-6", tone, className)}>
      <h3 className="m-0 mb-3 flex items-center gap-2 text-lg font-semibold [&_svg]:size-5">
        {icon}
        {title}
      </h3>
      <div className="space-y-2 text-[15px] leading-relaxed text-ink/85 [&_p]:m-0">{children}</div>
    </div>
  );
}

function Screens({ items }: { items: { you: string; screen: string }[] }) {
  return (
    <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((s, i) => (
        <li key={i} className="rounded-[18px] bg-paper p-3">
          <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {i + 1}. You enter: <span className="normal-case text-ink">{s.you}</span>
          </p>
          <pre className="m-0 whitespace-pre-wrap rounded-[12px] bg-card-dark p-3 font-mono text-[13px] leading-snug text-[#c9f2c7]">{s.screen}</pre>
        </li>
      ))}
    </ol>
  );
}

function FlowDiagram() {
  const steps = [
    { x: 8, label: "Reserve", sub: "online, once", fill: "var(--blue)" },
    { x: 232, label: "Spend", sub: "QR or USSD", fill: "var(--yellow)" },
    { x: 456, label: "Settle", sub: "on-chain", fill: "var(--red)" },
  ];
  return (
    <svg viewBox="0 0 680 120" role="img" aria-label="Reserve while online, spend by QR or USSD, then the payment settles on-chain" className="h-auto w-full">
      {steps.map((s, i) => (
        <g key={s.label}>
          <rect x={s.x} y={16} width={216} height={88} rx={18} fill={s.fill} />
          <text x={s.x + 24} y={56} fontSize={26} fontWeight={800} fill="var(--ink)" fontFamily="var(--display)">
            {s.label}
          </text>
          <text x={s.x + 24} y={84} fontSize={15} fill="var(--ink)" opacity={0.75} fontFamily="var(--sans)">
            {s.sub}
          </text>
          {i < 2 && (
            <path d={`M${s.x + 196} 60 l20 0 m-8 -8 l8 8 l-8 8`} stroke="var(--ink)" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </g>
      ))}
    </svg>
  );
}

const COMPARE: [string, string, string][] = [
  ["What you need when paying", "Nothing: no signal, no data", "Phone signal only, any phone"],
  ["How you approve", "Your wallet signs the payment", "Your 4-digit PIN"],
  ["Who sends it to the chain", "The merchant, once they're online", "The PAT gateway, straight away"],
  ["Money used", "SOL", "A token, such as USDC"],
  ["Spending stops", "At the end of your window (+30 min to settle)", "Exactly at the end of your window"],
  ["Needs the PAT app when paying", "Yes", "No"],
];

const TERMS: [string, string][] = [
  ["Offline Accepted", "The merchant checked your QR signature on their device. The money is not on-chain yet."],
  ["Confirmed", "The payment is on-chain. It's final."],
  ["Active", "Your spending window is open."],
  ["Expiring", "Spending has stopped; QR payments already made can still settle. On USSD, payments have stopped and withdraw opens soon."],
  ["Releasable", "Withdraw is open. Take back what you didn't spend."],
  ["Pending", "USSD: your payment is queued at the gateway."],
  ["Settled", "USSD: the gateway put your payment on-chain. You get an SMS."],
  ["Failed", "USSD: the payment didn't go through. The SMS says why. No money moved."],
];

const FAQ: [string, string][] = [
  ["What if I lose my phone?", "QR: your reserved funds stay in the reservation and come back to your wallet when the window ends. USSD: someone would also need your PIN; after 3 wrong PINs it locks for 30 minutes. Either way you can only lose what you reserved."],
  ["What if the gateway is down?", "USSD payments can't be made until it's back. Your tokens stay in the reservation, and you can still withdraw them yourself after the window ends."],
  ["Can I cancel early?", "No. Funds come back only after the window ends plus 30 minutes. Reserve small amounts for short windows."],
  ["How much data does QR need?", "None. You reserve online once, then sign and show QR codes with no connection at all."],
  ["Does USSD cost money?", "It depends on your mobile operator. Some charge per session."],
];

export function Guide({ onReserve }: { onReserve: () => void }) {
  // Deep links like /guide#ussd: scroll once the page has rendered.
  useEffect(() => {
    const go = () => {
      const id = window.location.hash.slice(1);
      if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    const t = window.setTimeout(go, 60);
    window.addEventListener("hashchange", go);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("hashchange", go);
    };
  }, []);

  return (
    <main className="page">
      <PageHeading
        eyebrow="Guide"
        lines={["Two ways", "to pay."]}
        lede="PAT has two payment rails. Pick the one that fits what you'll have when you pay."
        aside={<PillButton size="lg" text="Reserve funds" onClick={onReserve} />}
      />

      <nav aria-label="On this page" className="mb-10 flex flex-wrap gap-2">
        {[
          ["#pick", "Pick a rail"],
          ["#qr", "QR rail"],
          ["#ussd", "USSD rail"],
          ["#compare", "Compare"],
          ["#words", "Words you'll see"],
          ["#refund", "Getting money back"],
          ["#risks", "Limits and risks"],
          ["#merchants", "For merchants"],
          ["#faq", "FAQ"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink no-underline">
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-16 [&_section]:scroll-mt-28">
        <section id="pick" aria-labelledby="pick-h">
          <h2 id="pick-h" className="display-h mb-6 text-[clamp(32px,4.4vw,56px)]">What will you have when you pay?</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Card tone="bg-blue" title="No signal at all" icon={<QrCode />}>
              <p>Use the <a href="#qr" className="font-semibold text-ink">QR rail</a>. It works with no network.</p>
            </Card>
            <Card tone="bg-yellow" title="Signal, but no data or a basic phone" icon={<Phone />}>
              <p>Use the <a href="#ussd" className="font-semibold text-ink">USSD rail</a>. Any phone that can dial a code works.</p>
            </Card>
            <Card tone="bg-white" title="Both are fine" icon={<Store />}>
              <p>Either works. QR needs the PAT app on the payer&rsquo;s phone. USSD works on any phone.</p>
            </Card>
          </div>
          <div className="mt-6 rounded-[22px] bg-white p-4 sm:p-6">
            <FlowDiagram />
          </div>
        </section>

        <section id="qr" aria-labelledby="qr-h">
          <h2 id="qr-h" className="display-h mb-6 text-[clamp(32px,4.4vw,56px)]">Rail 1: QR, fully offline</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card tone="bg-blue" title="If you're paying" icon={<QrCode />}>
              <ol className="m-0 space-y-1 pl-5">
                <li>Connect your wallet and reserve SOL while you&rsquo;re online.</li>
                <li>Go offline. You don&rsquo;t need signal from here.</li>
                <li>Enter the merchant&rsquo;s address and the amount, then sign.</li>
                <li>Show the QR code to the merchant.</li>
              </ol>
              <p>Your offline ledger stops you spending more than you reserved by accident.</p>
            </Card>
            <Card tone="bg-white" title="If you're the merchant" icon={<Store />}>
              <ol className="m-0 space-y-1 pl-5">
                <li>Scan the payer&rsquo;s QR code.</li>
                <li>See <strong>Offline Accepted</strong>: the signature checks out.</li>
                <li>When you&rsquo;re online, tap settle.</li>
                <li>See <strong>Confirmed</strong>: the money is yours on-chain.</li>
              </ol>
            </Card>
          </div>
        </section>

        <section id="ussd" aria-labelledby="ussd-h">
          <h2 id="ussd-h" className="display-h mb-6 text-[clamp(32px,4.4vw,56px)]">Rail 2: USSD, signal only</h2>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
            <Card tone="bg-yellow" title="One-time setup (online)" icon={<Phone />}>
              <ol className="m-0 space-y-1 pl-5">
                <li>On the Reserve page, choose <strong>Phone (USSD)</strong>.</li>
                <li>Pick a token and how much to reserve, then approve in your wallet.</li>
                <li>Enter your phone number and choose a 4-digit PIN.</li>
                <li>Type the code we text you, then sign a short message in your wallet.</li>
              </ol>
            </Card>
            <DialCode />
          </div>
          <h3 className="mt-8 mb-4 text-lg font-semibold">Paying: what you&rsquo;ll see</h3>
          <Screens items={USSD_SCREENS} />
          <p className="mt-4 mb-0 flex items-start gap-2 rounded-[14px] bg-white px-4 py-3 text-sm">
            <MessageSquare className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Then an SMS: <span className="font-mono">{USSD_SMS}</span>
            </span>
          </p>
          <h3 className="mt-8 mb-4 text-lg font-semibold">Checking your balance</h3>
          <Screens items={BALANCE_SCREENS} />
        </section>

        <section id="compare" aria-labelledby="compare-h">
          <h2 id="compare-h" className="display-h mb-6 text-[clamp(32px,4.4vw,56px)]">Side by side</h2>
          <div className="overflow-x-auto rounded-[22px] bg-white">
            <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
              <caption className="sr-only">QR rail compared with USSD rail</caption>
              <thead>
                <tr className="border-b border-ink/10">
                  <th scope="col" className="p-4 font-semibold"> </th>
                  <th scope="col" className="p-4 font-semibold">QR</th>
                  <th scope="col" className="p-4 font-semibold">USSD</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([k, qr, ussd]) => (
                  <tr key={k} className="border-b border-ink/8 last:border-0">
                    <th scope="row" className="p-4 font-medium text-muted-foreground">{k}</th>
                    <td className="p-4">{qr}</td>
                    <td className="p-4">{ussd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="words" aria-labelledby="words-h">
          <h2 id="words-h" className="display-h mb-6 text-[clamp(32px,4.4vw,56px)]">Words you&rsquo;ll see</h2>
          <dl className="m-0 grid gap-3 sm:grid-cols-2">
            {TERMS.map(([t, d]) => (
              <div key={t} className="rounded-[18px] bg-white p-4">
                <dt className="font-semibold">{t}</dt>
                <dd className="m-0 mt-1 text-[15px] text-ink/80">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="refund" aria-labelledby="refund-h">
          <h2 id="refund-h" className="display-h mb-6 text-[clamp(32px,4.4vw,56px)]">Getting your money back</h2>
          <Card tone="bg-blue" title="Withdraw opens 30 minutes after your window ends" icon={<Undo2 />}>
            <p>This is the same on both rails. There is no early cancel.</p>
            <p>You get back what you didn&rsquo;t spend, the rent for receipts you didn&rsquo;t use, and the account rent.</p>
          </Card>
        </section>

        <section id="risks" aria-labelledby="risks-h">
          <h2 id="risks-h" className="display-h mb-6 text-[clamp(32px,4.4vw,56px)]">Limits and risks, plainly</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card tone="bg-white" title="QR" icon={<ShieldAlert />}>
              <p>A tampered wallet could sign more than the reservation holds. If two payments compete, the merchant who settles second loses out. Merchants should set their own offline limits.</p>
            </Card>
            <Card tone="bg-white" title="USSD" icon={<ShieldAlert />}>
              <p>Your money depends on the gateway and on your PIN and SIM staying safe. The gateway can only pay registered merchants, and only up to what you reserved. Reserve only what you can afford to risk.</p>
            </Card>
          </div>
        </section>

        <section id="merchants" aria-labelledby="merchants-h">
          <h2 id="merchants-h" className="display-h mb-6 text-[clamp(32px,4.4vw,56px)]">For merchants</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card tone="bg-white" title="QR" icon={<QrCode />}>
              <p>Scan, accept, settle. You need a little SOL for the network fee.</p>
            </Card>
            <Card tone="bg-white" title="USSD" icon={<Store />}>
              <p>You need a merchant code, registered by the PAT admin. Payments land in your token account automatically; there is nothing to do per payment.</p>
            </Card>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-h">
          <h2 id="faq-h" className="display-h mb-6 text-[clamp(32px,4.4vw,56px)]">FAQ</h2>
          <div className="space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="rounded-[18px] bg-white p-4 [&_summary]:cursor-pointer">
                <summary className="font-semibold">{q}</summary>
                <p className="m-0 mt-2 text-[15px] leading-relaxed text-ink/80">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
