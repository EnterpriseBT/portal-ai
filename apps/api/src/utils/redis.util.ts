import { Redis, type RedisOptions } from "ioredis";

import { environment } from "../environment.js";
import { createLogger } from "./logger.util.js";

const logger = createLogger({ module: "redis" });

let redisClient: Redis | null = null;

/** ioredis options plus the URL, the shape BullMQ's `connection` accepts. */
export type RedisConnection = RedisOptions & { url: string };

/**
 * Whether ioredis will use TLS for REDIS_URL. Its own test, verbatim: a
 * case-sensitive `rediss://` prefix (`REDISS://` connects in plaintext). A
 * WHATWG `URL` parse would lowercase the scheme and disagree, and would throw
 * on the `host:port` form ioredis accepts.
 */
export const redisTlsEnabled = (): boolean =>
  environment.REDIS_URL.startsWith("rediss://");

/**
 * The one place Redis connection options are built (#852). Every client —
 * the shared ioredis client and every BullMQ queue/worker — takes these, so
 * a TLS setting can't reach some clients and miss others.
 *
 * TLS follows the scheme: ioredis turns `rediss://` into TLS on its own, and
 * `redis://` stays plaintext (local dev, the Helm chart's bundled Redis).
 * REDIS_TLS_CA (PEM) pins a private CA, which is meaningless without TLS, so
 * that pairing is refused as a misconfiguration rather than ignored.
 */
export const redisConnection = (): RedisConnection => {
  const ca = environment.REDIS_TLS_CA;
  if (ca && !redisTlsEnabled()) {
    throw new Error("REDIS_TLS_CA is set but REDIS_URL is not rediss://");
  }
  return {
    url: environment.REDIS_URL,
    maxRetriesPerRequest: null, // required by BullMQ
    ...(ca ? { tls: { ca } } : {}),
  };
};

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    const { url, ...options } = redisConnection();
    redisClient = new Redis(url, options);
    redisClient.on("error", (err: Error) =>
      logger.error(err, "Redis connection error")
    );
    // Never log the URL: a managed Redis carries its credentials in it.
    redisClient.on("connect", () =>
      logger.info(
        { tls: redisTlsEnabled(), customCa: !!environment.REDIS_TLS_CA },
        "Redis connected"
      )
    );
  }
  return redisClient;
};

export const closeRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
};
