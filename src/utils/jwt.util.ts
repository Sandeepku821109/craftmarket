import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { ENV } from "../config/env";
import { z } from "zod";

export interface TokenPayload {
  id: string;
  role: "creator" | "buyer" | "admin";
}

const tokenPayloadSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["creator", "buyer", "admin"]),
});

const accessTokenOptions: SignOptions = { expiresIn: ENV.ACCESS_TOKEN_EXPIRY };
const refreshTokenOptions: SignOptions = { expiresIn: ENV.REFRESH_TOKEN_EXPIRY };

export function generateAccessToken(payload: TokenPayload) {
  return jwt.sign(payload, ENV.JWT_ACCESS_SECRET, accessTokenOptions);
}

export function generateRefreshToken(payload: TokenPayload) {
  return jwt.sign(payload, ENV.JWT_REFRESH_SECRET, refreshTokenOptions);
}

export function verifyAccessToken(token: string): TokenPayload {
  return verifyToken(token, ENV.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token: string): TokenPayload {
  return verifyToken(token, ENV.JWT_REFRESH_SECRET);
}

function verifyToken(token: string, secret: string): TokenPayload {
  const payload = jwt.verify(token, secret);
  const parsed = tokenPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Invalid token payload");
  return parsed.data;
}