import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { connectDB } from "./config/database";

let appPromise: Promise<FastifyInstance> | undefined;

async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    const startup = (async () => {
      await connectDB();
      const app = await buildApp();
      await app.ready();
      return app;
    })();
    appPromise = startup;
    startup.catch(() => {
      if (appPromise === startup) appPromise = undefined;
    });
  }
  return appPromise;
}

export async function handleVercelRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const requestUrl = request.url || "/";
  if (requestUrl === "/api/health" || requestUrl.startsWith("/api/health?")) {
    request.url = requestUrl.replace(/^\/api\/health/, "/health");
  } else if (requestUrl === "/api/ready" || requestUrl.startsWith("/api/ready?")) {
    request.url = requestUrl.replace(/^\/api\/ready/, "/ready");
  }

  try {
    const app = await getApp();
    app.server.emit("request", request, response);
  } catch (error) {
    console.error("Vercel backend initialization failed:", error);
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    response.statusCode = 500;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ success: false, message: "Backend initialization failed" }));
  }
}
