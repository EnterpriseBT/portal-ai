/**
 * db-migrate entrypoint (#505) — the deploy/CI migration path must resolve its
 * DB password through the #500 resolver, not the DATABASE_URL's static embedded
 * copy. This guards the regression: a future edit reverting to a plain-string
 * password would silently re-break every post-rotation deploy.
 *
 * Only `buildMigrationClientOptions` is exercised — the module's `runMigrations`
 * side-effect is entrypoint-guarded, so importing here opens no DB connection.
 */

import { jest, describe, it, expect } from "@jest/globals";

import type { DbPasswordResolver } from "../../db/credentials.util.js";
import { buildMigrationClientOptions } from "../../scripts/db-migrate.js";

const makeResolver = (resolve: () => Promise<string>): DbPasswordResolver => ({
  resolve,
  invalidate: jest.fn(),
});

describe("buildMigrationClientOptions (#505)", () => {
  it("sets password to a resolver-backed function, not a static string", async () => {
    const resolve = jest.fn<() => Promise<string>>(async () => "rotated-pw");
    const opts = buildMigrationClientOptions(makeResolver(resolve));

    expect(typeof opts.password).toBe("function");
    await expect(opts.password()).resolves.toBe("rotated-pw");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("re-invokes the resolver per connection (fresh password each call)", async () => {
    let n = 0;
    const resolve = jest.fn<() => Promise<string>>(async () => `pw-${++n}`);
    const opts = buildMigrationClientOptions(makeResolver(resolve));

    await expect(opts.password()).resolves.toBe("pw-1");
    await expect(opts.password()).resolves.toBe("pw-2");
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("uses a single connection for the one-shot task", () => {
    const opts = buildMigrationClientOptions(makeResolver(async () => "pw"));
    expect(opts.max).toBe(1);
  });
});
