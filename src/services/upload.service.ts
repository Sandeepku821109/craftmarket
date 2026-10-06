import cloudinary from "../config/cloudinary";
import { MultipartFile } from "@fastify/multipart";
import { randomUUID } from "node:crypto";

export function uploadToCloudinary(
  file: MultipartFile,
  resourceType: "image" | "video" | "raw" | "pdf" = "image",
  folder = "software-marketplace"
): Promise<string> {
  const allowedMimeTypes: Record<typeof resourceType, string> = {
    image: "image/",
    video: "video/",
    raw: "application/pdf",
    pdf: "application/pdf",
  };
  if (
    resourceType === "raw" || resourceType === "pdf"
      ? file.mimetype !== allowedMimeTypes[resourceType] || !/\.pdf$/i.test(file.filename)
      : !file.mimetype.startsWith(allowedMimeTypes[resourceType])
  ) {
    return Promise.reject(
      Object.assign(
        new Error(resourceType === "raw" || resourceType === "pdf" ? "Upload a valid PDF file with a .pdf extension" : `Invalid ${resourceType} file type`),
        { statusCode: 400 }
      )
    );
  }

  const cloudinaryResourceType = resourceType === "pdf" ? "image" : resourceType;

  return new Promise((resolve, reject) => {
    const options = resourceType === "pdf"
      ? { folder, resource_type: cloudinaryResourceType, public_id: randomUUID() }
      : resourceType === "raw"
        ? { folder, resource_type: cloudinaryResourceType, public_id: `${randomUUID()}.pdf` }
        : { folder, resource_type: cloudinaryResourceType };
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url) return reject(new Error("Cloudinary did not return an upload URL"));
        resolve(
          resourceType === "pdf" || resourceType === "raw"
            ? ensurePdfExtension(result.secure_url)
            : result.secure_url
        );
      }
    );
    file.file.pipe(uploadStream);
  });
}

export function ensurePdfExtension(value: string): string {
  const url = new URL(value);
  if (!url.pathname.toLowerCase().endsWith(".pdf")) url.pathname += ".pdf";
  return url.toString();
}