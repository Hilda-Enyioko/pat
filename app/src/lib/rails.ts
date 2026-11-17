// One source of wording for the two rails, used by the "How PAT works" popup and the
// guide, so they can't contradict each other again. Keep it in plain words.
import { USSD_SERVICE_CODE } from "../config";

export type RailId = "qr" | "ussd";

export interface RailStep {
  name: string;
  badge: string;
  word: string;
  tile: string;
  description: string;
  points: string[];
}

export const RAIL_INFO: Record<RailId, { label: string; when: string; asset: string; note: string; steps: RailStep[] }> = {
  qr: {
    label: "QR (no signal)",
    when: "You have a smartphone with PAT, but no signal at all.",
    asset: "SOL",
    note: "\"Offline Accepted\" is the merchant's call. It becomes Confirmed only when the merchant settles it on-chain.",
    steps: [
      {
        name: "01 · Lock",
        badge: "Online",
        word: "Lock.",
        tile: "bg-blue",
        description: "While you still have signal.",
        points: ["Lock an amount of SOL from your wallet", "Pick a limit per payment and how long it lasts", "Only you can take it back, after it ends"],
      },
      {
        name: "02 · Sign",
        badge: "No signal",
        word: "Sign.",
        tile: "bg-yellow",
        description: "No internet needed.",
        points: ["The app checks what you have left", "You approve the payment in the app", "Show the merchant your QR code"],
      },
      {
        name: "03 · Settle",
        badge: "Merchant online",
        word: "Settle.",
        tile: "bg-red",
        description: "The merchant sends it on-chain.",
        points: ["The merchant checks the QR on the spot", "Back online, they settle it", "Confirmed means the money arrived"],
      },
    ],
  },
  ussd: {
    label: "USSD (any phone)",
    when: "You have signal but no data, or only a basic phone.",
    asset: "a token like USDC",
    note: "Your PIN approves each payment. Only lock what you'd carry as cash: there is no early cancel.",
    steps: [
      {
        name: "01 · Set up",
        badge: "Online, once",
        word: "Lock.",
        tile: "bg-blue",
        description: "Once, with internet.",
        points: ["Lock an amount of a token like USDC", "Add the phone number that will pay", "Choose a 4-digit PIN"],
      },
      {
        name: "02 · Dial",
        badge: "Signal only",
        word: "Dial.",
        tile: "bg-yellow",
        description: "Any phone. No data.",
        points: [`Dial ${USSD_SERVICE_CODE}`, "Enter the merchant's code and the amount", "Approve with your PIN"],
      },
      {
        name: "03 · Done",
        badge: "Automatic",
        word: "Paid.",
        tile: "bg-red",
        description: "Nobody has to settle.",
        points: ["PAT sends the payment on-chain for you", "The merchant sees it confirm", "You get an SMS receipt"],
      },
    ],
  },
};
