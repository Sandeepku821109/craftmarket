import { FastifyRequest, FastifyReply } from "fastify";
import { sendSuccess, sendError } from "../utils/apiResponse";
import { createAndSendOtp, verifyOtp } from "../services/otp.service";
import { createUser, findUserByIdentifier, issueTokens } from "../services/auth.service";
import { ENV } from "../config/env";
import {
  clearRefreshToken,
  findUserById,
  userExists,
  type IUser,
} from "../models/User.model";
import { verifyRefreshToken, type TokenPayload } from "../utils/jwt.util";
import { z } from "zod";

const emailSchema = z.string().trim().email().max(254);
const otpSchema = z.string().regex(/^\d{6}$/);
const mobileSchema = z.string().trim()
  .regex(/^\+?[0-9().\s-]{7,25}$/, "Enter a valid mobile number")
  .refine((value) => (value.match(/\d/g) || []).length >= 7 && (value.match(/\d/g) || []).length <= 15);

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function publicUser(user: IUser) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    isVerified: user.isVerified,
    avatar: user.avatar,
  };
}

const cookieOptions = {
  httpOnly: true,
  secure: ENV.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  ...(ENV.COOKIE_DOMAIN ? { domain: ENV.COOKIE_DOMAIN } : {}),
};

// STEP 1: Request OTP for signup
export async function requestSignupOtp(req: FastifyRequest, reply: FastifyReply) {
  const parsed = z.object({ email: emailSchema, mobile: mobileSchema }).safeParse(req.body);
  if (!parsed.success) return sendError(reply, "Enter a valid email and mobile number", 400);
  const email = parsed.data.email.toLowerCase();
  const [existingEmail, existingMobile] = await Promise.all([
    findUserByIdentifier(email),
    userExists("mobile", parsed.data.mobile.trim()),
  ]);
  if (existingEmail) return sendError(reply, "An account with this email already exists. Sign in instead.", 409);
  if (existingMobile) return sendError(reply, "An account with this mobile number already exists. Sign in instead.", 409);

  await createAndSendOtp(email, "signup");
  return sendSuccess(reply, null, "OTP sent to email");
}

// STEP 2: Verify OTP + create account
export async function verifySignupOtp(req: FastifyRequest, reply: FastifyReply) {
  const parsed = z.object({
    email: emailSchema,
    otp: otpSchema,
    name: z.string().trim().min(1).max(100),
    mobile: mobileSchema,
    role: z.enum(["creator", "buyer"]),
  }).safeParse(req.body);
  if (!parsed.success) return sendError(reply, "Invalid signup details", 400);
  const { email, otp, name, mobile, role } = parsed.data;

  const normalizedEmail = email.toLowerCase();
  const [existingEmail, existingMobile] = await Promise.all([
    findUserByIdentifier(normalizedEmail),
    userExists("mobile", mobile.trim()),
  ]);
  if (existingEmail) return sendError(reply, "An account with this email already exists. Sign in instead.", 409);
  if (existingMobile) return sendError(reply, "An account with this mobile number already exists. Sign in instead.", 409);

  const valid = await verifyOtp(normalizedEmail, otp, "signup");
  if (!valid) return sendError(reply, "Invalid or expired OTP", 400);

  let user: IUser;
  try {
    user = await createUser({ name, email: normalizedEmail, mobile: mobile.trim(), role });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return sendError(reply, "An account with this email or mobile number already exists. Sign in instead.", 409);
    }
    throw error;
  }
  const { accessToken, refreshToken } = await issueTokens(user.id, user.role);

  reply.setCookie("accessToken", accessToken, { ...cookieOptions, maxAge: 15 * 60 });
  reply.setCookie("refreshToken", refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 });

  return sendSuccess(reply, { user: publicUser(user) }, "Account created successfully");
}

// STEP 1: Request OTP for login
export async function requestLoginOtp(req: FastifyRequest, reply: FastifyReply) {
  const parsed = z.object({ identifier: z.string().trim().min(1).max(254) }).safeParse(req.body);
  if (!parsed.success) return sendError(reply, "A valid email or mobile is required", 400);
  const { identifier } = parsed.data;
  const user = await findUserByIdentifier(identifier);
  if (!user) return sendError(reply, "User not found", 404);

  await createAndSendOtp(user.email, "login");
  return sendSuccess(reply, null, "OTP sent");
}

// STEP 2: Verify login OTP, issue tokens
export async function verifyLoginOtp(req: FastifyRequest, reply: FastifyReply) {
  const parsed = z.object({
    identifier: z.string().trim().min(1).max(254),
    otp: otpSchema,
  }).safeParse(req.body);
  if (!parsed.success) return sendError(reply, "Invalid login details", 400);
  const { identifier, otp } = parsed.data;
  const user = await findUserByIdentifier(identifier);
  if (!user) return sendError(reply, "User not found", 404);

  const valid = await verifyOtp(user.email, otp, "login");
  if (!valid) return sendError(reply, "Invalid or expired OTP", 400);

  const { accessToken, refreshToken } = await issueTokens(user.id, user.role);

  reply.setCookie("accessToken", accessToken, { ...cookieOptions, maxAge: 15 * 60 });
  reply.setCookie("refreshToken", refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 });

  return sendSuccess(reply, { user: publicUser(user) }, "Login successful");
}

export async function logout(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies.refreshToken;
  if (token) {
    let decoded: TokenPayload | undefined;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      decoded = undefined;
    }
    if (decoded) {
      await clearRefreshToken(decoded.id, token);
    }
  }
  reply.clearCookie("accessToken", cookieOptions);
  reply.clearCookie("refreshToken", cookieOptions);
  return sendSuccess(reply, null, "Logged out");
}

export async function refreshAccessToken(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies.refreshToken;
  if (!token) return sendError(reply, "No refresh token", 401);

  let decoded: TokenPayload;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    return sendError(reply, "Invalid refresh token", 401);
  }

  const user = await findUserById(decoded.id, true);
  if (!user || user.refreshToken !== token) {
    return sendError(reply, "Invalid refresh token", 401);
  }

  const { accessToken, refreshToken } = await issueTokens(user.id, user.role);
  reply.setCookie("accessToken", accessToken, { ...cookieOptions, maxAge: 15 * 60 });
  reply.setCookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60,
  });
  return sendSuccess(reply, null, "Token refreshed");
}