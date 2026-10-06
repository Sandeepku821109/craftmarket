import { query, withTransaction } from "../config/database";

export type PlatformType = "frontend" | "backend" | "fullstack" | "mobile-app";
export type SoftwareStatus = "pending" | "approved" | "rejected";

export interface ISoftware {
  _id: string;
  id: string;
  title: string;
  description: string;
  creator: string | { name: string; email?: string; mobile?: string; avatar?: string };
  images: string[];
  video: string;
  liveDemoUrl?: string;
  pdfDocument?: string;
  githubUsername: string;
  gitRepository: string;
  languages: string[];
  platformType: PlatformType;
  price: number;
  status: SoftwareStatus;
  totalSales: number;
  totalRevenue: number;
  createdAt: Date;
}

export interface CreateSoftwareInput {
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

export const SOFTWARE_FIELDS = `id AS "_id", id, title, description, creator_id AS creator,
  images, video, live_demo_url AS "liveDemoUrl", pdf_document AS "pdfDocument",
  github_username AS "githubUsername", git_repository AS "gitRepository", languages,
  platform_type AS "platformType", price::float8 AS price, status, total_sales AS "totalSales",
  total_revenue::float8 AS "totalRevenue", created_at AS "createdAt"`;
const SOFTWARE_JOIN_FIELDS = `s.id AS "_id", s.id, s.title, s.description,
  s.creator_id AS creator, s.images, s.video, s.live_demo_url AS "liveDemoUrl",
  s.pdf_document AS "pdfDocument", s.github_username AS "githubUsername",
  s.git_repository AS "gitRepository", s.languages, s.platform_type AS "platformType",
  s.price::float8 AS price, s.status, s.total_sales AS "totalSales",
  s.total_revenue::float8 AS "totalRevenue", s.created_at AS "createdAt"`;

export async function createSoftware(data: CreateSoftwareInput): Promise<ISoftware> {
  const result = await query<ISoftware>(
    `INSERT INTO software
      (title, description, creator_id, images, video, live_demo_url, pdf_document,
       github_username, git_repository, languages, platform_type, price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING ${SOFTWARE_FIELDS}`,
    [
      data.title, data.description, data.creator, data.images, data.video, data.liveDemoUrl,
      data.pdfDocument ?? null, data.githubUsername, data.gitRepository, data.languages,
      data.platformType, data.price,
    ]
  );
  return result.rows[0];
}

export async function findSoftwareById(id: string, approvedOnly = false): Promise<ISoftware | null> {
  const result = await query<ISoftware>(
    `SELECT ${SOFTWARE_FIELDS} FROM software WHERE id = $1 ${approvedOnly ? "AND status = 'approved'" : ""}`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function findOwnedSoftware(id: string, creatorId: string): Promise<ISoftware | null> {
  const result = await query<ISoftware>(
    `SELECT ${SOFTWARE_FIELDS} FROM software WHERE id = $1 AND creator_id = $2`,
    [id, creatorId]
  );
  return result.rows[0] ?? null;
}

export async function findPublicSoftwareById(id: string): Promise<ISoftware | null> {
  const result = await query<ISoftware>(
    `SELECT ${SOFTWARE_JOIN_FIELDS.replace("s.creator_id AS creator", "json_build_object('_id', u.id, 'id', u.id, 'name', u.name, 'avatar', u.avatar) AS creator")}
     FROM software s JOIN users u ON u.id = s.creator_id
     WHERE s.id = $1 AND s.status = 'approved'`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function updateSoftwareListing(
  id: string,
  creatorId: string,
  update: Partial<Pick<ISoftware, "title" | "description" | "price" | "gitRepository" | "liveDemoUrl">>
): Promise<ISoftware | null> {
  const fields = Object.entries(update).filter(([, value]) => value !== undefined);
  const setters = fields.map(([key], index) => `${({
    title: "title", description: "description", price: "price",
    gitRepository: "git_repository", liveDemoUrl: "live_demo_url",
  } as const)[key as keyof typeof update]} = $${index + 3}`);
  const values = fields.map(([, value]) => value);
  const result = await query<ISoftware>(
    `UPDATE software SET ${setters.join(", ")}, status = 'pending', updated_at = now()
     WHERE id = $1 AND creator_id = $2 RETURNING ${SOFTWARE_FIELDS}`,
    [id, creatorId, ...values]
  );
  return result.rows[0] ?? null;
}

export async function deleteOwnedSoftware(
  id: string,
  creatorId: string
): Promise<{ software: ISoftware | null; hasPaidOrders: boolean }> {
  return withTransaction(async (client) => {
    await client.query("SELECT id FROM orders WHERE software_id = $1 FOR UPDATE", [id]);
    const paid = await client.query(
      "SELECT 1 FROM orders WHERE software_id = $1 AND status = 'paid' LIMIT 1",
      [id]
    );
    if (paid.rowCount) return { software: null, hasPaidOrders: true };

    const software = await client.query<ISoftware>(
      `SELECT ${SOFTWARE_FIELDS} FROM software WHERE id = $1 AND creator_id = $2 FOR UPDATE`,
      [id, creatorId]
    );
    if (!software.rows[0]) return { software: null, hasPaidOrders: false };

    await client.query("DELETE FROM orders WHERE software_id = $1", [id]);
    const deleted = await client.query<ISoftware>(
      `DELETE FROM software WHERE id = $1 AND creator_id = $2 RETURNING ${SOFTWARE_FIELDS}`,
      [id, creatorId]
    );
    await client.query(
      "UPDATE users SET uploaded_software = array_remove(uploaded_software, $2), updated_at = now() WHERE id = $1",
      [creatorId, id]
    );
    return { software: deleted.rows[0] ?? null, hasPaidOrders: false };
  });
}

export async function updateSoftwareStatus(id: string, status: SoftwareStatus): Promise<ISoftware | null> {
  const result = await query<ISoftware>(
    `UPDATE software SET status = $2, updated_at = now() WHERE id = $1 RETURNING ${SOFTWARE_FIELDS}`,
    [id, status]
  );
  return result.rows[0] ?? null;
}

export async function countSoftware(): Promise<number> {
  const result = await query<{ count: string }>("SELECT count(*) FROM software");
  return Number(result.rows[0].count);
}

export async function listSoftwareByCreator(creatorId: string): Promise<ISoftware[]> {
  const result = await query<ISoftware>(
    `SELECT ${SOFTWARE_FIELDS} FROM software WHERE creator_id = $1 ORDER BY created_at DESC`,
    [creatorId]
  );
  return result.rows;
}

export async function listSoftwareForAdmin(): Promise<ISoftware[]> {
  const result = await query<ISoftware>(
    `SELECT ${SOFTWARE_JOIN_FIELDS.replace("s.creator_id AS creator", "json_build_object('_id', u.id, 'id', u.id, 'name', u.name, 'email', u.email, 'mobile', u.mobile) AS creator")}
     FROM software s JOIN users u ON u.id = s.creator_id ORDER BY s.created_at DESC`
  );
  return result.rows;
}

export async function searchSoftwareListings(options: {
  search?: string; platformType?: PlatformType; language?: string;
  minPrice?: number; maxPrice?: number; page: number; limit: number;
}): Promise<{ items: ISoftware[]; total: number }> {
  const conditions = ["s.status = 'approved'"];
  const values: unknown[] = [];
  if (options.search?.trim()) {
    values.push(options.search.trim());
    conditions.push(`(s.title ILIKE '%' || $${values.length} || '%' OR s.description ILIKE '%' || $${values.length} || '%')`);
  }
  if (options.platformType) {
    values.push(options.platformType);
    conditions.push(`s.platform_type = $${values.length}`);
  }
  if (options.language?.trim()) {
    values.push(options.language.trim());
    conditions.push(`$${values.length} = ANY(s.languages)`);
  }
  if (options.minPrice !== undefined) {
    values.push(options.minPrice);
    conditions.push(`s.price >= $${values.length}`);
  }
  if (options.maxPrice !== undefined) {
    values.push(options.maxPrice);
    conditions.push(`s.price <= $${values.length}`);
  }

  const where = conditions.join(" AND ");
  const count = await query<{ count: string }>(`SELECT count(*) FROM software s WHERE ${where}`, values);
  const pageValues = [...values, options.limit, (options.page - 1) * options.limit];
  const itemResult = await query<ISoftware>(
    `SELECT ${SOFTWARE_JOIN_FIELDS
      .replace("s.creator_id AS creator", "json_build_object('_id', u.id, 'id', u.id, 'name', u.name, 'avatar', u.avatar) AS creator")
      .replace(', s.git_repository AS "gitRepository"', "")}
     FROM software s JOIN users u ON u.id = s.creator_id
     WHERE ${where} ORDER BY s.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    pageValues
  );
  return { items: itemResult.rows, total: Number(count.rows[0].count) };
}
