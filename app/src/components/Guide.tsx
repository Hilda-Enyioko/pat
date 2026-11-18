import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Phone, QrCode, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { USSD_ENABLED, USSD_SERVICE_CODE } from "../config";
import { RAIL_INFO, type RailId } from "../lib/rails";
import { PageHeading } from "./site/PageHeading";
import { PillButton } from "./site/Pill";
import { DialCode } from "./site/DialCode";

// Copied from gateway/src/ussd.ts. Update these whenever that menu changes.
const EXAMPLE_CODE = "3017224044";
const USSD_SCREENS: { you: string; screen: string }[] = [
  { you: `Dial ${USSD_SERVICE_CODE}`, screen: "PAT\n1. Pay merchant\n2. Balance\n3. Link to a new reservation" },
  { you: "1", screen: "Enter merchant code:" },
  { you: EXAMPLE_CODE, screen: `Merchant ${EXAMPLE_CODE}\nWallet 7xKX…3f9a\nAmount (USDC):` },
  { you: "5", screen: `Pay 5 USDC to ${EXAMPLE_CODE} (7xKX…3f9a)?\nEnter PIN to confirm:` },
  { you: "Your PIN", screen: `Payment of 5 USDC to merchant ${EXAMPLE_CODE} submitted. You will get an SMS.` },
  { you: "(wait a few seconds)", screen: `SMS from PAT:\nPAT: paid 5 USDC to merchant ${EXAMPLE_CODE}. Ref 5Hq3…` },
];

/** A phone that steps through the USSD screens, so people see exactly what to expect. */
function PhoneDemo() {
  const [i, setI] = useState(0);
  const s = USSD_SCREENS[i];
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-[260px] rounded-[36px] bg-ink p-3 shadow-xl">
        <div className="flex h-[300px] flex-col rounded-[26px] bg-[#1d2a22] p-4">
          <p className="m-0 mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.1em] text-white/45">
            Step {i + 1} of {USSD_SCREENS.length}
          </p>
          <pre className="m-0 flex-1 whitespace-pre-wrap font-mono text-[15px] leading-snug text-[#c9f2c7]" aria-live="polite">
            {s.screen}
          </pre>
        </div>
      </div>
      <p className="m-0 text-center text-sm">
        You enter: <b>{s.you}</b>
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          aria-label="Previous screen"
          disabled={i === 0}
          onClick={() => setI(i - 1)}
          className="grid size-11 cursor-pointer place-items-center rounded-full border border-ink/15 bg-white disabled:opacity-40"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Next screen"
          disabled={i === USSD_SCREENS.length - 1}
          onClick={() => setI(i + 1)}
          className="grid size-11 cursor-pointer place-items-center rounded-full border-0 bg-ink text-white disabled:opacity-40"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
    </div>
  );
}

function Steps({ rail }: { rail: RailId }) {
  return (
    <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-3">
      {RAIL_INFO[rail].steps.map((step, i) => (
        <li key={step.name} className={cn("grainy rounded-[22px] p-5", step.tile)}>
          <div className="flex items-center justify-between gap-2">
            <span className="grid size-9 place-items-center rounded-full bg-ink font-semibold text-white">{i + 1}</span>
            <span className="rounded-full bg-white/60 px-3 py-1 text-xs font-semibold">{step.badge}</span>
          </div>
          <p className="m-0 mt-4 text-lg font-semibold">{step.description}</p>
          <ul className="m-0 mt-2 space-y-1 pl-5 text-[15px] leading-relaxed">
            {step.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function More({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-[18px] bg-white p-5 [&_summary]:cursor-pointer">
      <summary className="flex items-center justify-between gap-3 text-lg font-semibold [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronRight className="size-5 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>
      <div className="mt-3 space-y-2 text-[15px] leading-relaxed text-ink/85 [&_p]:m-0">{children}</div>
    </details>
  );
}

const COMPARE: [string, string, string][] = [
  ["When you pay you need", "Nothing: no signal, no data", "Phone signal, any phone"],
  ["You approve with", "The PAT app on your phone", "Your 4-digit PIN"],
  ["Sent on-chain by", "The merchant, once online", "PAT, automatically"],
  ["Money", "SOL", "A token, like USDC"],
  ["Paying stops", "When your time ends", "When your time ends"],
];

const FAQ: [string, string][] = [
  ["Can I get my money back early?", "No. What you didn't spend comes back 30 minutes after your time ends. Lock small amounts for short times."],
  ["What if I lose my phone?", "You can only lose what you locked. On USSD someone would also need your PIN; 3 wrong PINs lock it for 30 minutes."],
  ["What if PAT's USSD service is down?", "USSD payments wait until it's back. Your money stays locked and comes back to you when your time ends."],
  ["Does USSD cost money?", "It depends on your mobile network. Some charge a little per session."],
  ["Is it safe?", "QR: the merchant takes the risk if a payer cheats, so they set their own limits. USSD: you trust PAT's service and your PIN, but it can only pay merchant codes, and never more than you locked."],
];

export function Guide({ onReserve }: { onReserve: () => void }) {
  const [rail, setRail] = useState<RailId>(() => (USSD_ENABLED && window.location.hash === "#ussd" ? "ussd" : "qr"));

  // Deep links: /guide#qr, /guide#ussd pick the rail; other anchors scroll.
  useEffect(() => {
    const go = () => {
      const id = window.location.hash.slice(1);
      if (id === "qr" || (id === "ussd" && USSD_ENABLED)) setRail(id);
      if (id) document.getElementById(id === "qr" || id === "ussd" ? "how" : id)?.scrollIntoView({ block: "start" });
    };
    const t = window.setTimeout(go, 60);
    window.addEventListener("hashchange", go);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("hashchange", go);
    };
  }, []);

  const choose = (id: RailId) => {
    setRail(id);
    window.history.replaceState(null, "", `#${id}`);
    document.getElementById("how")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const choices: { id: RailId; title: string; icon: typeof QrCode; tone: string }[] = [
    { id: "qr", title: "No signal at all", icon: QrCode, tone: "bg-blue" },
    { id: "ussd", title: "Signal, but no data, or a basic phone", icon: Phone, tone: "bg-yellow" },
  ];

  return (
    <main className="page">
      <PageHeading
        eyebrow="Guide"
        lines={["Two ways", "to pay."]}
        lede="Lock some money while you're online. Then pay with whatever your phone has at the till."
        aside={<PillButton size="lg" text="Start" onClick={onReserve} />}
      />

      <div className="space-y-14 [&_section]:scroll-mt-28">
        <section id="pick" aria-labelledby="pick-h">
          <h2 id="pick-h" className="display-h mb-5 text-[clamp(30px,4vw,48px)]">What will you have when you pay?</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {choices.map(({ id, title, icon: Icon, tone }) => {
              const off = id === "ussd" && !USSD_ENABLED;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={off}
                  onClick={() => choose(id)}
                  aria-pressed={rail === id}
                  className={cn(
                    "grainy flex min-h-40 cursor-pointer flex-col items-start justify-between gap-6 rounded-[22px] border-0 p-6 text-left text-ink transition-shadow disabled:cursor-not-allowed disabled:opacity-55",
                    tone,
                    rail === id && "shadow-[0_0_0_3px_var(--ink)]",
                  )}
                >
                  <Icon className="size-8" aria-hidden="true" />
                  <span>
                    <span className="block text-2xl font-semibold leading-tight">{title}</span>
                    <span className="mt-1 block text-[15px]">
                      Use <b>{RAIL_INFO[id].label}</b>
                      {off ? " (coming soon)" : " →"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section id="how" aria-labelledby="how-h">
          <h2 id="how-h" className="display-h mb-2 text-[clamp(30px,4vw,48px)]">
            {rail === "qr" ? "Paying by QR" : "Paying by USSD"}
          </h2>
          <p className="mt-0 mb-6 max-w-2xl text-[17px] text-ink/80">{RAIL_INFO[rail].when}</p>
          <Steps rail={rail} />
          {rail === "ussd" ? (
            <div className="mt-8 grid items-center gap-8 rounded-[22px] bg-white p-5 sm:p-8 md:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-4">
                <h3 className="m-0 text-xl font-semibold">What you&rsquo;ll see on the phone</h3>
                <p className="m-0 text-[15px] leading-relaxed text-ink/80">
                  Tap through the screens. The merchant tells you their 10-digit code; the phone shows whose wallet it pays
                  before you type your PIN.
                </p>
                <DialCode />
              </div>
              <PhoneDemo />
            </div>
          ) : (
            <p className="mt-6 mb-0 rounded-[18px] bg-white px-5 py-4 text-[15px]">
              The app won&rsquo;t let you sign more than you locked. The merchant sees <b>Offline Accepted</b> on the spot and{" "}
              <b>Confirmed</b> once they settle online.
            </p>
          )}
        </section>

        <section id="merchants" aria-labelledby="merchants-h">
          <h2 id="merchants-h" className="display-h mb-5 text-[clamp(30px,4vw,48px)]">Selling? Get paid.</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[22px] bg-white p-6">
              <h3 className="m-0 mb-2 flex items-center gap-2 text-lg font-semibold">
                <Store className="size-5" aria-hidden="true" /> By USSD
              </h3>
              <p className="m-0 text-[15px] leading-relaxed text-ink/85">
                Connect your wallet and you get a 10-digit merchant code. Activate it once on the Merchant page. Tell customers
                the code; payments arrive in your wallet by themselves and show up as Confirmed.
              </p>
            </div>
            <div className="rounded-[22px] bg-white p-6">
              <h3 className="m-0 mb-2 flex items-center gap-2 text-lg font-semibold">
                <QrCode className="size-5" aria-hidden="true" /> By QR
              </h3>
              <p className="m-0 text-[15px] leading-relaxed text-ink/85">
                Scan the customer&rsquo;s QR on the Merchant page, even offline. When you&rsquo;re back online, tap Settle. Keep a
                little SOL for the network fee.
              </p>
            </div>
          </div>
        </section>

        <section id="more" aria-labelledby="more-h">
          <h2 id="more-h" className="display-h mb-5 text-[clamp(30px,4vw,48px)]">More details</h2>
          <div className="space-y-3">
            <More title="QR and USSD side by side">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-ink/10">
                      <th scope="col" className="py-2 pr-4"> </th>
                      <th scope="col" className="py-2 pr-4">QR</th>
                      <th scope="col" className="py-2">USSD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE.map(([k, qr, ussd]) => (
                      <tr key={k} className="border-b border-ink/8 last:border-0">
                        <th scope="row" className="py-2 pr-4 font-medium text-muted-foreground">{k}</th>
                        <td className="py-2 pr-4">{qr}</td>
                        <td className="py-2">{ussd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </More>
            <More title="Getting your money back">
              <p>Withdraw opens 30 minutes after your time ends, on both QR and USSD. There is no early cancel.</p>
              <p>You get back what you didn&rsquo;t spend plus the small SOL deposit for receipts you didn&rsquo;t use.</p>
            </More>
            <More title="Words you'll see">
              <p><b>Offline Accepted</b>: the merchant checked your QR. Not on-chain yet.</p>
              <p><b>Confirmed</b>: the payment is on-chain. It&rsquo;s final.</p>
              <p><b>Pending</b>: a USSD payment is on its way. It usually confirms within seconds.</p>
              <p><b>Releasable</b>: your time is over; withdraw what you didn&rsquo;t spend.</p>
            </More>
            {FAQ.map(([q, a]) => (
              <More key={q} title={q}>
                <p>{a}</p>
              </More>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
