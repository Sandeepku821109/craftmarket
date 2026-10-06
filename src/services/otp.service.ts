import { createHash, timingSafeEqual } from "crypto";
import { OtpModel } from "../models/Otp.model";
import { generateOtp, otpExpiry } from "../utils/otp.util";
import { sendOtpEmail } from "./notification.service";

const RESEND_COOLDOWN_MS = 30_000;

export async function createAndSendOtp(identifier: string, purpose: "signup" | "login") {
  const now = new Date();
  const existing = await OtpModel.findOne({ identifier, purpose }).select("lastSentAt");
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
  await OtpModel.findOneAndUpdate(
    { identifier, purpose },
    { otp: digest, expiresAt: otpExpiry(5), attempts: 0, lastSentAt: now },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    await sendOtpEmail(identifier, otp);
  } catch (error) {
    await OtpModel.deleteOne({ identifier, purpose, otp: digest });
    throw error;
  }

  return true;
}

export async function verifyOtp(identifier: string, otp: string, purpose: "signup" | "login") {
  const record = await OtpModel.findOne({ identifier, purpose });
  if (!record) return false;
  if (record.expiresAt < new Date()) {
    await record.deleteOne();
    return false;
  }

  const submittedDigest = Buffer.from(hashOtp(otp), "hex");
  const storedDigest = Buffer.from(record.otp, "hex");
  const valid =
    submittedDigest.length === storedDigest.length &&
    timingSafeEqual(submittedDigest, storedDigest);

  if (valid) {
    const result = await OtpModel.deleteOne({ _id: record._id, otp: record.otp });
    return result.deletedCount === 1;
  }

  const updated = await OtpModel.findByIdAndUpdate(
    record._id,
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (updated && updated.attempts >= 5) {
    await OtpModel.deleteOne({ _id: record._id });
  }
  return false;
}

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}