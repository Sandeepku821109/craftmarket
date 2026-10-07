import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { query } from "../config/database";
import { uploadToCloudinary } from "../services/upload.service";
import { createSoftware } from "../services/software.service";
import {
  addUploadedSoftware,
  getCreatorPayoutDetails,
  findUserById,
  saveCreatorPayoutDetails,
} from "../models/User.model";
import {
  deleteOwnedSoftware,
  findOwnedSoftware,
  listSoftwareByCreator,
  replaceOwnedSoftwarePdf,
  updateSoftwareListing,
} from "../models/Software.model";
import { verifyPublicGitHubRepository } from "../services/github.service";
import { z } from "zod";

export async function uploadSoftware(req: FastifyRequest, reply: FastifyReply) {
  const parts = req.parts();

  const images: string[] = [];
  let video = "";
  let pdfDocument: string | undefined;
  let projectArchive: string | undefined;
  const fields = Object.create(null) as Record<string, string>;

  for await (const part of parts) {
    if (part.type === "file") {
      if (part.fieldname === "images") {
        if (images.length >= 8) return sendError(reply, "At most 8 images are allowed", 400);
        const url = await uploadToCloudinary(part, "image");
        images.push(url);
      } else if (part.fieldname === "video") {
        if (video) return sendError(reply, "Only one demo video is allowed", 400);
        video = await uploadToCloudinary(part, "video");
      } else if (part.fieldname === "pdf") {
        if (pdfDocument) return sendError(reply, "Only one PDF is allowed", 400);
        pdfDocument = await uploadToCloudinary(part, "raw");
      } else if (part.fieldname === "projectArchive") {
        if (projectArchive) return sendError(reply, "Only one project archive is allowed", 400);
        projectArchive = await uploadToCloudinary(part, "zip");
      } else {
        return sendError(reply, `Unexpected file field: ${part.fieldname}`, 400);
      }
    } else {
      if (!(part.fieldname in fields)) {
        if (typeof part.value !== "string") {
          return sendError(reply, `Invalid field value: ${part.fieldname}`, 400);
        }
        fields[part.fieldname] = part.value;
      } else {
        return sendError(reply, `Duplicate field: ${part.fieldname}`, 400);
      }
    }
  }

  if (!projectArchive) {
    return sendError(reply, "A project folder ZIP archive is required", 400);
  }
  if (!pdfDocument) {
    return sendError(reply, "A product guide PDF is required", 400);
  }

  const parsed = z.object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(10_000),
    githubUsername: z.string().trim().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i, "Enter a valid GitHub username"),
    gitRepository: z.string().trim().min(1).max(300),
    liveDemoUrl: z.string().url().refine((value) => value.startsWith("https://")),
    languages: z.string().min(1).max(500),
    platformType: z.enum(["frontend", "backend", "fullstack", "mobile-app"]),
    price: z.coerce.number().finite().positive().max(10_000_000),
  }).strict().safeParse(fields);
  if (!parsed.success) return sendError(reply, "Invalid software details", 400, parsed.error.flatten());
  const verifiedRepository = await verifyPublicGitHubRepository(
    parsed.data.gitRepository,
    parsed.data.githubUsername
  );
  if (images.length < 2) return sendError(reply, "At least 2 images are required", 400);
  if (!video) return sendError(reply, "A demo video is required", 400);
  const languages = parsed.data.languages
    .split(",")
    .map((language) => language.trim())
    .filter(Boolean);
  if (languages.length === 0 || languages.some((language) => language.length > 50)) {
    return sendError(reply, "At least one valid language is required", 400);
  }

  const software = await createSoftware({
    title: parsed.data.title,
    description: parsed.data.description,
    creator: req.user!.id,
    images,
    video,
    liveDemoUrl: parsed.data.liveDemoUrl,
    pdfDocument,
    projectArchive,
    githubUsername: parsed.data.githubUsername,
    gitRepository: verifiedRepository,
    languages,
    platformType: parsed.data.platformType,
    price: parsed.data.price,
  });

  await addUploadedSoftware(req.user!.id, software._id);

  return sendSuccess(reply, software, "Software submitted for review", 201);
}

export async function getMySoftware(req: FastifyRequest, reply: FastifyReply) {
  const list = await listSoftwareByCreator(req.user!.id);
  return sendSuccess(reply, list);
}

export async function getMyEarnings(req: FastifyRequest, reply: FastifyReply) {
  const user = await findUserById(req.user!.id);
  const software = await listSoftwareByCreator(req.user!.id);
  const payoutSummary = await queryCreatorPayoutSummary(req.user!.id);
  return sendSuccess(reply, { totalEarnings: user?.totalEarnings, software, ...payoutSummary });
}

async function queryCreatorPayoutSummary(creatorId: string) {
  const result = await query<{ pendingPayout: number; paidOut: number }>(
    `SELECT COALESCE(sum(creator_earning) FILTER (WHERE creator_payout_status = 'pending'), 0)::float8 AS "pendingPayout",
      COALESCE(sum(creator_earning) FILTER (WHERE creator_payout_status = 'paid'), 0)::float8 AS "paidOut"
     FROM orders WHERE creator_id = $1 AND status = 'paid'`,
    [creatorId]
  );
  return result.rows[0];
}

export async function getMyPayoutDetails(req: FastifyRequest, reply: FastifyReply) {
  const details = await getCreatorPayoutDetails(req.user!.id);
  if (!details) return sendError(reply, "Creator account not found", 404);
  return sendSuccess(reply, details);
}

export async function updateMyPayoutDetails(req: FastifyRequest, reply: FastifyReply) {
  const parsed = z.discriminatedUnion("payoutMethod", [
    z.object({
      payoutMethod: z.literal("paypal"),
      paypalEmail: z.string().trim().email().max(254),
    }).strict(),
    z.object({
      payoutMethod: z.literal("upi"),
      upiId: z.string().trim().min(3).max(255)
        .regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/, "Enter a valid UPI ID"),
    }).strict(),
  ]).safeParse(req.body);
  if (!parsed.success) return sendError(reply, "Enter a valid PayPal email or UPI ID", 400, parsed.error.flatten());

  const details = await saveCreatorPayoutDetails(req.user!.id, parsed.data);
  if (!details) return sendError(reply, "Creator account not found", 404);
  return sendSuccess(reply, details, "Payout details saved");
}

export async function updateSoftware(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);
  const software = await findOwnedSoftware(id, req.user!.id);
  if (!software) return sendError(reply, "Software not found", 404);

  const parsed = z.object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().min(10).max(10_000).optional(),
    price: z.number().finite().positive().max(10_000_000).optional(),
    gitRepository: z.string().trim().min(1).max(300).optional(),
    liveDemoUrl: z.string().url().refine((value) => value.startsWith("https://")).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0).safeParse(req.body);
  if (!parsed.success) return sendError(reply, "Invalid software update", 400, parsed.error.flatten());

  const update = { ...parsed.data };
  if (update.gitRepository) {
    if (!software.githubUsername) {
      return sendError(reply, "This older listing has no saved GitHub username. Add a new listing to verify its repository.", 409);
    }
    update.gitRepository = await verifyPublicGitHubRepository(update.gitRepository, software.githubUsername);
  }
  const updated = await updateSoftwareListing(id, req.user!.id, update);
  if (!updated) return sendError(reply, "Software not found", 404);

  return sendSuccess(reply, updated, "Updated successfully");
}

export async function replaceSoftwarePdf(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);
  const software = await findOwnedSoftware(id, req.user!.id);
  if (!software) return sendError(reply, "Software not found", 404);

  let pdfDocument: string | undefined;
  for await (const part of req.parts()) {
    if (part.type !== "file" || part.fieldname !== "pdf") {
      return sendError(reply, "Upload exactly one PDF file using the pdf field", 400);
    }
    if (pdfDocument) return sendError(reply, "Only one PDF is allowed", 400);
    pdfDocument = await uploadToCloudinary(part, "raw");
  }
  if (!pdfDocument) return sendError(reply, "Select a PDF file to replace the product guide", 400);

  const updated = await replaceOwnedSoftwarePdf(id, req.user!.id, pdfDocument);
  if (!updated) return sendError(reply, "Software not found", 404);
  return sendSuccess(reply, updated, "Product guide replaced and listing sent for review");
}

export async function deleteSoftware(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);
  const result = await deleteOwnedSoftware(id, req.user!.id);
  if (result.hasPaidOrders) return sendError(reply, "Software with completed purchases cannot be deleted", 409);
  const software = result.software;
  if (!software) return sendError(reply, "Software not found", 404);
  return sendSuccess(reply, null, "Deleted successfully");
}