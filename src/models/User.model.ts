import { query } from "../config/database";

export type UserRole = "creator" | "buyer" | "admin";

export interface IUser {
  _id: string;
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: UserRole;
  isVerified: boolean;
  avatar?: string;
  uploadedSoftware: string[];
  purchasedSoftware: string[];
  totalEarnings: number;
  refreshToken?: string;
  createdAt: Date;
}

export interface CreatorPayoutDetails {
  payoutMethod: "paypal" | "upi" | null;
  paypalEmail: string | null;
  upiId: string | null;
}

const USER_FIELDS = `id AS "_id", id, name, email, mobile, role,
  is_verified AS "isVerified", avatar, uploaded_software AS "uploadedSoftware",
  purchased_software AS "purchasedSoftware", total_earnings::float8 AS "totalEarnings",
  created_at AS "createdAt"`;

export async function findUserById(id: string, includeRefreshToken = false): Promise<IUser | null> {
  const fields = includeRefreshToken ? `${USER_FIELDS}, refresh_token AS "refreshToken"` : USER_FIELDS;
  const result = await query<IUser>(`SELECT ${fields} FROM users WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function findUserByIdentifier(identifier: string): Promise<IUser | null> {
  const normalized = identifier.trim();
  const result = await query<IUser>(
    `SELECT ${USER_FIELDS} FROM users WHERE email = $1 OR mobile = $2 LIMIT 1`,
    [normalized.toLowerCase(), normalized]
  );
  return result.rows[0] ?? null;
}

export async function getCreatorPayoutDetails(userId: string): Promise<CreatorPayoutDetails | null> {
  const result = await query<CreatorPayoutDetails>(
    `SELECT payout_method AS "payoutMethod", paypal_email AS "paypalEmail", upi_id AS "upiId"
     FROM users WHERE id = $1 AND role = 'creator'`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function saveCreatorPayoutDetails(
  userId: string,
  details: { payoutMethod: "paypal"; paypalEmail: string } | { payoutMethod: "upi"; upiId: string }
): Promise<CreatorPayoutDetails | null> {
  const result = details.payoutMethod === "paypal"
    ? await query<CreatorPayoutDetails>(
      `UPDATE users SET payout_method = 'paypal', paypal_email = $2, upi_id = NULL, updated_at = now()
       WHERE id = $1 AND role = 'creator'
       RETURNING payout_method AS "payoutMethod", paypal_email AS "paypalEmail", upi_id AS "upiId"`,
      [userId, details.paypalEmail]
    )
    : await query<CreatorPayoutDetails>(
      `UPDATE users SET payout_method = 'upi', paypal_email = NULL, upi_id = $2, updated_at = now()
       WHERE id = $1 AND role = 'creator'
       RETURNING payout_method AS "payoutMethod", paypal_email AS "paypalEmail", upi_id AS "upiId"`,
      [userId, details.upiId]
    );
  return result.rows[0] ?? null;
}

export async function userExists(field: "email" | "mobile", value: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM users WHERE ${field} = $1) AS exists`,
    [value]
  );
  return result.rows[0].exists;
}

export async function createUser(data: {
  name: string;
  email: string;
  mobile: string;
  role?: UserRole;
}): Promise<IUser> {
  const result = await query<IUser>(
    `INSERT INTO users (name, email, mobile, role, is_verified)
     VALUES ($1, $2, $3, $4, true) RETURNING ${USER_FIELDS}`,
    [data.name.trim(), data.email.trim().toLowerCase(), data.mobile.trim(), data.role ?? "buyer"]
  );
  return result.rows[0];
}

export async function saveRefreshToken(id: string, refreshToken: string): Promise<void> {
  await query("UPDATE users SET refresh_token = $2, updated_at = now() WHERE id = $1", [id, refreshToken]);
}

export async function clearRefreshToken(id: string, refreshToken: string): Promise<void> {
  await query(
    "UPDATE users SET refresh_token = NULL, updated_at = now() WHERE id = $1 AND refresh_token = $2",
    [id, refreshToken]
  );
}

export async function addUploadedSoftware(userId: string, softwareId: string): Promise<void> {
  await query(
    "UPDATE users SET uploaded_software = array_append(uploaded_software, $2), updated_at = now() WHERE id = $1",
    [userId, softwareId]
  );
}

export async function updateMemberRole(
  userId: string,
  role: Exclude<UserRole, "admin">,
  actingAdminId: string
): Promise<IUser | null> {
  const result = await query<IUser>(
    `UPDATE users SET role = $2, updated_at = now()
     WHERE id = $1 AND id <> $3 AND role <> 'admin'
     RETURNING ${USER_FIELDS}`,
    [userId, role, actingAdminId]
  );
  return result.rows[0] ?? null;
}

export async function countUsers(role?: UserRole): Promise<number> {
  const result = role
    ? await query<{ count: string }>("SELECT count(*) FROM users WHERE role = $1", [role])
    : await query<{ count: string }>("SELECT count(*) FROM users");
  return Number(result.rows[0].count);
}

export async function listUsers(): Promise<(Omit<IUser, "refreshToken"> & { paymentIds: string[] })[]> {
  const result = await query<Omit<IUser, "refreshToken"> & { paymentIds: string[] }>(
    `SELECT u.id AS "_id", u.id, u.name, u.email, u.mobile, u.role,
      u.is_verified AS "isVerified",
      u.avatar, u.uploaded_software AS "uploadedSoftware",
      u.purchased_software AS "purchasedSoftware",
      u.total_earnings::float8 AS "totalEarnings", u.created_at AS "createdAt",
      COALESCE(
        array_agg(o.razorpay_payment_id ORDER BY o.paid_at DESC)
          FILTER (WHERE o.razorpay_payment_id IS NOT NULL),
        ARRAY[]::text[]
      ) AS "paymentIds"
     FROM users u
     LEFT JOIN orders o ON o.buyer_id = u.id AND o.status = 'paid'
     GROUP BY u.id
     ORDER BY u.created_at DESC`
  );
  return result.rows;
}
