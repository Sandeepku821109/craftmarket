import { buildApp } from "./app";
import { connectDB } from "./config/database";
import { ENV } from "./config/env";
import { getInfrastructureStatus } from "./config/infrastructure";
import { closeDatabase } from "./config/database";

async function start() {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  try {
    await connectDB();
    const startedApp = await buildApp();
    app = startedApp;
    startedApp.log.info(
      { integrations: getInfrastructureStatus() },
      "Redis and RabbitMQ connection status"
    );
    await startedApp.listen({ port: ENV.PORT, host: "0.0.0.0" });
    startedApp.log.info(`Server running on port ${ENV.PORT}`);

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      startedApp.log.info({ signal }, "Graceful shutdown started");
      const results = await Promise.allSettled([
        startedApp.close(),
        closeDatabase(),
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          startedApp.log.error(result.reason, "Graceful shutdown failed");
          process.exitCode = 1;
        }
      }
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  } catch (error) {
    const cleanupOperations: Promise<unknown>[] = [closeDatabase()];
    if (app) cleanupOperations.push(app.close());
    const cleanupResults = await Promise.allSettled(cleanupOperations);
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        console.error("Startup cleanup failed:", result.reason);
      }
    }
    throw error;
  }
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Server startup failed:", message);
  process.exitCode = 1;
});