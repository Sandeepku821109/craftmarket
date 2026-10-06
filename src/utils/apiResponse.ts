import { FastifyReply } from "fastify";

export function sendSuccess(reply: FastifyReply, data: unknown, message = "Success", code = 200) {
  return reply.code(code).send({ success: true, message, data });
}

export function sendError(reply: FastifyReply, message = "Error", code = 400, errors?: unknown) {
  return reply.code(code).send({ success: false, message, errors });
}