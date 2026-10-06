import { FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken } from "../utils/jwt.util";

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    const token = req.cookies.accessToken;
    if (!token) {
      return reply.code(401).send({ success: false, message: "Not authenticated" });
    }
    const decoded = verifyAccessToken(token);
    req.user = decoded;
  } catch (err) {
    return reply.code(401).send({ success: false, message: "Invalid or expired token" });
  }
}