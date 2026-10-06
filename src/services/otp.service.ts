import { createHash, timingSafeEqual } from "crypto";
import { deleteOtp, findOtp, updateOtpAttempts, upsertOtp } from "../models/Otp.model";
import { generateOtp, otpExpiry } from "../utils/otp.util";
import { sendOtpEmail } from "./notification.service";

const RESEND_COOLDOWN_MS = 30_000;

export async function createAndSendOtp(identifier: string, purpose: "signup" | "login") {
  const now = new Date();
  const existing = await findOtp(identifier, purpose);
  if (existing?.lastSentAt && now.getTime() - existing.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil(
      (RESEND_COOLDOWN_MS - (now.getTime() - existing.lastSentAt.getTime())) / 1000
    );
    throw Object.assign(new Error(`Please wait ${retryAfter} seconds before requesting another code.`), {
      statusCode: 429,
    });
  }

  const otp = generateOtp();
  const digest = hashOtp(otp);
  await upsertOtp({ identifier, purpose, otp: digest, expiresAt: otpExpiry(5), attempts: 0, lastSentAt: now });

  try {
    await sendOtpEmail(identifier, otp);
  } catch (error) {
    await deleteOtp(identifier, purpose, digest);
    throw error;
  }

  return true;
}

export async function verifyOtp(identifier: string, otp: string, purpose: "signup" | "login") {
  const record = await findOtp(identifier, purpose);
  if (!record) return false;
  if (record.expiresAt < new Date()) {
    await deleteOtp(identifier, purpose);
    return false;
  }

  const submittedDigest = Buffer.from(hashOtp(otp), "hex");
  const storedDigest = Buffer.from(record.otp, "hex");
  const valid =
    submittedDigest.length === storedDigest.length &&
    timingSafeEqual(submittedDigest, storedDigest);

  if (valid) {
    return deleteOtp(identifier, purpose, record.otp);
  }

  const attempts = await updateOtpAttempts(record._id);
  if (attempts !== null && attempts >= 5) await deleteOtp(identifier, purpose);
  return false;
}

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}