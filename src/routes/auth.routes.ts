import { FastifyInstance } from "fastify";
import {
  requestSignupOtp, verifySignupOtp,
  requestLoginOtp, verifyLoginOtp,
  logout, refreshAccessToken,
} from "../controllers/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";

export default async function authRoutes(app: FastifyInstance) {
  app.post("/signup/request-otp", asyncHandler(requestSignupOtp));
  app.post("/signup/verify-otp", asyncHandler(verifySignupOtp));
  app.post("/login/request-otp", asyncHandler(requestLoginOtp));
  app.post("/login/verify-otp", asyncHandler(verifyLoginOtp));
  app.post("/refresh-token", asyncHandler(refreshAccessToken));
  app.post("/logout", asyncHandler(logout));
}