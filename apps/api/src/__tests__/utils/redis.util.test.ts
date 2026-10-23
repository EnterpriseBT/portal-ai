import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { jest, describe, it, expect, afterEach } from "@jest/globals";

/**
 * The single Redis connection seam (#852). TLS follows REDIS_URL's scheme
 * (ioredis turns `rediss://` into TLS on its own); REDIS_TLS_CA pins a private
 * CA and is only meaningful with `rediss://`. Every client — the shared
 * ioredis client and every BullMQ queue/worker — builds its options here, so
 * a CA or TLS setting can't reach some clients and miss others.
 */

const constructed: Array<{ url: string; options: Record<string, unknown> }> =
  [];
const handlers: Record<string, (...a: unknown[]) => void> = {};

class FakeRedis {
  constructor(url: string, options: Record<string, unknown>) {
    constructed.push({ url, options });
  }
  on(event: string, fn: (...a: unknown[]) => void) {
    handlers[event] = fn;
    return this;
  }
  quit = async () => "OK";
}

const logInfo = jest.fn();

async function loadRedisUtil(env: Record<string, unknown>) {
  jest.resetModules();
  jest.unstable_mockModule("ioredis", () => ({ Redis: FakeRedis }));
  jest.unstable_mockModule("../../environment.js", () => ({
    environment: env,
  }));
  jest.unstable_mockModule("../../utils/logger.util.js", () => ({
    createLogger: () => ({ info: logInfo, error: jest.fn(), warn: jest.fn() }),
  }));
  return import("../../utils/redis.util.js");
}

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

afterEach(() => {
  constructed.length = 0;
  logInfo.mockReset();
});

describe("redisConnection", () => {
  it("builds plaintext options for redis:// (no tls key)", async () => {
    const { redisConnection, redisTlsEnabled } = await loadRedisUtil({
      REDIS_URL: "redis://localhost:6380",
    });
    const conn = redisConnection();
    expect(conn).toEqual({
      url: "redis://localhost:6380",
      maxRetriesPerRequest: null,
    });
    expect(redisTlsEnabled()).toBe(false);
  });

  it("leaves TLS to the URL for rediss:// without a CA", async () => {
    const { redisConnection, redisTlsEnabled } = await loadRedisUtil({
      REDIS_URL: "rediss://cache.example:6379",
    });
    const conn = redisConnection();
    expect(conn).not.toHaveProperty("tls");
    expect(conn.url).toBe("rediss://cache.example:6379");
    expect(redisTlsEnabled()).toBe(true);
  });

  it("pins REDIS_TLS_CA as tls.ca for rediss://", async () => {
    const { redisConnection } = await loadRedisUtil({
      REDIS_URL: "rediss://cache.example:6379",
      REDIS_TLS_CA: PEM,
    });
    expect(redisConnection().tls).toEqual({ ca: PEM });
  });

  it("refuses a CA paired with a plaintext redis:// URL", async () => {
    const { redisConnection } = await loadRedisUtil({
      REDIS_URL: "redis://cache.example:6379",
      REDIS_TLS_CA: PEM,
    });
    expect(() => redisConnection()).toThrow(
      "REDIS_TLS_CA is set but REDIS_URL is not rediss://"
    );
  });

  it("always sets maxRetriesPerRequest: null (BullMQ requires it)", async () => {
    for (const REDIS_URL of ["redis://a:1", "rediss://a:1"]) {
      const { redisConnection } = await loadRedisUtil({ REDIS_URL });
      expect(redisConnection().maxRetriesPerRequest).toBeNull();
    }
  });
});

describe("getRedisClient", () => {
  it("passes the URL and the remaining options to ioredis, and logs TLS state without the URL", async () => {
    const { getRedisClient } = await loadRedisUtil({
      REDIS_URL: "rediss://secret-host.example:6379",
      REDIS_TLS_CA: PEM,
    });
    getRedisClient();
    expect(constructed).toEqual([
      {
        url: "rediss://secret-host.example:6379",
        options: { maxRetriesPerRequest: null, tls: { ca: PEM } },
      },
    ]);

    handlers.connect();
    expect(logInfo).toHaveBeenCalledWith(
      { tls: true, customCa: true },
      "Redis connected"
    );
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain("secret-host");
  });
});

describe("REDIS_URL has one reader", () => {
  const SRC = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(p);
      return p.endsWith(".ts") ? [p] : [];
    });
  }

  it("only redis.util.ts reads environment.REDIS_URL, so every client shares the seam", () => {
    const readers = sourceFiles(SRC)
      .filter((f) =>
        fs.readFileSync(f, "utf8").includes("environment.REDIS_URL")
      )
      .map((f) => path.relative(SRC, f));
    expect(readers).toEqual(["utils/redis.util.ts"]);
  });
});
