import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawnSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { configureTestEnvironment } from "./testEnvironment";

let app: FastifyInstance;

before(async () => {
  configureTestEnvironment();
  const { buildApp } = await import("../src/app");
  app = await buildApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

test("health endpoint reports the process is alive and sends security headers", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "ok");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
});

test("readiness fails until the required PostgreSQL connection is established", async () => {
  const response = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().status, "not_ready");
  assert.equal(response.json().checks.database, false);
  assert.equal(response.json().checks.redis, true);
  assert.equal(response.json().checks.rabbitmq, true);
});

test("CORS allows configured origins but does not grant an unconfigured origin", async () => {
  const allowed = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "http://localhost:3000" },
  });
  const denied = await app.inject({
    method: "GET",
    url: "/health",
    headers: { origin: "https://untrusted.example" },
  });
  assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:3000");
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});

test("invalid signup input is rejected before database or email access", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/signup/request-otp",
    payload: { email: "not-an-email", mobile: "123" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().success, false);
});

test("invalid browsing parameters are rejected before database access", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/buyer/software?page=0",
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().success, false);
});

test("buyer purchase routes require authentication", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/buyer/purchases",
  });
  assert.equal(response.statusCode, 401);
});

test("admin product PDF streaming route requires authentication", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/software/507f1f77bcf86cd799439011/pdf",
  });
  assert.equal(response.statusCode, 401);
});

test("admin contact inquiries route requires authentication", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/contact-submissions",
  });
  assert.equal(response.statusCode, 401);
});

test("admin inquiry mutations require authentication", async () => {
  const [updateResponse, deleteResponse] = await Promise.all([
    app.inject({
      method: "PATCH",
      url: "/api/admin/contact-submissions/507f1f77bcf86cd799439011",
      payload: { status: "resolved" },
    }),
    app.inject({
      method: "DELETE",
      url: "/api/admin/contact-submissions/507f1f77bcf86cd799439011",
    }),
  ]);
  assert.equal(updateResponse.statusCode, 401);
  assert.equal(deleteResponse.statusCode, 401);
});

test("admin inquiry status endpoint rejects invalid statuses", async () => {
  const { generateAccessToken } = await import("../src/utils/jwt.util");
  const token = generateAccessToken({
    id: "507f1f77bcf86cd799439011",
    role: "admin",
  });
  const response = await app.inject({
    method: "PATCH",
    url: "/api/admin/contact-submissions/507f1f77bcf86cd799439011",
    headers: { cookie: `accessToken=${token}` },
    payload: { status: "archived" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, "Invalid inquiry status");
});

test("admin product PDF streaming route validates listing ids", async () => {
  const { generateAccessToken } = await import("../src/utils/jwt.util");
  const token = generateAccessToken({
    id: "507f1f77bcf86cd799439011",
    role: "admin",
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/software/not-an-id/pdf",
    headers: { cookie: `accessToken=${token}` },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, "Invalid software id");
});

test("creator routes reject an authenticated buyer", async () => {
  const { generateAccessToken } = await import("../src/utils/jwt.util");
  const token = generateAccessToken({
    id: "507f1f77bcf86cd799439011",
    role: "buyer",
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/creator/software",
    headers: { cookie: `accessToken=${token}` },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().message, "Access denied");
});

test("malformed access token is rejected", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/buyer/purchases",
    headers: { cookie: "accessToken=not-a-jwt" },
  });
  assert.equal(response.statusCode, 401);
});

test("contact form rejects invalid input without sending email", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/contact",
    payload: { name: "", email: "invalid", query: "short" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().success, false);
});

test("health endpoint preserves its response contract", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });
  const body = response.json();
  assert.deepEqual(Object.keys(body).sort(), ["integrations", "status"]);
  assert.deepEqual(Object.keys(body.integrations).sort(), ["rabbitmq", "redis"]);
  assert.ok(["connected", "disconnected", "disabled"].includes(body.integrations.redis));
  assert.ok(["connected", "disconnected", "disabled"].includes(body.integrations.rabbitmq));
});

test("unknown routes return 404", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/route-that-does-not-exist",
  });
  assert.equal(response.statusCode, 404);
});

test("production config rejects weak JWT secrets and non-HTTPS CORS origins", () => {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/marketplace_test",
    JWT_ACCESS_SECRET: "access-secret-with-more-than-thirty-two-characters",
    JWT_REFRESH_SECRET: "different-refresh-secret-with-more-than-32-chars",
    CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "test-api-key",
    CLOUDINARY_API_SECRET: "test-api-secret",
    RAZORPAY_KEY_ID: "rzp_test_unused",
    RAZORPAY_KEY_SECRET: "test-razorpay-secret",
    SMTP_HOST: "localhost",
    SMTP_PORT: "587",
    SMTP_USER: "test@example.invalid",
    SMTP_PASS: "test-smtp-password",
    CONTACT_EMAIL: "",
    COOKIE_DOMAIN: "",
    CORS_ORIGINS: "https://market.example",
    REDIS_URL: "",
    RABBITMQ_URL: "",
  };
  const loadConfig = ["--import", "tsx", "-e", "require('./src/config/env')"];
  const valid = spawnSync(process.execPath, loadConfig, {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
  });
  assert.equal(valid.status, 0, valid.stderr);

  const weakSecret = spawnSync(process.execPath, loadConfig, {
    cwd: process.cwd(),
    env: { ...childEnv, JWT_ACCESS_SECRET: "short" },
    encoding: "utf8",
  });
  assert.notEqual(weakSecret.status, 0);
  assert.match(weakSecret.stderr, /at least 32 characters/);

  const insecureCors = spawnSync(process.execPath, loadConfig, {
    cwd: process.cwd(),
    env: { ...childEnv, CORS_ORIGINS: "http://market.example" },
    encoding: "utf8",
  });
  assert.notEqual(insecureCors.status, 0);
  assert.match(insecureCors.stderr, /HTTPS origins/);

  const invalidCookieDomain = spawnSync(process.execPath, loadConfig, {
    cwd: process.cwd(),
    env: { ...childEnv, COOKIE_DOMAIN: "localhostREDIS_URL" },
    encoding: "utf8",
  });
  assert.notEqual(invalidCookieDomain.status, 0);
  assert.match(invalidCookieDomain.stderr, /COOKIE_DOMAIN must be a valid hostname/);
});
