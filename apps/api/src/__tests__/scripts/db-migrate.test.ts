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
  buildProvisionClientOptions,
  planMigrations,
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

describe("migration plan (#660 PR 2)", () => {
  it("with MIGRATE_DATABASE_URL: provisions the role as that user, granted to the app user; migrates as the app user", () => {
    const plan = planMigrations({
      DATABASE_URL: "postgresql://app%40x:app-pw@db:5432/portal",
      MIGRATE_DATABASE_URL: "postgresql://owner:owner-pw@db:5432/portal",
      DB_MASTER_SECRET_ARN: "arn:aws:secretsmanager:rds!db-1",
    });
    expect(plan.provision).toEqual({
      url: "postgresql://owner:owner-pw@db:5432/portal",
      grantee: "app@x",
      password: undefined,
    });
    // Schema migrations stay on the app user, so it owns what they create.
    expect(plan.migrate).toEqual({
      url: "postgresql://app%40x:app-pw@db:5432/portal",
      masterSecretArn: "arn:aws:secretsmanager:rds!db-1",
      fallbackPassword: "app-pw",
    });
  });

  it("without it: no provisioning step; migrates as DATABASE_URL with the #500 resolver", () => {
    const plan = planMigrations({
      DATABASE_URL: "postgresql://app:app-pw@db:5432/portal",
      MIGRATE_DATABASE_URL: undefined,
      DB_MASTER_SECRET_ARN: "arn:aws:secretsmanager:rds!db-1",
    });
    expect(plan.provision).toBeNull();
    expect(plan.migrate.url).toBe("postgresql://app:app-pw@db:5432/portal");
  });

  it("takes MIGRATE_DATABASE_PASSWORD separately, so a password with URL-special characters never goes into the URL", () => {
    const plan = planMigrations({
      DATABASE_URL: "postgresql://app:app-pw@db:5432/portal",
      MIGRATE_DATABASE_URL: "postgresql://owner@db.example:5432/portal",
      MIGRATE_DATABASE_PASSWORD: "p@ss/w:rd",
    });
    expect(plan.provision).toEqual({
      url: "postgresql://owner@db.example:5432/portal",
      grantee: "app",
      password: "p@ss/w:rd",
    });
    // The host the provisioning client will reach is the URL's, untouched.
    expect(new URL(plan.provision!.url).hostname).toBe("db.example");
    expect(buildProvisionClientOptions("r", "app", "p@ss/w:rd")).toMatchObject({
      password: "p@ss/w:rd",
    });
  });

  it("passes the reader-role name as the portalai.sql_reader_role setting", () => {
    const opts = buildMigrationClientOptions(
      makeResolver(async () => "pw"),
      "custom_reader"
    );
    expect(opts.connection).toEqual({
      "portalai.sql_reader_role": "custom_reader",
    });
  });

  it("the provisioning client also names the grantee", () => {
    expect(buildProvisionClientOptions("custom_reader", "app")).toEqual({
      max: 1,
      connection: {
        "portalai.sql_reader_role": "custom_reader",
        "portalai.sql_reader_grantee": "app",
      },
    });
  });
});
