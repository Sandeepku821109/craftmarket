import { configureTestEnvironment } from "./testEnvironment";

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(Math.ceil(values.length * fraction) - 1, values.length - 1)];
}

async function main(): Promise<void> {
  const concurrency = positiveInteger("LOAD_CONCURRENCY", 10, 50);
  const durationSeconds = positiveInteger("LOAD_DURATION_SECONDS", 10, 60);
  configureTestEnvironment();

  const { buildApp } = await import("../src/app");
  const app = await buildApp();
  const latencies: number[] = [];
  let failures = 0;
  let requests = 0;
  const startedAt = Date.now();
  const baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  const deadline = startedAt + durationSeconds * 1000;

  async function request(path: string, expectedStatus: number): Promise<void> {
    const started = performance.now();
    try {
      const response = await fetch(`${baseUrl}${path}`);
      latencies.push(performance.now() - started);
      requests += 1;
      if (response.status !== expectedStatus) failures += 1;
      await response.body?.cancel();
    } catch {
      latencies.push(performance.now() - started);
      requests += 1;
      failures += 1;
    }
  }

  try {
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (Date.now() < deadline) {
          await request("/health", 200);
          await request("/api/buyer/purchases", 401);
        }
      })
    );
  } finally {
    await app.close();
  }

  latencies.sort((a, b) => a - b);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  console.log(`Local Fastify HTTP smoke load: ${concurrency} workers, ${elapsedSeconds}s`);
  console.log(`Requests: ${requests}; failures: ${failures}; throughput: ${(requests / elapsedSeconds).toFixed(1)} req/s`);
  console.log(
    `Latency ms (p50/p95/p99): ${percentile(latencies, 0.5).toFixed(1)} / ${percentile(latencies, 0.95).toFixed(1)} / ${percentile(latencies, 0.99).toFixed(1)}`
  );
  if (failures > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error("Load test failed:", error);
  process.exitCode = 1;
});
