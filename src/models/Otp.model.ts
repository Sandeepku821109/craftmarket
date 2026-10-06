import { query } from "../config/database";

export interface IOtp {
  _id: string;
  identifier: string;
  otp: string;
  purpose: "signup" | "login";
  expiresAt: Date;
  lastSentAt?: Date;
  attempts: number;
}

const OTP_FIELDS = `id AS "_id", identifier, otp, purpose, expires_at AS "expiresAt",
  last_sent_at AS "lastSentAt", attempts`;

export async function findOtp(identifier: string, purpose: IOtp["purpose"]): Promise<IOtp | null> {
  const result = await query<IOtp>(
    `SELECT ${OTP_FIELDS} FROM otps WHERE identifier = $1 AND purpose = $2`,
    [identifier, purpose]
  );
  return result.rows[0] ?? null;
}

export async function upsertOtp(data: Omit<IOtp, "_id">): Promise<void> {
  await query(
    `INSERT INTO otps (identifier, otp, purpose, expires_at, last_sent_at, attempts)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (identifier, purpose) DO UPDATE SET
       otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at,
       last_sent_at = EXCLUDED.last_sent_at, attempts = EXCLUDED.attempts`,
    [data.identifier, data.otp, data.purpose, data.expiresAt, data.lastSentAt ?? null, data.attempts]
  );
}

export async function deleteOtp(identifier: string, purpose: IOtp["purpose"], otp?: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM otps WHERE identifier = $1 AND purpose = $2 ${otp === undefined ? "" : "AND otp = $3"}`,
    otp === undefined ? [identifier, purpose] : [identifier, purpose, otp]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateOtpAttempts(id: string): Promise<number | null> {
  const result = await query<{ attempts: number }>(
    "UPDATE otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts",
    [id]
  );
  return result.rows[0]?.attempts ?? null;
}
