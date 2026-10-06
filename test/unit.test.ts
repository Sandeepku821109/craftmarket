import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { Types } from "mongoose";
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
  const { ensurePdfExtension } = await import("../src/services/upload.service");

  assert.equal(
    ensurePdfExtension("https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide?x=1"),
    "https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide.pdf?x=1",
  );
  assert.equal(
    ensurePdfExtension("https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide.pdf"),
    "https://res.cloudinary.com/example/raw/upload/v123/software-marketplace/guide.pdf",
  );
});

test("software schema enforces required listing fields and HTTPS demo URLs", async () => {
  const { SoftwareModel } = await import("../src/models/Software.model");
  const creator = new Types.ObjectId();
  const valid = new SoftwareModel({
    title: "Test listing",
    description: "A test listing description long enough.",
    creator,
    images: ["one", "two"],
    video: "demo",
    liveDemoUrl: "https://example.test",
    githubUsername: "test-user",
    gitRepository: "test-user/test-repository",
    languages: ["TypeScript"],
    platformType: "backend",
    price: 100,
  });
  assert.equal(valid.validateSync(), undefined);

  const invalidUrl = new SoftwareModel({
    ...valid.toObject(),
    liveDemoUrl: "http://example.test",
  });
  assert.ok(invalidUrl.validateSync()?.errors.liveDemoUrl);

  const missingImage = new SoftwareModel({
    ...valid.toObject(),
    images: ["one"],
  });
  assert.ok(missingImage.validateSync()?.errors.images);
});

test("contact submission schema validates and trims saved queries", async () => {
  const { ContactSubmissionModel } = await import("../src/models/ContactSubmission.model");
  const submission = new ContactSubmissionModel({
    name: "  Alex Morgan  ",
    phone: "+1 555 123 4567",
    email: "ALEX@example.test",
    subject: "General question",
    query: "  I have a question about the marketplace.  ",
  });
  assert.equal(submission.validateSync(), undefined);
  assert.equal(submission.name, "Alex Morgan");
  assert.equal(submission.query, "I have a question about the marketplace.");
  assert.equal(submission.status, "new");

  submission.subject = "Invalid subject";
  assert.ok(submission.validateSync()?.errors.subject);
  submission.subject = "General question";
  submission.set("status", "archived");
  assert.ok(submission.validateSync()?.errors.status);
});

test("order schema restricts valid payment lifecycle states", async () => {
  const { OrderModel } = await import("../src/models/Order.model");
  const order = new OrderModel({
    buyer: new Types.ObjectId(),
    software: new Types.ObjectId(),
    creator: new Types.ObjectId(),
    amount: 100,
    platformFee: 20,
    creatorEarning: 80,
    razorpayOrderId: "order_test",
    status: "paid",
  });
  assert.equal(order.validateSync(), undefined);

  order.set("status", "refunded");
  assert.ok(order.validateSync()?.errors.status);
});
