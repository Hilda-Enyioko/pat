import express from "express";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { config } from "./config";
import { connection, readReservation } from "./chain";
import { q } from "./db";
import { hashPin, validPinFormat } from "./pin";
import { handleUssd } from "./ussd";
import { startKeeper } from "./keeper";

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Africa's Talking USSD callback (form-encoded). Reply must be text/plain "CON ..." or "END ...".
app.post("/ussd", async (req, res) => {
  const { sessionId, phoneNumber, text = "" } = req.body ?? {};
  res.type("text/plain");
  if (!sessionId || !phoneNumber) return res.status(400).send("END Bad request");
  try {
    res.send(await handleUssd({ sessionId, phone: phoneNumber, text }));
  } catch (e) {
    console.error(e);
    res.send("END Service unavailable. Please try again.");
  }
});

// DEV ONLY. Phase 4 replaces this with SMS OTP plus a wallet-signed proof of ownership.
app.post("/enroll", async (req, res) => {
  if (req.get("x-enroll-token") !== config.enrollToken)
    return res.status(401).json({ error: "unauthorized" });

  const { phone, reservation, pin, symbol = "USDC" } = req.body ?? {};
  if (!/^\+\d{8,15}$/.test(phone ?? "") || !validPinFormat(pin ?? ""))
    return res.status(400).json({ error: "bad phone or pin" });

  const key = new PublicKey(reservation);
  const r = await readReservation(key);

  if (!r?.mint || r.delegate?.toBase58() !== config.keeper.publicKey.toBase58()) {
    console.error("Reservation validation failed:", {
      reservation: key.toBase58(),
      fetchedMint: r?.mint?.toBase58(),
      fetchedDelegate: r?.delegate?.toBase58(),
      expectedKeeper: config.keeper.publicKey.toBase58(),
      rIsNull: r === null,
    });
    return res.status(400).json({ error: "not a delegated token reservation for this gateway" });
  }

  if (r.expiresAt * 1000 < Date.now())
    return res.status(400).json({ error: "reservation expired" });

  const { decimals } = await getMint(connection, r.mint);
  await q(
    `insert into enrollments (phone, owner, reservation, mint, decimals, symbol, pin_hash)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (phone) do update set
       owner=excluded.owner, reservation=excluded.reservation, mint=excluded.mint,
       decimals=excluded.decimals, symbol=excluded.symbol, pin_hash=excluded.pin_hash,
       failed_attempts=0, locked_until=null`,
    [phone, r.owner.toBase58(), key.toBase58(), r.mint.toBase58(), decimals, symbol, await hashPin(pin)]);
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`gateway on :${config.port}, keeper ${config.keeper.publicKey.toBase58()}`);
  startKeeper();
});
