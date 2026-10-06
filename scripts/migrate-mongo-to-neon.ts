import "dotenv/config";
import { Pool } from "pg";
import { MongoClient, type Document } from "mongodb";
import { DATABASE_SCHEMA } from "../src/config/schema";

type LegacyDocument = Document & { _id: { toHexString?: () => string } | string };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in backend/.env before running the migration`);
  return value;
}

function legacyId(value: unknown): string {
  if (typeof value === "object" && value !== null && "toHexString" in value &&
      typeof value.toHexString === "function") {
    return value.toHexString();
  }
  if (typeof value === "string" && /^[a-f\d]{24}$/i.test(value)) return value;
  throw new Error("A MongoDB document or reference has an invalid ObjectId");
}

function asDate(value: unknown, fallback = new Date()): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return fallback;
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function migrateCollection(
  source: MongoClient,
  target: Pool,
  collectionName: string,
  columns: string[],
  mapDocument: (document: LegacyDocument) => unknown[]
): Promise<number> {
  const cursor = source.db().collection<LegacyDocument>(collectionName).find();
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const insert = `INSERT INTO ${collectionName === "contactsubmissions" ? "contact_submissions" : collectionName}
    (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`;
  let count = 0;

  for await (const document of cursor) {
    await target.query(insert, mapDocument(document));
    count += 1;
  }
  console.log(`Processed ${count} ${collectionName} records`);
  return count;
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGO_SOURCE_URI?.trim() || process.env.MONGO_URI?.trim();
  if (!mongoUri) throw new Error("Set MONGO_SOURCE_URI to the source MongoDB URL before running the migration");

  const source = new MongoClient(mongoUri);
  const target = new Pool({ connectionString: required("DATABASE_URL"), ssl: { rejectUnauthorized: true } });
  try {
    await source.connect();
    await target.query(DATABASE_SCHEMA);

    await migrateCollection(source, target, "users", [
      "id", "name", "email", "mobile", "role", "is_verified", "avatar",
      "uploaded_software", "purchased_software", "total_earnings", "refresh_token", "created_at", "updated_at",
    ], (doc) => [
      legacyId(doc._id), doc.name, String(doc.email).toLowerCase(), doc.mobile, doc.role ?? "buyer",
      doc.isVerified ?? false, doc.avatar ?? null, asTextArray(doc.uploadedSoftware).map(legacyId),
      asTextArray(doc.purchasedSoftware).map(legacyId), asNumber(doc.totalEarnings), doc.refreshToken ?? null,
      asDate(doc.createdAt), asDate(doc.updatedAt, asDate(doc.createdAt)),
    ]);

    await migrateCollection(source, target, "software", [
      "id", "title", "description", "creator_id", "images", "video", "live_demo_url", "pdf_document",
      "github_username", "git_repository", "languages", "platform_type", "price", "status",
      "total_sales", "total_revenue", "created_at", "updated_at",
    ], (doc) => [
      legacyId(doc._id), doc.title, doc.description, legacyId(doc.creator), asTextArray(doc.images), doc.video,
      doc.liveDemoUrl ?? null, doc.pdfDocument ?? null, doc.githubUsername ?? "", doc.gitRepository,
      asTextArray(doc.languages), doc.platformType, asNumber(doc.price), doc.status ?? "pending",
      asNumber(doc.totalSales), asNumber(doc.totalRevenue), asDate(doc.createdAt), asDate(doc.updatedAt, asDate(doc.createdAt)),
    ]);

    await migrateCollection(source, target, "orders", [
      "id", "buyer_id", "software_id", "creator_id", "amount", "platform_fee", "creator_earning",
      "razorpay_order_id", "razorpay_payment_id", "razorpay_signature", "status", "paid_at",
      "access_expires_at", "created_at", "updated_at",
    ], (doc) => [
      legacyId(doc._id), legacyId(doc.buyer), legacyId(doc.software), legacyId(doc.creator),
      asNumber(doc.amount), asNumber(doc.platformFee), asNumber(doc.creatorEarning), doc.razorpayOrderId,
      doc.razorpayPaymentId ?? null, doc.razorpaySignature ?? null, doc.status ?? "created",
      doc.paidAt ? asDate(doc.paidAt) : null, doc.accessExpiresAt ? asDate(doc.accessExpiresAt) : null,
      asDate(doc.createdAt), asDate(doc.updatedAt, asDate(doc.createdAt)),
    ]);

    await migrateCollection(source, target, "earnings", [
      "id", "order_id", "buyer_id", "creator_id", "software_id", "amount", "platform_fee",
      "creator_earning", "created_at",
    ], (doc) => [
      legacyId(doc._id), legacyId(doc.order), legacyId(doc.buyer), legacyId(doc.creator),
      legacyId(doc.software), asNumber(doc.amount), asNumber(doc.platformFee),
      asNumber(doc.creatorEarning), asDate(doc.createdAt),
    ]);

    await migrateCollection(source, target, "otps", [
      "id", "identifier", "otp", "purpose", "expires_at", "last_sent_at", "attempts",
    ], (doc) => [
      legacyId(doc._id), doc.identifier, doc.otp, doc.purpose, asDate(doc.expiresAt),
      doc.lastSentAt ? asDate(doc.lastSentAt) : null, asNumber(doc.attempts),
    ]);

    await migrateCollection(source, target, "contactsubmissions", [
      "id", "name", "phone", "email", "subject", "query", "status", "created_at", "updated_at",
    ], (doc) => [
      legacyId(doc._id), doc.name, doc.phone, String(doc.email).toLowerCase(), doc.subject,
      doc.query, doc.status ?? "new", asDate(doc.createdAt), asDate(doc.updatedAt, asDate(doc.createdAt)),
    ]);

    console.log("MongoDB-to-Neon data migration completed. Verify row counts before switching application traffic.");
  } finally {
    await Promise.allSettled([source.close(), target.end()]);
  }
}

void main().catch((error: unknown) => {
  console.error("MongoDB-to-Neon migration failed:", error);
  process.exitCode = 1;
});
