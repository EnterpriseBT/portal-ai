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
import {
  buildMigrationClientOptions,
  resolveMigrationConnection,
} from "../../scripts/db-migrate.js";

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

describe("migration connection (#660 PR 2)", () => {
  it("prefers MIGRATE_DATABASE_URL, with that URL's own password (no master-secret resolution)", () => {
    const target = resolveMigrationConnection({
      DATABASE_URL: "postgresql://app:app-pw@db:5432/portal",
      MIGRATE_DATABASE_URL: "postgresql://owner:owner-pw@db:5432/portal",
      DB_MASTER_SECRET_ARN: "arn:aws:secretsmanager:rds!db-1",
    });
    expect(target).toEqual({
      url: "postgresql://owner:owner-pw@db:5432/portal",
      masterSecretArn: undefined,
      fallbackPassword: "owner-pw",
    });
  });

  it("falls back to DATABASE_URL, keeping the #500 master-secret resolver", () => {
    const target = resolveMigrationConnection({
      DATABASE_URL: "postgresql://app:app-pw@db:5432/portal",
      MIGRATE_DATABASE_URL: undefined,
      DB_MASTER_SECRET_ARN: "arn:aws:secretsmanager:rds!db-1",
    });
    expect(target).toEqual({
      url: "postgresql://app:app-pw@db:5432/portal",
      masterSecretArn: "arn:aws:secretsmanager:rds!db-1",
      fallbackPassword: "app-pw",
    });
  });

  it("passes the reader-role name to the migration as the portalai.sql_reader_role setting", () => {
    const opts = buildMigrationClientOptions(
      makeResolver(async () => "pw"),
      "custom_reader"
    );
    expect(opts.connection).toEqual({
      "portalai.sql_reader_role": "custom_reader",
    });
  });
});
