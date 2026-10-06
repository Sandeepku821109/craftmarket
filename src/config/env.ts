import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function optionalUrl(name: string, protocols: string[]): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  if (name === "REDIS_URL" && parsed.hostname.endsWith(".upstash.io") && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL for Upstash must use rediss:// to enable TLS");
  }
  return value;
}

function optionalEmail(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${name} must be a valid email address`);
  }
  return value;
}

function optionalCookieDomain(
  nodeEnv: "development" | "test" | "production"
): string | undefined {
  const value = process.env.COOKIE_DOMAIN?.trim();
  if (!value) return undefined;

  const domain = value.startsWith(".") ? value.slice(1) : value;
  const label = "[a-z\\d](?:[a-z\\d-]{0,61}[a-z\\d])?";
  if (
    domain.length > 253 ||
    !new RegExp(`^${label}(?:\\.${label})*$`, "i").test(domain) ||
    (nodeEnv === "production" && (!domain.includes(".") || domain.toLowerCase() === "localhost"))
  ) {
    throw new Error(
      "COOKIE_DOMAIN must be a valid hostname (for example .example.com); leave it unset for localhost"
    );
  }

  return `${value.startsWith(".") ? "." : ""}${domain.toLowerCase()}`;
}

function validateNodeEnv(): "development" | "test" | "production" {
  const value = process.env.NODE_ENV || "development";
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return value;
}

function corsOrigins(nodeEnv: "development" | "test" | "production"): string[] {
  const configured = process.env.CORS_ORIGINS;
  if (nodeEnv === "production" && !configured?.trim()) {
    throw new Error("CORS_ORIGINS must be explicitly configured in production");
  }

  const origins = (configured || "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (nodeEnv === "production") {
    for (const origin of origins) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error("CORS_ORIGINS must contain valid origins");
      }
      if (parsed.protocol !== "https:" || parsed.origin !== origin) {
        throw new Error("Production CORS_ORIGINS must contain HTTPS origins without paths");
      }
    }
  }

  return origins;
}

function validateProductionSecrets(
  nodeEnv: "development" | "test" | "production",
  accessSecret: string,
  refreshSecret: string
): void {
  if (nodeEnv === "production") {
    if (accessSecret.length < 32 || refreshSecret.length < 32) {
      throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must each be at least 32 characters in production");
    }
    if (accessSecret === refreshSecret) {
      throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production");
    }
  }
}

const NODE_ENV = validateNodeEnv();
const JWT_ACCESS_SECRET = required("JWT_ACCESS_SECRET");
const JWT_REFRESH_SECRET = required("JWT_REFRESH_SECRET");
const COOKIE_DOMAIN = optionalCookieDomain(NODE_ENV);
validateProductionSecrets(NODE_ENV, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET);

export const ENV = {
  PORT: positiveInteger("PORT", 5000),
  MONGO_URI: required("MONGO_URI"),
  NODE_ENV,
  CORS_ORIGINS: corsOrigins(NODE_ENV),
  REDIS_URL: optionalUrl("REDIS_URL", ["redis:", "rediss:"]),
  RABBITMQ_URL: optionalUrl("RABBITMQ_URL", ["amqp:", "amqps:"]),

  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  ACCESS_TOKEN_EXPIRY: "15m" as const,
  REFRESH_TOKEN_EXPIRY: "7d" as const,

  CLOUDINARY_CLOUD_NAME: required("CLOUDINARY_CLOUD_NAME"),
  CLOUDINARY_API_KEY: required("CLOUDINARY_API_KEY"),
  CLOUDINARY_API_SECRET: required("CLOUDINARY_API_SECRET"),

  RAZORPAY_KEY_ID: required("RAZORPAY_KEY_ID"),
  RAZORPAY_KEY_SECRET: required("RAZORPAY_KEY_SECRET"),

  SMTP_HOST: required("SMTP_HOST"),
  SMTP_PORT: positiveInteger("SMTP_PORT", 587),
  SMTP_USER: required("SMTP_USER"),
  SMTP_PASS: required("SMTP_PASS"),
  CONTACT_EMAIL: optionalEmail("CONTACT_EMAIL"),

  PLATFORM_COMMISSION_PERCENT: 20, // admin cut %
  COOKIE_DOMAIN,
};