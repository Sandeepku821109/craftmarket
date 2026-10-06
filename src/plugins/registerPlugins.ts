import { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { ENV } from "../config/env";

export async function registerPlugins(app: FastifyInstance) {
  await app.register(cors, {
    origin: ENV.CORS_ORIGINS,
    credentials: true,
  });

  await app.register(cookie, {
    secret: ENV.JWT_ACCESS_SECRET,
    hook: "onRequest",
  });

  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024,
      files: 10,
      fields: 12,
      parts: 22,
    },
  });
}