import { ISoftware, PlatformType, SoftwareModel } from "../models/Software.model";

export interface CreateSoftwareData {
  title: string;
  description: string;
  creator: string;
  images: string[];
  video: string;
  liveDemoUrl: string;
  pdfDocument?: string;
  githubUsername: string;
  gitRepository: string;
  languages: string[];
  platformType: PlatformType;
  price: number;
}

export async function createSoftware(data: CreateSoftwareData): Promise<ISoftware> {
  return SoftwareModel.create(data);
}

export async function searchSoftware(query: {
  search?: string;
  platformType?: PlatformType;
  language?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
}) {
  const filter: Record<string, unknown> = { status: "approved" };

  if (query.search?.trim()) {
    filter.$text = { $search: query.search };
  }
  if (query.platformType) filter.platformType = query.platformType;
  if (query.language?.trim()) filter.languages = query.language.trim();
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const price: { $gte?: number; $lte?: number } = {};
    if (query.minPrice !== undefined) price.$gte = query.minPrice;
    if (query.maxPrice !== undefined) price.$lte = query.maxPrice;
    filter.price = price;
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 10;

  const [items, total] = await Promise.all([
    SoftwareModel.find(filter)
      .select("-gitRepository")
      .populate("creator", "name avatar")
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 }),
    SoftwareModel.countDocuments(filter),
  ]);

  return { items, total, page, pages: Math.ceil(total / limit) };
}