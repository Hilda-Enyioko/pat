import argon2 from "argon2";
import { config } from "./config";

const secret = Buffer.from(config.pinPepper);
export const validPinFormat = (pin: string) => /^\d{4}$/.test(pin);
export const hashPin = (pin: string) => argon2.hash(pin, { type: argon2.argon2id, secret });
export const verifyPin = (hash: string, pin: string) =>
  argon2.verify(hash, pin, { secret }).catch(() => false);
