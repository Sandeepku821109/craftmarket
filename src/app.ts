import Fastify from "fastify";
import { registerPlugins } from "./plugins/registerPlugins";
import registerRoutes from "./routes/index";
import { errorHandler } from "./middleware/errorHandler";
import {
  closeInfrastructure,
  connectInfrastructure,
  getInfrastructureStatus,
} from "./config/infrastructure";
import { ENV } from "./config/env";
import { isDatabaseReady } from "./config/database";

export async function buildApp() {
  const app = Fastify({
    logger: ENV.NODE_ENV === "test" ? false : true,
  });

  await connectInfrastructure();
  app.addHook("onClose", async () => {
    await closeInfrastructure();
  });

  try {
    app.addHook("onSend", async (_request, reply, payload) => {
      reply
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer")
        .header("permissions-policy", "camera=(), microphone=(), geolocation=()");
      if (String(reply.getHeader("content-type") || "").startsWith("application/pdf")) {
        reply.removeHeader("x-frame-options");
      } else {
        reply.header("x-frame-options", "DENY");
      }
      return payload;
    });
    app.setErrorHandler(errorHandler);
    await registerPlugins(app);
    await registerRoutes(app);

    app.get("/health", async () => ({
      status: "ok",
      integrations: getInfrastructureStatus(),
    }));

    app.get("/ready", async (_request, reply) => {
      const integrations = getInfrastructureStatus();
      const checks = {
        database: isDatabaseReady(),
        redis: integrations.redis !== "disconnected",
        rabbitmq: integrations.rabbitmq !== "disconnected",
      };
      const ready = Object.values(checks).every(Boolean);
      return reply.code(ready ? 200 : 503).send({
        status: ready ? "ready" : "not_ready",
        checks,
      });
    });

    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}