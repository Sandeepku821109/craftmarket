import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { configureTestEnvironment } from "./testEnvironment";

configureTestEnvironment();

test("OTP generator always returns a six-digit code", async () => {
  const { generateOtp, otpExpiry } = await import("../src/utils/otp.util");
  for (let index = 0; index < 100; index += 1) {
    assert.match(generateOtp(), /^\d{6}$/);
  }

  const now = Date.now();
  const expiry = otpExpiry(5);
  assert.ok(expiry.getTime() >= now + 5 * 60_000);
  assert.ok(expiry.getTime() <= Date.now() + 5 * 60_000 + 100);
});

test("JWT access tokens round-trip and reject tampering", async () => {
  const { generateAccessToken, verifyAccessToken } = await import("../src/utils/jwt.util");
  const payload = { id: "507f1f77bcf86cd799439011", role: "buyer" as const };
  const token = generateAccessToken(payload);
  assert.deepEqual(verifyAccessToken(token), payload);
  assert.throws(() => verifyAccessToken(`${token}x`));
});

test("payment signature verification accepts only the matching HMAC", async () => {
  const { ENV } = await import("../src/config/env");
  const { verifyRazorpaySignature } = await import("../src/services/payment.service");
  const orderId = "order_test_123";
  const paymentId = "pay_test_456";
  const signature = createHmac("sha256", ENV.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  assert.equal(verifyRazorpaySignature(orderId, paymentId, signature), true);
  assert.equal(verifyRazorpaySignature(orderId, paymentId, "0".repeat(64)), false);
  assert.equal(verifyRazorpaySignature(orderId, paymentId, "invalid"), false);
  assert.equal(verifyRazorpaySignature("another-order", paymentId, signature), false);
});

test("new sale split reserves 70 percent for creator payout", async () => {
  const { ENV } = await import("../src/config/env");
  const { splitOrderAmount } = await import("../src/services/payment.service");

  assert.equal(ENV.PLATFORM_COMMISSION_PERCENT, 30);
  assert.deepEqual(splitOrderAmount(100_00), {
    platformFeeInPaise: 30_00,
    creatorEarningInPaise: 70_00,
  });
});

test("project access expires six calendar months after payment", async () => {
  const { addCalendarMonths, getPurchaseAccessExpiry } = await import("../src/services/payment.service");

  assert.equal(
    addCalendarMonths(new Date("2026-10-06T10:15:30.000Z"), 6).toISOString(),
    "2027-04-06T10:15:30.000Z",
  );
  assert.equal(
    addCalendarMonths(new Date("2026-08-31T10:15:30.000Z"), 6).toISOString(),
    "2027-02-28T10:15:30.000Z",
  );
  assert.equal(
    getPurchaseAccessExpiry({
      paidAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2025-12-31T00:00:00.000Z"),
    }).toISOString(),
    "2026-07-01T00:00:00.000Z",
  );
});

test("Cloudinary PDF delivery URLs retain a .pdf extension", async () => {
  const { ensurePdfExtension, ensureZipExtension } = await import("../src/services/upload.service");

  assert.equal(
    ensurePdfExtension("https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide?x=1"),
    "https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide.pdf?x=1",
  );
  assert.equal(
    ensurePdfExtension("https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide.pdf"),
    "https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide.pdf",
  );
  assert.equal(
    ensurePdfExtension("https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide"),
    "https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide.pdf",
  );
  assert.equal(
    ensureZipExtension("https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/project"),
    "https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/project.zip",
  );
  assert.equal(
    ensureZipExtension("https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/project.zip"),
    "https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/project.zip",
  );
});

test("GitHub repository archive fallback accepts only the saved public owner repository URL", async () => {
  const { validateGitHubRepositoryUrl } = await import("../src/services/github.service");
  assert.deepEqual(
    validateGitHubRepositoryUrl("https://github.com/example/project", "example"),
    {
      owner: "example",
      repository: "project",
      canonicalUrl: "https://github.com/example/project",
    }
  );
  assert.throws(
    () => validateGitHubRepositoryUrl("https://example.com/example/project", "example"),
    /GitHub repository URL/
  );
});

test("PostgreSQL schema preserves marketplace constraints and lifecycle enums", async () => {
  const { DATABASE_SCHEMA } = await import("../src/config/schema");
  assert.match(DATABASE_SCHEMA, /email varchar\(254\) NOT NULL UNIQUE/);
  assert.match(DATABASE_SCHEMA, /cardinality\(images\) >= 2/);
  assert.match(DATABASE_SCHEMA, /project_archive text/);
  assert.match(DATABASE_SCHEMA, /ADD COLUMN IF NOT EXISTS project_archive text/);
  assert.match(DATABASE_SCHEMA, /platform_type IN \('frontend', 'backend', 'fullstack', 'mobile-app'\)/);
  assert.match(DATABASE_SCHEMA, /status IN \('created', 'paid', 'failed'\)/);
  assert.match(DATABASE_SCHEMA, /creator_payout_status text NOT NULL DEFAULT 'pending'/);
  assert.match(DATABASE_SCHEMA, /ADD COLUMN IF NOT EXISTS payout_method/);
  assert.match(DATABASE_SCHEMA, /ADD COLUMN IF NOT EXISTS creator_payout_reference/);
  assert.match(DATABASE_SCHEMA, /users_payout_method_check/);
  assert.match(DATABASE_SCHEMA, /orders_creator_payout_status_check/);
  assert.match(DATABASE_SCHEMA, /UNIQUE \(identifier, purpose\)/);
  assert.match(DATABASE_SCHEMA, /status IN \('new', 'in-progress', 'resolved'\)/);
});

test("public marketplace software projection never exposes uploaded file URLs or private repositories", async () => {
  const { PUBLIC_SOFTWARE_JOIN_FIELDS } = await import("../src/models/Software.model");
  assert.doesNotMatch(PUBLIC_SOFTWARE_JOIN_FIELDS, /pdf_document|pdfDocument/i);
  assert.doesNotMatch(PUBLIC_SOFTWARE_JOIN_FIELDS, /project_archive|projectArchive/i);
  assert.doesNotMatch(PUBLIC_SOFTWARE_JOIN_FIELDS, /git_repository|gitRepository/i);
});
