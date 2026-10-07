import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { countUsers, findUserById, listUsers, updateMemberRole } from "../models/User.model";
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
import { streamCloudinaryArchive, streamCloudinaryPdf } from "../services/pdf.service";

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

export async function updateUserRole(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid user id", 400);
  if (id === req.user!.id) return sendError(reply, "You cannot change your own administrator role", 403);

  const parsed = z.object({ role: z.enum(["buyer", "creator"]) }).strict().safeParse(req.body);
  if (!parsed.success) return sendError(reply, "Role must be buyer or creator", 400, parsed.error.flatten());

  const user = await updateMemberRole(id, parsed.data.role, req.user!.id);
  if (user) return sendSuccess(reply, user, "User role updated");

  const existing = await findUserById(id);
  if (!existing) return sendError(reply, "User not found", 404);
  return sendError(reply, "Administrator roles cannot be changed here", 403);
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

  return streamCloudinaryPdf(req, reply, software.pdfDocument, id);
}

export async function getSoftwareArchive(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);

  const software = await findSoftwareById(id);
  if (!software?.projectArchive) return sendError(reply, "Project archive not found", 404);

  return streamCloudinaryArchive(req, reply, software.projectArchive, `${id}-project`);
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
      json_build_object('_id', c.id, 'id', c.id, 'name', c.name, 'email', c.email,
        'payoutMethod', c.payout_method, 'paypalEmail', c.paypal_email, 'upiId', c.upi_id) AS creator,
      json_build_object('_id', s.id, 'id', s.id, 'title', s.title, 'price', s.price) AS software,
      o.amount::float8 AS amount, o.platform_fee::float8 AS "platformFee",
      o.creator_earning::float8 AS "creatorEarning", o.razorpay_order_id AS "razorpayOrderId",
      o.razorpay_payment_id AS "razorpayPaymentId", o.razorpay_signature AS "razorpaySignature",
      o.status, o.paid_at AS "paidAt", o.access_expires_at AS "accessExpiresAt",
      o.creator_payout_status AS "creatorPayoutStatus",
      o.creator_payout_reference AS "creatorPayoutReference",
      o.creator_payout_at AS "creatorPayoutAt",
      o.created_at AS "createdAt"
     FROM orders o JOIN users b ON b.id = o.buyer_id
     JOIN users c ON c.id = o.creator_id JOIN software s ON s.id = o.software_id
     ORDER BY o.created_at DESC`
  );
  return sendSuccess(reply, result.rows);
}

export async function markCreatorPayoutPaid(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid order id", 400);
  const parsed = z.object({
    reference: z.string().trim().min(1).max(200),
  }).strict().safeParse(req.body);
  if (!parsed.success) return sendError(reply, "A payout transfer reference is required", 400);

  const updated = await query(
    `UPDATE orders o
     SET creator_payout_status = 'paid', creator_payout_reference = $2,
         creator_payout_at = now(), updated_at = now()
     FROM users c
     WHERE o.id = $1 AND o.creator_id = c.id AND o.status = 'paid'
       AND o.creator_payout_status = 'pending'
       AND ((c.payout_method = 'paypal' AND c.paypal_email IS NOT NULL)
         OR (c.payout_method = 'upi' AND c.upi_id IS NOT NULL))
     RETURNING o.id AS "_id", o.creator_payout_status AS "creatorPayoutStatus",
       o.creator_payout_reference AS "creatorPayoutReference",
       o.creator_payout_at AS "creatorPayoutAt"`,
    [id, parsed.data.reference]
  );
  if (updated.rows[0]) return sendSuccess(reply, updated.rows[0], "Creator payout recorded");

  const existing = await query<{
    status: string;
    creatorPayoutStatus: string;
    hasPayoutDetails: boolean;
  }>(
    `SELECT o.status, o.creator_payout_status AS "creatorPayoutStatus",
       ((c.payout_method = 'paypal' AND c.paypal_email IS NOT NULL)
         OR (c.payout_method = 'upi' AND c.upi_id IS NOT NULL)) AS "hasPayoutDetails"
     FROM orders o JOIN users c ON c.id = o.creator_id WHERE o.id = $1`,
    [id]
  );
  const order = existing.rows[0];
  if (!order) return sendError(reply, "Order not found", 404);
  if (order.status !== "paid") return sendError(reply, "Only completed customer payments can be paid out", 409);
  if (order.creatorPayoutStatus === "paid") return sendError(reply, "Creator payout has already been recorded", 409);
  if (!order.hasPayoutDetails) return sendError(reply, "Creator has not saved valid payout details", 409);
  return sendError(reply, "Could not record creator payout", 409);
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