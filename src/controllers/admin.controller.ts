import { Readable } from "node:stream";
import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { UserModel } from "../models/User.model";
import { SoftwareModel } from "../models/Software.model";
import { OrderModel } from "../models/Order.model";
import { ENV } from "../config/env";
import { ContactSubmissionModel } from "../models/ContactSubmission.model";
import { z } from "zod";

export async function getDashboardStats(req: FastifyRequest, reply: FastifyReply) {
  const [totalUsers, totalCreators, totalBuyers, totalSoftware, totalOrders, revenueAgg] =
    await Promise.all([
      UserModel.countDocuments(),
      UserModel.countDocuments({ role: "creator" }),
      UserModel.countDocuments({ role: "buyer" }),
      SoftwareModel.countDocuments(),
      OrderModel.countDocuments({ status: "paid" }),
      OrderModel.aggregate([
        { $match: { status: "paid" } },
        { $group: { _id: null, totalRevenue: { $sum: "$amount" }, platformEarnings: { $sum: "$platformFee" } } },
      ]),
    ]);

  return sendSuccess(reply, {
    totalUsers,
    totalCreators,
    totalBuyers,
    totalSoftware,
    totalOrders,
    totalRevenue: revenueAgg[0]?.totalRevenue || 0,
    platformEarnings: revenueAgg[0]?.platformEarnings || 0,
  });
}

export async function getAllUsers(req: FastifyRequest, reply: FastifyReply) {
  const users = await UserModel.find().select("-refreshToken");
  return sendSuccess(reply, users);
}

export async function getAllSoftware(req: FastifyRequest, reply: FastifyReply) {
  const software = await SoftwareModel.find().populate("creator", "name email mobile");
  return sendSuccess(reply, software);
}

export async function getSoftwarePdf(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);

  const software = await SoftwareModel.findById(id).select("pdfDocument").lean();
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
  const software = await SoftwareModel.findByIdAndUpdate(id, { status: "approved" }, { new: true });
  if (!software) return sendError(reply, "Software not found", 404);
  return sendSuccess(reply, software, "Software approved");
}

export async function rejectSoftware(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const software = await SoftwareModel.findByIdAndUpdate(id, { status: "rejected" }, { new: true });
  if (!software) return sendError(reply, "Software not found", 404);
  return sendSuccess(reply, software, "Software rejected");
}

export async function getCreatorEarnings(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  const creator = await UserModel.findById(id).select("name email totalEarnings");
  const orders = await OrderModel.find({ creator: id, status: "paid" }).populate("software", "title");
  return sendSuccess(reply, { creator, orders });
}

export async function getAllOrders(req: FastifyRequest, reply: FastifyReply) {
  const orders = await OrderModel.find()
    .populate("buyer", "name email")
    .populate("creator", "name email")
    .populate("software", "title price");
  return sendSuccess(reply, orders);
}

export async function getContactSubmissions(req: FastifyRequest, reply: FastifyReply) {
  const submissions = await ContactSubmissionModel.find().sort({ createdAt: -1 }).lean();
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

  const submission = await ContactSubmissionModel.findByIdAndUpdate(
    id,
    { status: parsed.data.status },
    { new: true, runValidators: true }
  );
  if (!submission) return sendError(reply, "Contact inquiry not found", 404);
  return sendSuccess(reply, submission, "Inquiry status updated");
}

export async function deleteContactSubmission(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid inquiry id", 400);

  const submission = await ContactSubmissionModel.findByIdAndDelete(id);
  if (!submission) return sendError(reply, "Contact inquiry not found", 404);
  return sendSuccess(reply, { id }, "Inquiry deleted");
}