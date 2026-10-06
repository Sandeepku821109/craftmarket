import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { uploadToCloudinary } from "../services/upload.service";
import { createSoftware } from "../services/software.service";
import {
  addUploadedSoftware,
  findUserById,
} from "../models/User.model";
import {
  deleteOwnedSoftware,
  findOwnedSoftware,
  listSoftwareByCreator,
  updateSoftwareListing,
} from "../models/Software.model";
import { verifyPublicGitHubRepository } from "../services/github.service";
import { z } from "zod";

export async function uploadSoftware(req: FastifyRequest, reply: FastifyReply) {
  const parts = req.parts();

  const images: string[] = [];
  let video = "";
  let pdfDocument: string | undefined;
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
        pdfDocument = await uploadToCloudinary(part, "pdf");
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
  return sendSuccess(reply, { totalEarnings: user?.totalEarnings, software });
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

export async function deleteSoftware(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (!/^[a-f\d]{24}$/i.test(id)) return sendError(reply, "Invalid software id", 400);
  const result = await deleteOwnedSoftware(id, req.user!.id);
  if (result.hasPaidOrders) return sendError(reply, "Software with completed purchases cannot be deleted", 409);
  const software = result.software;
  if (!software) return sendError(reply, "Software not found", 404);
  return sendSuccess(reply, null, "Deleted successfully");
}