import { randomInt } from "crypto";

export function generateOtp(): string {
  return randomInt(100000, 1_000_000).toString();
}

export function otpExpiry(minutes = 5): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}