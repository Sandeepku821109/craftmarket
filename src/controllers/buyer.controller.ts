import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { searchSoftware } from "../services/software.service";
import { findPublicSoftwareById } from "../models/Software.model";
import { getPurchaseAccessExpiry } from "../services/payment.service";
import type { ISoftware } from "../models/Software.model";
import { query } from "../config/database";
import { z } from "zod";
import { streamCloudinaryArchive, streamCloudinaryPdf } from "../services/pdf.service";
import { streamGitHubRepositoryArchive } from "../services/github.service";

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
    paymentId: string | null;
    purchasedAt: Date;
    accessExpiresAt: Date | null;
    software: ISoftware | null;
  }>(
    `SELECT o.id AS "orderId", o.razorpay_payment_id AS "paymentId",
      COALESCE(o.paid_at, o.created_at) AS "purchasedAt",
      o.access_expires_at AS "accessExpiresAt",
      CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object(
        '_id', s.id, 'id', s.id, 'title', s.title, 'description', s.description,
        'creator', json_build_object('_id', creator.id, 'id', creator.id, 'name', creator.name, 'avatar', creator.avatar),
        'images', s.images, 'video', s.video,
        'liveDemoUrl', s.live_demo_url,
        'gitRepository', s.git_repository,
        'pdfAvailable', s.pdf_document IS NOT NULL,
        'projectArchiveAvailable', s.project_archive IS NOT NULL,
        'githubUsername', s.github_username,
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
      orderId: row.orderId,
      paymentId: row.paymentId,
      purchasedAt: row.purchasedAt,
      accessExpiresAt,
    }];
  });
  return sendSuccess(reply, purchases);
}

export async function getPurchasedSoftwarePdf(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);

  const result = await query<{ pdfDocument: string | null; accessExpiresAt: Date | null; createdAt: Date; paidAt: Date | null }>(
    `SELECT s.pdf_document AS "pdfDocument", o.access_expires_at AS "accessExpiresAt",
       o.created_at AS "createdAt", o.paid_at AS "paidAt"
     FROM orders o JOIN software s ON s.id = o.software_id
     WHERE o.buyer_id = $1 AND o.software_id = $2 AND o.status = 'paid'
     ORDER BY o.paid_at DESC NULLS LAST, o.created_at DESC LIMIT 1`,
    [req.user!.id, id]
  );
  const purchase = result.rows[0];
  if (!purchase) return sendError(reply, "A completed purchase is required to access this product file", 403);
  const accessExpiresAt = purchase.accessExpiresAt ?? getPurchaseAccessExpiry({
    paidAt: purchase.paidAt ?? undefined,
    createdAt: purchase.createdAt,
  });
  if (accessExpiresAt <= new Date()) return sendError(reply, "Purchase access has expired", 403);
  if (!purchase.pdfDocument) return sendError(reply, "This product has no downloadable PDF guide", 404);

  return streamCloudinaryPdf(req, reply, purchase.pdfDocument, `${id}-guide`);
}

export async function getPurchasedSoftwareArchive(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);

  const result = await query<{ projectArchive: string | null; gitRepository: string; accessExpiresAt: Date | null; createdAt: Date; paidAt: Date | null }>(
    `SELECT s.project_archive AS "projectArchive", s.git_repository AS "gitRepository",
       o.access_expires_at AS "accessExpiresAt",
       o.created_at AS "createdAt", o.paid_at AS "paidAt"
     FROM orders o JOIN software s ON s.id = o.software_id
     WHERE o.buyer_id = $1 AND o.software_id = $2 AND o.status = 'paid'
     ORDER BY o.paid_at DESC NULLS LAST, o.created_at DESC LIMIT 1`,
    [req.user!.id, id]
  );
  const purchase = result.rows[0];
  if (!purchase) return sendError(reply, "A completed purchase is required to access this product file", 403);
  const accessExpiresAt = purchase.accessExpiresAt ?? getPurchaseAccessExpiry({
    paidAt: purchase.paidAt ?? undefined,
    createdAt: purchase.createdAt,
  });
  if (accessExpiresAt <= new Date()) return sendError(reply, "Purchase access has expired", 403);
  if (purchase.projectArchive) {
    return streamCloudinaryArchive(req, reply, purchase.projectArchive, `${id}-project`);
  }
  return streamGitHubRepositoryArchive(reply, purchase.gitRepository, `${id}-project`);
}