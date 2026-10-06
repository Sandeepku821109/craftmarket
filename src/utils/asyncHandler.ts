import { FastifyRequest, FastifyReply } from "fastify";

export const asyncHandler =
  (fn: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      return await fn(req, reply);
    } catch (error: unknown) {
      req.log.error(error);
      const statusCode =
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        typeof error.statusCode === "number" &&
        error.statusCode >= 400 &&
        error.statusCode < 500
          ? error.statusCode
          : 500;
      const message =
        statusCode < 500 && error instanceof Error ? error.message : "Internal Server Error";
      return reply.code(statusCode).send({
        success: false,
        message,
      });
    }
  };