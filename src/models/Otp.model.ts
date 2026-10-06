import { Schema, model, Document } from "mongoose";

export interface IOtp extends Document {
  identifier: string; // email or mobile
  otp: string;
  purpose: "signup" | "login";
  expiresAt: Date;
  lastSentAt?: Date;
  attempts: number;
}

const otpSchema = new Schema<IOtp>({
  identifier: { type: String, required: true },
  otp: { type: String, required: true },
  purpose: { type: String, enum: ["signup", "login"], required: true },
  expiresAt: { type: Date, required: true },
  lastSentAt: { type: Date },
  attempts: { type: Number, default: 0, min: 0, max: 5 },
});

// Auto-delete expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ identifier: 1, purpose: 1 }, { unique: true });

export const OtpModel = model<IOtp>("Otp", otpSchema);