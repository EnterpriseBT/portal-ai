import { Redis } from "ioredis";

import { environment } from "../environment.js";
import { createLogger } from "./logger.util.js";

const logger = createLogger({ module: "redis" });

let redisClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    redisClient = new Redis(environment.REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
    });
    redisClient.on("error", (err: Error) =>
      logger.error(err, "Redis connection error")
    );
    redisClient.on("connect", () => logger.info("Redis connected"));
  }
  return redisClient;
};

export const closeRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
};
