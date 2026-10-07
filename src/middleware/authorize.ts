import { FastifyRequest, FastifyReply } from "fastify";

export function authorize(...allowedRoles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return reply.code(403).send({ success: false, message: "Access denied" });
    }

  };
}