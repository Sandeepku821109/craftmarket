import { createHmac, timingSafeEqual } from "crypto";
import mongoose from "mongoose";
import { razorpayInstance } from "../config/razorpay";
import { ENV } from "../config/env";
import { OrderModel } from "../models/Order.model";
import { SoftwareModel } from "../models/Software.model";
import { UserModel } from "../models/User.model";
import { EarningModel } from "../models/Earning.model";
import { IOrder } from "../models/Order.model";

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
  const software = await SoftwareModel.findById(softwareId);
  if (!software || software.status !== "approved") {
    throw serviceError(404, "Software not found");
  }
  if (software.creator.toString() === buyerId) {
    throw serviceError(400, "You cannot purchase your own software");
  }

  const buyer = await UserModel.findById(buyerId).select("_id");
  if (!buyer) throw serviceError(404, "Buyer not found");
  const priorPaidOrders = await OrderModel.find({
    buyer: buyerId,
    software: software._id,
    status: "paid",
  }).select("paidAt accessExpiresAt createdAt");
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

  const order = await OrderModel.create({
    buyer: buyerId,
    software: softwareId,
    creator: software.creator,
    amount,
    platformFee,
    creatorEarning,
    razorpayOrderId: razorpayOrder.id,
    status: "created",
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
  const session = await mongoose.startSession();
  let completedOrder: IOrder | null = null;
  try {
    await session.withTransaction(async () => {
      const order = await OrderModel.findOne({
        _id: orderId,
        buyer: buyerId,
        razorpayOrderId,
      }).session(session);
      if (!order) throw serviceError(404, "Order not found");
      if (!verifyRazorpaySignature(razorpayOrderId, paymentId, signature)) {
        throw serviceError(400, "Invalid payment signature");
      }

      if (order.status === "paid") {
        if (order.razorpayPaymentId !== paymentId) {
          throw serviceError(409, "Order has already been paid");
        }
        completedOrder = order;
        return;
      }

      const updatedOrder = await OrderModel.findOneAndUpdate(
        { _id: order._id, status: "created" },
        {
          $set: {
            status: "paid",
            razorpayPaymentId: paymentId,
            razorpaySignature: signature,
            paidAt: new Date(),
          },
        },
        { new: true, session }
      );
      if (!updatedOrder) throw serviceError(409, "Order is no longer payable");
      updatedOrder.accessExpiresAt = addCalendarMonths(updatedOrder.paidAt!, PURCHASE_ACCESS_MONTHS);
      await updatedOrder.save({ session });

      const softwareResult = await SoftwareModel.updateOne(
        { _id: order.software },
        { $inc: { totalSales: 1, totalRevenue: order.amount } },
        { session }
      );
      const creatorResult = await UserModel.updateOne(
        { _id: order.creator },
        { $inc: { totalEarnings: order.creatorEarning } },
        { session }
      );
      const buyerResult = await UserModel.updateOne(
        { _id: order.buyer },
        { $addToSet: { purchasedSoftware: order.software } },
        { session }
      );
      if (
        softwareResult.matchedCount !== 1 ||
        creatorResult.matchedCount !== 1 ||
        buyerResult.matchedCount !== 1
      ) {
        throw serviceError(500, "Could not update purchase records");
      }

      await EarningModel.create(
        {
          order: order._id,
          buyer: order.buyer,
          creator: order.creator,
          software: order.software,
          amount: order.amount,
          platformFee: order.platformFee,
          creatorEarning: order.creatorEarning,
        },
        { session }
      );
      completedOrder = updatedOrder;
    });
    if (!completedOrder) throw serviceError(500, "Payment completion failed");
    return completedOrder;
  } finally {
    await session.endSession();
  }
}