import { createHmac, timingSafeEqual } from "crypto";
import { razorpayInstance } from "../config/razorpay";
import { ENV } from "../config/env";
import { withTransaction } from "../config/database";
import { createOrder, findPaidOrders, ORDER_FIELDS, type IOrder } from "../models/Order.model";
import { findSoftwareById } from "../models/Software.model";
import { findUserById } from "../models/User.model";

function serviceError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

const PURCHASE_ACCESS_MONTHS = 6;

export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastTargetDay = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0
  )).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastTargetDay));
  return result;
}

export function getPurchaseAccessExpiry(order: {
  paidAt?: Date;
  createdAt: Date;
  accessExpiresAt?: Date;
}): Date {
  return order.accessExpiresAt || addCalendarMonths(order.paidAt || order.createdAt, PURCHASE_ACCESS_MONTHS);
}

export async function createRazorpayOrder(softwareId: string, buyerId: string) {
  const software = await findSoftwareById(softwareId);
  if (!software || software.status !== "approved") {
    throw serviceError(404, "Software not found");
  }
  if (software.creator.toString() === buyerId) {
    throw serviceError(400, "You cannot purchase your own software");
  }

  const buyer = await findUserById(buyerId);
  if (!buyer) throw serviceError(404, "Buyer not found");
  const priorPaidOrders = await findPaidOrders(buyerId, software._id);
  if (priorPaidOrders.some((order) => getPurchaseAccessExpiry(order) > new Date())) {
    throw serviceError(409, "Software has already been purchased");
  }

  const amountInPaise = Math.round(software.price * 100);
  if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) {
    throw serviceError(400, "Software has an invalid price");
  }
  const amount = amountInPaise / 100;

  const razorpayOrder = await razorpayInstance.orders.create({
    amount: amountInPaise,
    currency: "INR",
    receipt: `rcpt_${Date.now()}`,
  });

  const platformFeeInPaise = Math.round(
    (amountInPaise * ENV.PLATFORM_COMMISSION_PERCENT) / 100
  );
  const platformFee = platformFeeInPaise / 100;
  const creatorEarning = (amountInPaise - platformFeeInPaise) / 100;

  const order = await createOrder({
    buyer: buyerId,
    software: softwareId,
    creator: String(software.creator),
    amount,
    platformFee,
    creatorEarning,
    razorpayOrderId: razorpayOrder.id,
  });

  return { razorpayOrder, orderId: order._id };
}

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string) {
  const generated = createHmac("sha256", ENV.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(generated, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

export async function completeOrder(
  orderId: string,
  buyerId: string,
  paymentId: string,
  razorpayOrderId: string,
  signature: string
) {
  return withTransaction(async (client) => {
    const result = await client.query<IOrder>(
      `SELECT ${ORDER_FIELDS} FROM orders
       WHERE id = $1 AND buyer_id = $2 AND razorpay_order_id = $3 FOR UPDATE`,
      [orderId, buyerId, razorpayOrderId]
    );
    const order = result.rows[0];
    if (!order) throw serviceError(404, "Order not found");
    if (!verifyRazorpaySignature(razorpayOrderId, paymentId, signature)) {
      throw serviceError(400, "Invalid payment signature");
    }
    if (order.status === "paid") {
      if (order.razorpayPaymentId !== paymentId) throw serviceError(409, "Order has already been paid");
      return order;
    }
    if (order.status !== "created") throw serviceError(409, "Order is no longer payable");

    const paidAt = new Date();
    const accessExpiresAt = addCalendarMonths(paidAt, PURCHASE_ACCESS_MONTHS);
    const updated = await client.query<IOrder>(
      `UPDATE orders SET status = 'paid', razorpay_payment_id = $2, razorpay_signature = $3,
        paid_at = $4, access_expires_at = $5, updated_at = now()
       WHERE id = $1 AND status = 'created' RETURNING ${ORDER_FIELDS}`,
      [order._id, paymentId, signature, paidAt, accessExpiresAt]
    );
    if (!updated.rows[0]) throw serviceError(409, "Order is no longer payable");

    const softwareResult = await client.query(
      `UPDATE software SET total_sales = total_sales + 1, total_revenue = total_revenue + $2,
       updated_at = now() WHERE id = $1`,
      [order.software, order.amount]
    );
    const creatorResult = await client.query(
      "UPDATE users SET total_earnings = total_earnings + $2, updated_at = now() WHERE id = $1",
      [order.creator, order.creatorEarning]
    );
    const buyerResult = await client.query(
      `UPDATE users SET purchased_software =
       CASE WHEN $2 = ANY(purchased_software) THEN purchased_software ELSE array_append(purchased_software, $2) END,
       updated_at = now() WHERE id = $1`,
      [order.buyer, order.software]
    );
    if (softwareResult.rowCount !== 1 || creatorResult.rowCount !== 1 || buyerResult.rowCount !== 1) {
      throw serviceError(500, "Could not update purchase records");
    }

    await client.query(
      `INSERT INTO earnings (order_id, buyer_id, creator_id, software_id, amount, platform_fee, creator_earning)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [order._id, order.buyer, order.creator, order.software, order.amount, order.platformFee, order.creatorEarning]
    );
    return updated.rows[0];
  });
}