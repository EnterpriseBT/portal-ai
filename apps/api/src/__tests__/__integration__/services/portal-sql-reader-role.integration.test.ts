/**
 * #660 PR 2: the restricted reader role agent SQL runs under.
 *
 * Migration 0118 provisions it; `PortalSqlReaderRoleService` probes it and
 * refuses the SQL tools (PORTAL_SQL_UNAVAILABLE) when it isn't usable. The
 * suite runs as the test database's superuser, so "cannot be assumed" (no
 * membership) isn't reproducible here: a superuser can SET ROLE to anything.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, afterEach } from "@jest/globals";
import { sql } from "drizzle-orm";

import { db } from "../../../db/client.js";
import { environment } from "../../../environment.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { PortalSqlReaderRoleService } from "../../../services/portal-sql-reader-role.service.js";

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../drizzle/0118_portal-sql-reader-role.sql"
);
const DEFAULT_ROLE = "portalai_sql_reader";

const roleRow = async (name: string) =>
  (await db.execute(
    sql`SELECT rolcanlogin, rolsuper FROM pg_roles WHERE rolname = ${name}`
  )) as unknown as Array<{ rolcanlogin: boolean; rolsuper: boolean }>;

describe("portal SQL reader role (#660 PR 2)", () => {
  afterEach(async () => {
    environment.PORTAL_SQL_READER_ROLE = DEFAULT_ROLE;
    PortalSqlReaderRoleService.resetForTests();
    await db.execute(
      sql.raw(`REVOKE SELECT ON entity_records FROM ${DEFAULT_ROLE}`)
    );
  });

  it("the migration created a NOLOGIN, non-superuser role the API role can assume", async () => {
    const [row] = await roleRow(DEFAULT_ROLE);
    expect(row).toEqual({ rolcanlogin: false, rolsuper: false });
    const [m] = (await db.execute(
      sql`SELECT pg_has_role(current_user, ${DEFAULT_ROLE}, 'MEMBER') AS member`
    )) as unknown as Array<{ member: boolean }>;
    expect(m.member).toBe(true);
  });

  it("the migration is idempotent", async () => {
    const ddl = readFileSync(MIGRATION, "utf8");
    await db.execute(sql.raw(ddl));
    await db.execute(sql.raw(ddl));
    expect(await roleRow(DEFAULT_ROLE)).toHaveLength(1);
  });

  it("the migration never fails an upgrade whose user lacks CREATEROLE: it skips with a NOTICE", async () => {
    const ddl = readFileSync(MIGRATION, "utf8");
    const absent = "portalai_sql_reader_nocreate";
    await db.execute(sql.raw(`DROP ROLE IF EXISTS rr_plain_migrator`));
    await db.execute(sql.raw(`CREATE ROLE rr_plain_migrator NOLOGIN`));
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(`SET LOCAL portalai.sql_reader_role = '${absent}'`)
        );
        await tx.execute(sql.raw(`SET LOCAL ROLE rr_plain_migrator`));
        await tx.execute(sql.raw(ddl));
      });
      expect(await roleRow(absent)).toHaveLength(0);
    } finally {
      await db.execute(sql.raw(`DROP ROLE IF EXISTS rr_plain_migrator`));
    }
  });

  it("run by a privileged user, the migration grants membership to the named grantee (the app user), not to itself", async () => {
    const ddl = readFileSync(MIGRATION, "utf8");
    const reader = "portalai_sql_reader_grantee_t";
    await db.execute(sql.raw(`DROP ROLE IF EXISTS ${reader}`));
    await db.execute(sql.raw(`DROP ROLE IF EXISTS rr_app_user`));
    await db.execute(sql.raw(`CREATE ROLE rr_app_user NOLOGIN`));
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(`SET LOCAL portalai.sql_reader_role = '${reader}'`)
        );
        await tx.execute(
          sql.raw(`SET LOCAL portalai.sql_reader_grantee = 'rr_app_user'`)
        );
        await tx.execute(sql.raw(ddl));
      });
      const members = (await db.execute(sql`
        SELECT m.rolname AS member
        FROM pg_auth_members am
        JOIN pg_roles r ON r.oid = am.roleid
        JOIN pg_roles m ON m.oid = am.member
        WHERE r.rolname = ${reader}
        ORDER BY 1
      `)) as unknown as Array<{ member: string }>;
      expect(members.map((m) => m.member)).toEqual(["rr_app_user"]);
      // The grantee can assume it: SET ROLE as rr_app_user succeeds.
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL ROLE rr_app_user`));
        await tx.execute(sql.raw(`SET LOCAL ROLE ${reader}`));
      });
      // Re-run as the grantee itself (the later schema migration, as the app
      // user): it skips the grant it can't make, and doesn't fail.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(`SET LOCAL portalai.sql_reader_role = '${reader}'`)
        );
        await tx.execute(sql.raw(`SET LOCAL ROLE rr_app_user`));
        await tx.execute(sql.raw(ddl));
      });
    } finally {
      await db.execute(
        sql.raw(
          `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${reader}') THEN EXECUTE 'REVOKE ALL ON SCHEMA public FROM ${reader}'; END IF; END $$`
        )
      );
      await db.execute(sql.raw(`DROP ROLE IF EXISTS ${reader}`));
      await db.execute(sql.raw(`DROP ROLE IF EXISTS rr_app_user`));
    }
  });

  it("probe: the provisioned role is usable (no table grants, denied entity_records)", async () => {
    await expect(PortalSqlReaderRoleService.probe()).resolves.toEqual({
      usable: true,
    });
    await expect(
      PortalSqlReaderRoleService.assertUsable()
    ).resolves.toBeUndefined();
  });

  it("probe: a role that can read an application table is not usable", async () => {
    await db.execute(
      sql.raw(`GRANT SELECT ON entity_records TO ${DEFAULT_ROLE}`)
    );
    const result = await PortalSqlReaderRoleService.probe();
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/can read public\.entity_records/);
  });

  it("assertUsable: a missing role refuses with PORTAL_SQL_UNAVAILABLE (503)", async () => {
    environment.PORTAL_SQL_READER_ROLE = "portalai_sql_reader_absent";
    await expect(
      PortalSqlReaderRoleService.assertUsable()
    ).rejects.toMatchObject({
      status: 503,
      code: ApiCode.PORTAL_SQL_UNAVAILABLE,
    });
  });

  it("assertUsable: an invalid role name is refused, never interpolated", async () => {
    environment.PORTAL_SQL_READER_ROLE = 'x"; DROP TABLE users; --';
    await expect(
      PortalSqlReaderRoleService.assertUsable()
    ).rejects.toMatchObject({
      code: ApiCode.PORTAL_SQL_UNAVAILABLE,
    });
  });

  it("assertUsable: a failure is re-probed, so provisioning later needs no restart", async () => {
    environment.PORTAL_SQL_READER_ROLE = "portalai_sql_reader_absent";
    await expect(
      PortalSqlReaderRoleService.assertUsable()
    ).rejects.toBeTruthy();
    environment.PORTAL_SQL_READER_ROLE = DEFAULT_ROLE;
    await expect(
      PortalSqlReaderRoleService.assertUsable()
    ).resolves.toBeUndefined();
  });

  it("enter: under the role, a granted temp view reads and entity_records is denied (42501)", async () => {
    const outcome = await db
      .transaction(async (tx) => {
        await tx.execute(sql.raw("DISCARD TEMP"));
        await tx.execute(
          sql.raw(`CREATE TEMP VIEW rr_probe_view AS SELECT 1 AS one`)
        );
        await PortalSqlReaderRoleService.enter(tx, ["rr_probe_view"]);
        const rows = (await tx.execute(
          sql.raw("SELECT one FROM rr_probe_view")
        )) as unknown as Array<{ one: number }>;
        expect(rows).toEqual([{ one: 1 }]);
        await tx.execute(sql.raw("SELECT 1 FROM entity_records LIMIT 1"));
        throw new Error("entity_records was readable under the reader role");
      })
      .catch((err: unknown) => err);
    const cause = (outcome as { cause?: { code?: string } }).cause;
    expect(cause?.code ?? (outcome as { code?: string }).code).toBe("42501");
  });
});
