/**
 * `assertRedisReachable` against the real Redis (#867).
 *
 * `jobs redispatch` once hung for minutes on a bad CA, because every client
 * it used retried its connection forever. These pin the bounded check it
 * now runs first: it passes on a Redis that answers, and fails fast, naming
 * the cause and never the URL, on one that doesn't.
 */
import { spawnSync } from "node:child_process";

import { describe, it, expect } from "@jest/globals";

import { assertRedisReachable } from "../../../utils/redis.util.js";

const REDIS_URL = process.env.REDIS_URL!;

const failure = async (url: string, timeoutMs = 2_000) => {
  const started = Date.now();
  let error: (Error & { cause?: unknown }) | undefined;
  try {
    await assertRedisReachable({ connection: { url }, timeoutMs });
  } catch (err) {
    error = err as Error;
  }
  return { error, elapsed: Date.now() - started };
};

describe("assertRedisReachable (#867)", () => {
  it("passes on a Redis that answers", async () => {
    await expect(
      assertRedisReachable({ connection: { url: REDIS_URL } })
    ).resolves.toBeUndefined();
  });

  it("fails fast on a refused connection, naming the cause", async () => {
    const { error, elapsed } = await failure("redis://user:s3cret@127.0.0.1:1");
    expect(error?.message).toMatch(/^Redis unreachable: /);
    expect(error?.message).toMatch(/ECONNREFUSED/);
    expect(error?.cause).toBeDefined();
    expect(error?.message).not.toContain("s3cret");
    expect(elapsed).toBeLessThan(2_000);
  });

  it("fails when the TLS handshake can't complete, rather than retrying", async () => {
    // The test Redis speaks plaintext and never answers a ClientHello, so a
    // rediss:// client can't finish its handshake: the local stand-in for
    // app-dev's rejected CA. Only the deadline ends it.
    const { error, elapsed } = await failure(
      REDIS_URL.replace(/^redis:\/\//, "rediss://")
    );
    expect(error?.message).toMatch(/^Redis unreachable: /);
    expect(elapsed).toBeLessThan(3_000);
  });

  it("gives up at its deadline on an endpoint that never answers", async () => {
    // A non-routable address: the SYN goes nowhere, so only the deadline ends it.
    const { error, elapsed } = await failure("redis://10.255.255.1:6379", 500);
    expect(error?.message).toMatch(/^Redis unreachable: /);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("makes the redispatch entrypoint exit 1 with the cause instead of hanging", () => {
    const started = Date.now();
    const run = spawnSync(
      "npx",
      ["tsx", "src/scripts/jobs-redispatch.ts", "--dry-run"],
      {
        // The suite silences logs; the child must print its failure line.
        env: {
          ...process.env,
          REDIS_URL: "redis://user:s3cret@127.0.0.1:1",
          LOG_LEVEL: "error",
          LOG_FORMAT: "json",
        },
        encoding: "utf8",
        timeout: 60_000,
      }
    );
    const output = `${run.stdout}${run.stderr}`;

    expect(run.signal).toBeNull(); // not killed by the timeout
    expect(run.status).toBe(1);
    expect(output).toContain("REDISPATCH FAILED: Redis unreachable");
    expect(output).not.toContain("s3cret");
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 70_000);
});
