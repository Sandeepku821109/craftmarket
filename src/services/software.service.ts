import {
  createSoftware as insertSoftware,
  searchSoftwareListings,
  type ISoftware,
  type PlatformType,
} from "../models/Software.model";

export interface CreateSoftwareData {
  title: string;
  description: string;
  creator: string;
  images: string[];
  video: string;
  liveDemoUrl: string;
  pdfDocument?: string;
  projectArchive?: string;
  githubUsername: string;
  gitRepository: string;
  languages: string[];
  platformType: PlatformType;
  price: number;
}

export async function createSoftware(data: CreateSoftwareData): Promise<ISoftware> {
  return insertSoftware(data);
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
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const { items, total } = await searchSoftwareListings({ ...query, page, limit });

  return { items, total, page, pages: Math.ceil(total / limit) };
}