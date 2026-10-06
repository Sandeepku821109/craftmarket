import amqp, {
  type AmqpConnectionManager,
  type Channel as AmqpChannel,
  type ChannelWrapper,
} from "amqp-connection-manager";
import Redis from "ioredis";
import { ENV } from "./env";

export const MARKETPLACE_EVENTS_QUEUE = "marketplace.events";

let redisClient: Redis | undefined;
let rabbitConnection: AmqpConnectionManager | undefined;
let rabbitChannel: ChannelWrapper | undefined;

export async function connectInfrastructure(): Promise<void> {
  try {
    if (ENV.REDIS_URL) {
      try {
        redisClient = new Redis(ENV.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
        });
        redisClient.on("error", () => {
          console.error("Redis connection error");
        });
        await redisClient.connect();
        await redisClient.ping();
        console.info("Redis connected");
      } catch {
        throw new Error("Redis connection failed; check REDIS_URL, TLS, DNS, and credentials");
      }
    } else {
      console.warn("Redis is not configured; set REDIS_URL to enable it");
    }

    if (ENV.RABBITMQ_URL) {
      try {
        rabbitConnection = amqp.connect([ENV.RABBITMQ_URL], {
          heartbeatIntervalInSeconds: 15,
          reconnectTimeInSeconds: 5,
        });
        rabbitConnection.on("connect", () => console.info("RabbitMQ connected"));
        rabbitConnection.on("disconnect", () => {
          console.error("RabbitMQ disconnected");
        });

        rabbitChannel = rabbitConnection.createChannel({
          json: true,
          setup: (channel: AmqpChannel) =>
            channel.assertQueue(MARKETPLACE_EVENTS_QUEUE, {
              durable: true,
            }),
        });
        rabbitChannel.on("error", () => {
          console.error("RabbitMQ channel error");
        });
        await rabbitChannel.waitForConnect();
        console.info("RabbitMQ event queue is ready");
      } catch {
        throw new Error("RabbitMQ connection failed; check RABBITMQ_URL, TLS, DNS, and credentials");
      }
    } else {
      console.warn("RabbitMQ is not configured; set RABBITMQ_URL to enable it");
    }
  } catch (startupError) {
    try {
      await closeInfrastructure();
    } catch {
      console.error("Integration cleanup failed after startup error");
    }
    if (startupError instanceof Error) throw startupError;
    throw new Error("Integration startup failed");
  }
}

export function getRedis(): Redis {
  if (!redisClient || redisClient.status !== "ready") {
    throw new Error("Redis is not connected");
  }
  return redisClient;
}

export function getRabbitChannel(): ChannelWrapper {
  if (!rabbitChannel || !rabbitConnection?.isConnected()) {
    throw new Error("RabbitMQ is not connected");
  }
  return rabbitChannel;
}

export function getInfrastructureStatus(): {
  redis: "connected" | "disconnected" | "disabled";
  rabbitmq: "connected" | "disconnected" | "disabled";
} {
  return {
    redis: !ENV.REDIS_URL
      ? "disabled"
      : redisClient?.status === "ready"
        ? "connected"
        : "disconnected",
    rabbitmq: !ENV.RABBITMQ_URL
      ? "disabled"
      : rabbitConnection?.isConnected()
        ? "connected"
        : "disconnected",
  };
}

export async function publishMarketplaceEvent<T>(event: T): Promise<void> {
  const channel = getRabbitChannel();
  await channel.sendToQueue(MARKETPLACE_EVENTS_QUEUE, event, {
    persistent: true,
    contentType: "application/json",
  });
}

export async function closeInfrastructure(): Promise<void> {
  const resources = {
    rabbitChannel,
    rabbitConnection,
    redisClient,
  };
  redisClient = undefined;
  rabbitChannel = undefined;
  rabbitConnection = undefined;

  const closeOperations: Promise<unknown>[] = [];
  if (resources.rabbitChannel) closeOperations.push(resources.rabbitChannel.close());
  if (resources.rabbitConnection) closeOperations.push(resources.rabbitConnection.close());
  if (resources.redisClient) {
    if (resources.redisClient.status === "ready") {
      closeOperations.push(resources.redisClient.quit());
    } else {
      resources.redisClient.disconnect();
    }
  }

  const results = await Promise.allSettled(closeOperations);
  if (results.some((result) => result.status === "rejected")) {
    console.error("One or more infrastructure connections failed to close cleanly");
  }
}
