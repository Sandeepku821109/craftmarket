import { query } from "../config/database";

export interface IOrder {
  _id: string;
  id: string;
  buyer: string | Record<string, unknown>;
  software: string | Record<string, unknown>;
  creator: string | Record<string, unknown>;
  amount: number;
  platformFee: number;
  creatorEarning: number;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  status: "created" | "paid" | "failed";
  paidAt?: Date;
  accessExpiresAt?: Date;
  createdAt: Date;
}

export const ORDER_FIELDS = `id AS "_id", id, buyer_id AS buyer, software_id AS software,
  creator_id AS creator, amount::float8 AS amount, platform_fee::float8 AS "platformFee",
  creator_earning::float8 AS "creatorEarning", razorpay_order_id AS "razorpayOrderId",
  razorpay_payment_id AS "razorpayPaymentId", razorpay_signature AS "razorpaySignature",
  status, paid_at AS "paidAt", access_expires_at AS "accessExpiresAt", created_at AS "createdAt"`;

export async function createOrder(data: {
  buyer: string; software: string; creator: string; amount: number;
  platformFee: number; creatorEarning: number; razorpayOrderId: string;
}): Promise<IOrder> {
  const result = await query<IOrder>(
    `INSERT INTO orders (buyer_id, software_id, creator_id, amount, platform_fee, creator_earning, razorpay_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${ORDER_FIELDS}`,
    [data.buyer, data.software, data.creator, data.amount, data.platformFee, data.creatorEarning, data.razorpayOrderId]
  );
  return result.rows[0];
}

export async function findPaidOrders(buyerId: string, softwareId: string): Promise<IOrder[]> {
  const result = await query<IOrder>(
    `SELECT ${ORDER_FIELDS} FROM orders WHERE buyer_id = $1 AND software_id = $2 AND status = 'paid'`,
    [buyerId, softwareId]
  );
  return result.rows;
}

export async function countPaidOrders(): Promise<number> {
  const result = await query<{ count: string }>("SELECT count(*) FROM orders WHERE status = 'paid'");
  return Number(result.rows[0].count);
}

export async function paidOrderRevenue(): Promise<{ totalRevenue: number; platformEarnings: number }> {
  const result = await query<{ totalRevenue: number; platformEarnings: number }>(
    `SELECT COALESCE(sum(amount), 0)::float8 AS "totalRevenue",
      COALESCE(sum(platform_fee), 0)::float8 AS "platformEarnings"
     FROM orders WHERE status = 'paid'`
  );
  return result.rows[0];
}
