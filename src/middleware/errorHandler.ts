import { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  request.log.error(error);

  const statusCode =
    error.validation ? 400 :
    error.statusCode && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;
  const message =
    statusCode === 400 && error.validation
      ? "Invalid request"
      : statusCode < 500
        ? error.message
        : "Internal Server Error";

  reply.code(statusCode).send({ success: false, message });
}
