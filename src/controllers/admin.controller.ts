import { Readable } from "node:stream";
import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { countUsers, findUserById, listUsers } from "../models/User.model";
import {
  countSoftware,
  findSoftwareById,
  listSoftwareForAdmin,
  updateSoftwareStatus,
} from "../models/Software.model";
import { ENV } from "../config/env";
import {
  deleteContactSubmission as removeContactSubmission,
  listContactSubmissions,
  updateContactSubmissionStatus as saveContactSubmissionStatus,
} from "../models/ContactSubmission.model";
import { countPaidOrders, paidOrderRevenue } from "../models/Order.model";
import { query } from "../config/database";
import { z } from "zod";

export async function getDashboardStats(_req: FastifyRequest, reply: FastifyReply) {
  const [totalUsers, totalCreators, totalBuyers, totalSoftware, totalOrders, revenue] =
    await Promise.all([
      countUsers(),
      countUsers("creator"),
      countUsers("buyer"),
      countSoftware(),
      countPaidOrders(),
      paidOrderRevenue(),
    ]);

  return sendSuccess(reply, {
    totalUsers,
    totalCreators,
    totalBuyers,
    totalSoftware,
    totalOrders,
    totalRevenue: revenue.totalRevenue,
    platformEarnings: revenue.platformEarnings,
  });
}

export async function getAllUsers(_req: FastifyRequest, reply: FastifyReply) {
  const users = await listUsers();
  return sendSuccess(reply, users);
}

export async function getAllSoftware(_req: FastifyRequest, reply: FastifyReply) {
  const software = await listSoftwareForAdmin();
  return sendSuccess(reply, software);
}

export async function getSoftwarePdf(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);

  const software = await findSoftwareById(id);
  if (!software?.pdfDocument) return sendError(reply, "Product PDF not found", 404);

  let pdfUrl: URL;
  try {
    pdfUrl = new URL(software.pdfDocument);
  } catch {
    return sendError(reply, "Product PDF URL is invalid", 502);
  }

  const cloudName = encodeURIComponent(ENV.CLOUDINARY_CLOUD_NAME);
  const cloudinaryPath = new RegExp(`^/${cloudName}/(?:raw|image)/upload/`);
  if (
    pdfUrl.protocol !== "https:" ||
    pdfUrl.hostname !== "res.cloudinary.com" ||
    pdfUrl.username ||
    pdfUrl.password ||
    !cloudinaryPath.test(pdfUrl.pathname)
  ) {
    return sendError(reply, "Product PDF URL is not a valid Cloudinary asset", 502);
  }

  const requestHeaders: HeadersInit = {};
  if (typeof req.headers.range === "string") {
    requestHeaders.Range = req.headers.range;
  }
  const upstream = await fetch(pdfUrl, { headers: requestHeaders });
  const body = upstream.body;
  if ((upstream.status !== 200 && upstream.status !== 206) || !body) {
    return sendError(reply, "Cloudinary could not load the product PDF", 502);
  }

  reply
    .code(upstream.status)
    .header("content-type", "application/pdf")
    .header("content-disposition", `inline; filename="${id}.pdf"`)
    .header("accept-ranges", "bytes")
    .header("cache-control", "private, no-store")
    .header("content-security-policy", `frame-ancestors ${ENV.CORS_ORIGINS.join(" ")}`);
  const contentLength = upstream.headers.get("content-length");
  const contentRange = upstream.headers.get("content-range");
  if (contentLength) reply.header("content-length", contentLength);
  if (contentRange) reply.header("content-range", contentRange);

  const pdfStream = Readable.from((async function* () {
    const reader = body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return;
        yield chunk.value;
      }
    } finally {
      reader.releaseLock();
    }
  })());
  return reply.send(pdfStream);
}

export async function approveSoftware(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const software = await updateSoftwareStatus(id, "approved");
  if (!software) return sendError(reply, "Software not found", 404);
  return sendSuccess(reply, software, "Software approved");
}

export async function rejectSoftware(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const software = await updateSoftwareStatus(id, "rejected");
  if (!software) return sendError(reply, "Software not found", 404);
  return sendSuccess(reply, software, "Software rejected");
}

export async function getCreatorEarnings(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const fullCreator = await findUserById(id);
  const creator = fullCreator && {
    _id: fullCreator._id,
    id: fullCreator.id,
    name: fullCreator.name,
    email: fullCreator.email,
    totalEarnings: fullCreator.totalEarnings,
  };
  const result = await query(
    `SELECT o.id AS "_id", o.id, o.buyer_id AS buyer, o.creator_id AS creator,
      json_build_object('id', s.id, 'title', s.title) AS software,
      o.amount::float8 AS amount, o.platform_fee::float8 AS "platformFee",
      o.creator_earning::float8 AS "creatorEarning", o.razorpay_order_id AS "razorpayOrderId",
      o.razorpay_payment_id AS "razorpayPaymentId", o.status, o.paid_at AS "paidAt",
      o.access_expires_at AS "accessExpiresAt", o.created_at AS "createdAt"
     FROM orders o JOIN software s ON s.id = o.software_id
     WHERE o.creator_id = $1 AND o.status = 'paid' ORDER BY o.created_at DESC`,
    [id]
  );
  const orders = result.rows;
  return sendSuccess(reply, { creator, orders });
}

export async function getAllOrders(_req: FastifyRequest, reply: FastifyReply) {
  const result = await query(
    `SELECT o.id AS "_id", o.id,
      json_build_object('_id', b.id, 'id', b.id, 'name', b.name, 'email', b.email) AS buyer,
      json_build_object('_id', c.id, 'id', c.id, 'name', c.name, 'email', c.email) AS creator,
      json_build_object('_id', s.id, 'id', s.id, 'title', s.title, 'price', s.price) AS software,
      o.amount::float8 AS amount, o.platform_fee::float8 AS "platformFee",
      o.creator_earning::float8 AS "creatorEarning", o.razorpay_order_id AS "razorpayOrderId",
      o.razorpay_payment_id AS "razorpayPaymentId", o.razorpay_signature AS "razorpaySignature",
      o.status, o.paid_at AS "paidAt", o.access_expires_at AS "accessExpiresAt",
      o.created_at AS "createdAt"
     FROM orders o JOIN users b ON b.id = o.buyer_id
     JOIN users c ON c.id = o.creator_id JOIN software s ON s.id = o.software_id
     ORDER BY o.created_at DESC`
  );
  return sendSuccess(reply, result.rows);
}

export async function getContactSubmissions(_req: FastifyRequest, reply: FastifyReply) {
  const submissions = await listContactSubmissions();
  return sendSuccess(reply, submissions.map((submission) => ({
    ...submission,
    status: submission.status || "new",
  })));
}

export async function updateContactSubmissionStatus(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid inquiry id", 400);

  const parsed = z.object({
    status: z.enum(["new", "in-progress", "resolved"]),
  }).strict().safeParse(req.body);
  if (!parsed.success) return sendError(reply, "Invalid inquiry status", 400, parsed.error.flatten());

  const submission = await saveContactSubmissionStatus(id, parsed.data.status);
  if (!submission) return sendError(reply, "Contact inquiry not found", 404);
  return sendSuccess(reply, submission, "Inquiry status updated");
}

export async function deleteContactSubmission(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid inquiry id", 400);

  const deleted = await removeContactSubmission(id);
  if (!deleted) return sendError(reply, "Contact inquiry not found", 404);
  return sendSuccess(reply, { id }, "Inquiry deleted");
}