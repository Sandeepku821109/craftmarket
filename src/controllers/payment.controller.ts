import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { createRazorpayOrder, completeOrder } from "../services/payment.service";
import { ENV } from "../config/env";
import { z } from "zod";

export async function initiatePayment(req: FastifyRequest, reply: FastifyReply) {
  const parsed = z.object({
    softwareId: z.string().regex(/^[a-f\d]{24}$/i),
  }).safeParse(req.body);
  if (!parsed.success) return sendError(reply, "A valid softwareId is required", 400);

  const { razorpayOrder, orderId } = await createRazorpayOrder(
    parsed.data.softwareId,
    req.user!.id
  );

  return sendSuccess(reply, { razorpayOrder, orderId, key: ENV.RAZORPAY_KEY_ID });
}

export async function verifyPayment(req: FastifyRequest, reply: FastifyReply) {
  const parsed = z.object({
    orderId: z.string().regex(/^[a-f\d]{24}$/i),
    razorpay_order_id: z.string().min(1),
    razorpay_payment_id: z.string().min(1),
    razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i),
  }).safeParse(req.body);
  if (!parsed.success) return sendError(reply, "Invalid payment verification details", 400);

  const order = await completeOrder(
    parsed.data.orderId,
    req.user!.id,
    parsed.data.razorpay_payment_id,
    parsed.data.razorpay_order_id,
    parsed.data.razorpay_signature
  );

  return sendSuccess(reply, order, "Payment verified, purchase complete");
}