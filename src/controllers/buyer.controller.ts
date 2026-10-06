import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { searchSoftware } from "../services/software.service";
import { SoftwareModel } from "../models/Software.model";
import { OrderModel } from "../models/Order.model";
import { getPurchaseAccessExpiry } from "../services/payment.service";
import { ISoftware } from "../models/Software.model";
import { z } from "zod";

export async function browseSoftware(req: FastifyRequest, reply: FastifyReply) {
  const parsed = z.object({
    search: z.string().trim().max(200).optional(),
    platformType: z.enum(["frontend", "backend", "fullstack", "mobile-app"]).optional(),
    language: z.string().trim().max(100).optional(),
    minPrice: z.coerce.number().finite().nonnegative().optional(),
    maxPrice: z.coerce.number().finite().nonnegative().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
  }).safeParse(req.query);
  if (!parsed.success) return sendError(reply, "Invalid search parameters", 400, parsed.error.flatten());
  if (
    parsed.data.minPrice !== undefined &&
    parsed.data.maxPrice !== undefined &&
    parsed.data.minPrice > parsed.data.maxPrice
  ) {
    return sendError(reply, "minPrice cannot exceed maxPrice", 400);
  }

  const result = await searchSoftware({
    ...parsed.data,
  });
  return sendSuccess(reply, result);
}

export async function getSoftwareDetails(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);
  const software = await SoftwareModel.findOne({ _id: id, status: "approved" })
    .select("-gitRepository")
    .populate("creator", "name avatar");
  if (!software) return sendError(reply, "Software not found", 404);
  return sendSuccess(reply, software);
}

export async function getMyPurchases(req: FastifyRequest, reply: FastifyReply) {
  const now = new Date();
  const orders = await OrderModel.find({ buyer: req.user!.id, status: "paid" })
    .populate<{ software: ISoftware | null }>("software")
    .sort({ paidAt: -1, createdAt: -1 });
  const purchases = orders.flatMap((order) => {
    const accessExpiresAt = getPurchaseAccessExpiry(order);
    if (accessExpiresAt <= now || !order.software) return [];
    const software = order.software.toObject();
    return [{
      ...software,
      purchasedAt: order.paidAt || order.createdAt,
      accessExpiresAt,
    }];
  });
  return sendSuccess(reply, purchases);
}