/**
 * #500 — pins the load-bearing postgres-js behavior the rotation fix rests
 * on: the `password` option (a) is consulted per new connection and (b)
 * OVERRIDES the password embedded in the connection-string URL. If a
 * postgres-js upgrade ever changes either, these fail in CI instead of
 * resurfacing as a prod rotation incident.
 *
 * Runs against the real test database (setup.ts sets DATABASE_URL).
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import postgres from "postgres";

describe("postgres-js dynamic password (#500)", () => {
  const pools: ReturnType<typeof postgres>[] = [];

  afterEach(async () => {
    await Promise.all(pools.map((p) => p.end({ timeout: 1 })));
    pools.length = 0;
  });

  const realUrl = () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set - setup.ts should have");
    return new URL(url);
  };

  const withWrongPassword = () => {
    const parsed = realUrl();
    const correct = decodeURIComponent(parsed.password);
    parsed.password = "definitely-not-the-password";
    return { badUrl: parsed.toString(), correct };
  };

  it("a password function overrides the URL's wrong password (case 9)", async () => {
    const { badUrl, correct } = withWrongPassword();
    const pool = postgres(badUrl, {
      max: 1,
      connect_timeout: 5,
      password: async () => correct,
    });
    pools.push(pool);

    const rows = await pool`SELECT 1 AS ok`;
    expect(rows[0].ok).toBe(1);
  });

  it("the function is actually consulted — a wrong value fails password auth (case 10)", async () => {
    const parsed = realUrl();
    const pool = postgres(parsed.toString(), {
      max: 1,
      connect_timeout: 5,
      password: async () => "definitely-not-the-password",
    });
    pools.push(pool);

    await expect(pool`SELECT 1 AS ok`).rejects.toMatchObject({
      // 28P01 invalid_password — proves the fn's value reached the server.
      code: "28P01",
    });
  });
});
