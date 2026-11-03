import { PublicKey } from "@solana/web3.js";
import { q } from "./db";
import { mapError, paymentExists, settleDelegated } from "./chain";
import { notify } from "./sms";
import { fromBase } from "./ussd";

const MAX_ATTEMPTS = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = {
  id: string; payment_id: Buffer; merchant_code: number; amount: string; attempts: number;
  phone: string; reservation: string; mint: string; decimals: number; symbol: string;
};

async function claim(): Promise<Job | null> {
  const [job] = await q<Job>(`
    with next as (
      select id from payments where status='pending' order by id for update skip locked limit 1)
    update payments p set status='sending', attempts = p.attempts + 1, updated_at = now()
    from next, enrollments e
    where p.id = next.id and e.id = p.enrollment_id
    returning p.id, p.payment_id, p.merchant_code, p.amount, p.attempts,
              e.phone, e.reservation, e.mint, e.decimals, e.symbol`);
  return job ?? null;
}

async function markSettled(job: Job, signature: string | null, shown: string) {
  await q("update payments set status='settled', signature=$2, error=null, updated_at=now() where id=$1",
    [job.id, signature]);
  await notify(job.phone,
    `PAT: paid ${shown} to merchant ${job.merchant_code}. Ref ${signature?.slice(0, 8) ?? "n/a"}`);
}

async function processJob(job: Job) {
  const reservation = new PublicKey(job.reservation);
  const mint = new PublicKey(job.mint);
  const amount = BigInt(job.amount);
  const shown = `${fromBase(amount, job.decimals)} ${job.symbol}`;

  try {
    // A previous attempt may have landed after a timeout; the Payment PDA is the truth.
    const signature = (await paymentExists(reservation, job.payment_id))
      ? null
      : await settleDelegated({
          reservation, mint, paymentId: job.payment_id,
          merchantCode: job.merchant_code, amount,
        });
    await markSettled(job, signature, shown);
  } catch (e) {
    const err = mapError(e);
    if (err.alreadySettled) return markSettled(job, null, shown);
    if (err.retriable && job.attempts < MAX_ATTEMPTS) {
      await q("update payments set status='pending', error=$2, updated_at=now() where id=$1",
        [job.id, err.raw.slice(0, 500)]);
      return sleep(2000 * job.attempts);
    }
    await q("update payments set status='failed', error=$2, updated_at=now() where id=$1",
      [job.id, err.raw.slice(0, 500)]);
    await notify(job.phone,
      `PAT: payment of ${shown} to merchant ${job.merchant_code} failed. ${err.userMessage}`);
  }
}

export function startKeeper() {
  let stop = false;
  (async () => {
    // Safe only while a single keeper instance runs: the Payment PDA blocks double-settle,
    // but a second instance would have its in-flight jobs reset by this line.
    await q("update payments set status='pending' where status='sending'");
    while (!stop) {
      try {
        const job = await claim();
        if (!job) { await sleep(1000); continue; }
        await processJob(job);
      } catch (e) {
        console.error("keeper loop error", e);
        await sleep(3000);
      }
    }
  })();
  return () => { stop = true; };
}
