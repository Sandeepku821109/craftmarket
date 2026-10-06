import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { searchSoftware } from "../services/software.service";
import { findPublicSoftwareById } from "../models/Software.model";
import { getPurchaseAccessExpiry } from "../services/payment.service";
import type { ISoftware } from "../models/Software.model";
import { query } from "../config/database";
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
  const software = await findPublicSoftwareById(id);
  if (!software) return sendError(reply, "Software not found", 404);
  delete (software as Partial<typeof software>).gitRepository;
  return sendSuccess(reply, software);
}

export async function getMyPurchases(req: FastifyRequest, reply: FastifyReply) {
  const now = new Date();
  const rows = await query<{
    orderId: string;
    purchasedAt: Date;
    accessExpiresAt: Date | null;
    software: ISoftware | null;
  }>(
    `SELECT o.id AS "orderId", COALESCE(o.paid_at, o.created_at) AS "purchasedAt",
      o.access_expires_at AS "accessExpiresAt",
      CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object(
        '_id', s.id, 'id', s.id, 'title', s.title, 'description', s.description,
        'creator', json_build_object('_id', creator.id, 'id', creator.id, 'name', creator.name, 'avatar', creator.avatar),
        'images', s.images, 'video', s.video,
        'liveDemoUrl', s.live_demo_url, 'pdfDocument', s.pdf_document,
        'githubUsername', s.github_username, 'gitRepository', s.git_repository,
        'languages', s.languages, 'platformType', s.platform_type, 'price', s.price,
        'status', s.status, 'totalSales', s.total_sales, 'totalRevenue', s.total_revenue,
        'createdAt', s.created_at
      ) END AS software
     FROM orders o LEFT JOIN software s ON s.id = o.software_id
     LEFT JOIN users creator ON creator.id = s.creator_id
     WHERE o.buyer_id = $1 AND o.status = 'paid'
     ORDER BY o.paid_at DESC NULLS LAST, o.created_at DESC`,
    [req.user!.id]
  );
  const purchases = rows.rows.flatMap((row) => {
    if (!row.software) return [];
    const accessExpiresAt = row.accessExpiresAt ?? getPurchaseAccessExpiry({
      createdAt: row.purchasedAt,
    });
    if (accessExpiresAt <= now) return [];
    const software = row.software;
    return [{
      ...software,
      purchasedAt: row.purchasedAt,
      accessExpiresAt,
    }];
  });
  return sendSuccess(reply, purchases);
}