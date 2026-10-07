import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ENV } from "../config/env";
import { sendError } from "../utils/apiResponse";

export async function streamCloudinaryPdf(
  req: FastifyRequest,
  reply: FastifyReply,
  storedUrl: string,
  filename: string
) {
  return streamCloudinaryAsset(req, reply, storedUrl, filename, {
    extension: "pdf",
    contentType: "application/pdf",
    disposition: "inline",
    label: "Product PDF",
  });
}

export async function streamCloudinaryArchive(
  req: FastifyRequest,
  reply: FastifyReply,
  storedUrl: string,
  filename: string
) {
  return streamCloudinaryAsset(req, reply, storedUrl, filename, {
    extension: "zip",
    contentType: "application/zip",
    disposition: "attachment",
    label: "Project archive",
  });
}

async function streamCloudinaryAsset(
  req: FastifyRequest,
  reply: FastifyReply,
  storedUrl: string,
  filename: string,
  options: { extension: "pdf" | "zip"; contentType: string; disposition: "inline" | "attachment"; label: string }
) {
  let assetUrl: URL;
  try {
    assetUrl = new URL(storedUrl);
  } catch {
    return sendError(reply, `${options.label} URL is invalid`, 502);
  }

  const cloudName = encodeURIComponent(ENV.CLOUDINARY_CLOUD_NAME);
  const cloudinaryPath = new RegExp(`^/${cloudName}/(?:raw|image)/upload/`);
  if (
    assetUrl.protocol !== "https:" ||
    assetUrl.hostname !== "res.cloudinary.com" ||
    assetUrl.username ||
    assetUrl.password ||
    assetUrl.port ||
    !cloudinaryPath.test(assetUrl.pathname)
  ) {
    return sendError(reply, `${options.label} URL is not a valid Cloudinary asset`, 502);
  }

  const requestHeaders: HeadersInit = {};
  if (typeof req.headers.range === "string") requestHeaders.Range = req.headers.range;

  let upstream: Response;
  try {
    upstream = await fetch(assetUrl, { headers: requestHeaders });
  } catch {
    return sendError(reply, `Could not connect to Cloudinary to load the ${options.label.toLowerCase()}`, 502);
  }

  const body = upstream.body;
  if ((upstream.status !== 200 && upstream.status !== 206) || !body) {
    return sendError(
      reply,
      `Cloudinary could not load the ${options.label.toLowerCase()} (HTTP ${upstream.status}).`,
      502
    );
  }

  reply
    .code(upstream.status)
    .header("content-type", options.contentType)
    .header("content-disposition", `${options.disposition}; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}.${options.extension}"`)
    .header("accept-ranges", "bytes")
    .header("cache-control", "private, no-store")
    .header("content-security-policy", `frame-ancestors ${ENV.CORS_ORIGINS.join(" ")}`);
  const contentLength = upstream.headers.get("content-length");
  const contentRange = upstream.headers.get("content-range");
  if (contentLength) reply.header("content-length", contentLength);
  if (contentRange) reply.header("content-range", contentRange);

  const assetStream = Readable.from((async function* () {
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
  return reply.send(assetStream);
}
