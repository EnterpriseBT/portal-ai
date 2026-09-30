/**
 * The restricted Postgres role agent SQL runs under (#660, PR 2).
 *
 * The SQL gate (`validatePortalSql` + `assertRelationsAllowed`) keeps a
 * statement to the caller's session views, but it is application code: a
 * parser gap would read with the API's own privileges, which reach every
 * org's tables. This makes Postgres the boundary. Each SQL session grants the
 * reader role SELECT on the session's temp views and then `SET LOCAL ROLE`s
 * to it, so the statement can read those views and nothing else.
 *
 * The role is created by migration 0118 (NOLOGIN, no grants). When it is
 * missing, cannot be assumed, or can read any application relation, the SQL
 * tools refuse with `PORTAL_SQL_UNAVAILABLE` (503). They never fall back to
 * running as the API's role.
 */

import { sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { ApiError } from "./http.service.js";
import { createLogger } from "../utils/logger.util.js";
import { unwrapPgError } from "../utils/pg-error.util.js";

const logger = createLogger({ module: "portal-sql-reader-role" });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/** A probe relation every install has; the reader must be denied it. */
const PROBE_TABLE = "entity_records";

export interface ReaderRoleProbe {
  usable: boolean;
  /** Why it isn't usable; absent when usable. */
  reason?: string;
}

/** Quote an identifier for interpolation into server-issued SQL. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Sentinel that carries the probe result out of a rolled-back transaction. */
class ProbeTxResult {
  constructor(readonly value: ReaderRoleProbe) {}
}

export class PortalSqlReaderRoleService {
  /** Process-wide: once usable, stays usable for the process lifetime. */
  private static usable = false;

  /** The configured role name, validated as a plain lower-case identifier. */
  static roleName(): string {
    const name = environment.PORTAL_SQL_READER_ROLE;
    if (!ROLE_NAME_PATTERN.test(name)) {
      throw new Error(`invalid PORTAL_SQL_READER_ROLE: ${name}`);
    }
    return name;
  }

  /**
   * The statements that move a session onto the reader role: SELECT on each
   * of the session's views, then `SET LOCAL ROLE`. Run after the view DDL
   * and before `transaction_read_only` (a GRANT is not allowed in a
   * read-only transaction). Kept out of `build.views` so the scope hash
   * (#643) doesn't change.
   */
  static enterStatements(viewNames: Iterable<string>): string[] {
    const role = quoteIdent(this.roleName());
    const grants = [...new Set(viewNames)].map(
      (v) => `GRANT SELECT ON ${quoteIdent(v)} TO ${role}`
    );
    return [...grants, `SET LOCAL ROLE ${role}`];
  }

  /** Run {@link enterStatements} on `tx`. */
  static async enter(tx: Tx, viewNames: Iterable<string>): Promise<void> {
    for (const stmt of this.enterStatements(viewNames)) {
      await tx.execute(sql.raw(stmt));
    }
  }

  /**
   * Check that the role exists, can be assumed, holds no privilege beyond
   * extension-owned reference relations, and is denied the probe table.
   * Never throws: a failure to probe is reported as not usable.
   */
  static async probe(): Promise<ReaderRoleProbe> {
    let role: string;
    try {
      role = this.roleName();
    } catch (err) {
      return { usable: false, reason: (err as Error).message };
    }
    try {
      const attrs = (await db.execute(
        sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${role}`
      )) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
      if (attrs.length === 0) {
        return { usable: false, reason: `role ${role} does not exist` };
      }
      if (attrs[0].rolsuper || attrs[0].rolbypassrls) {
        return {
          usable: false,
          reason: `role ${role} is a superuser or bypasses row security`,
        };
      }

      // Any relation it can read, other than extension-owned reference
      // relations (PostGIS's spatial_ref_sys and the like, which PUBLIC can
      // read and which hold no tenant data), means it's over-privileged.
      const readable = (await db.execute(sql`
        SELECT n.nspname || '.' || c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg\\_temp\\_%'
          AND n.nspname NOT LIKE 'pg\\_toast%'
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend d
            WHERE d.classid = 'pg_class'::regclass
              AND d.objid = c.oid
              AND d.deptype = 'e'
          )
          AND has_table_privilege(${role}, c.oid, 'SELECT')
        ORDER BY 1
        LIMIT 5
      `)) as unknown as Array<{ name: string }>;
      if (readable.length > 0) {
        return {
          usable: false,
          reason: `role ${role} can read ${readable.map((r) => r.name).join(", ")}`,
        };
      }

      // Assume it, and confirm Postgres denies it the probe table.
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL ROLE ${quoteIdent(role)}`));
        try {
          await tx.execute(sql.raw(`SELECT 1 FROM ${PROBE_TABLE} LIMIT 1`));
        } catch (err) {
          if (unwrapPgError(err).code === "42501") {
            throw new ProbeTxResult({ usable: true });
          }
          throw err;
        }
        throw new ProbeTxResult({
          usable: false,
          reason: `role ${role} can read ${PROBE_TABLE}`,
        });
      });
      /* istanbul ignore next -- the transaction always throws a result */
      return { usable: false, reason: "probe did not complete" };
    } catch (err) {
      if (err instanceof ProbeTxResult) return err.value;
      const { code, message } = unwrapPgError(err);
      return {
        usable: false,
        reason: `probe failed${code ? ` (${code})` : ""}: ${message ?? String(err)}`,
      };
    }
  }

  /**
   * Throw `PORTAL_SQL_UNAVAILABLE` unless the role is usable. A success is
   * cached for the process; a failure is re-probed on the next call, so an
   * operator who provisions the role doesn't have to restart the API.
   */
  static async assertUsable(): Promise<void> {
    if (this.usable) return;
    const result = await this.probe();
    if (result.usable) {
      this.usable = true;
      return;
    }
    logger.error(
      { event: "portal-sql.reader-role-unavailable", reason: result.reason },
      "Portal SQL reader role is not usable; refusing SQL tools"
    );
    throw new ApiError(
      503,
      ApiCode.PORTAL_SQL_UNAVAILABLE,
      "The SQL workspace is unavailable: the restricted database role it runs under is missing or misconfigured. An administrator must fix it; the API log gives the reason."
    );
  }

  /** Boot-time check: logs the outcome and never throws. */
  static async checkAtBoot(): Promise<ReaderRoleProbe> {
    const result = await this.probe();
    if (result.usable) {
      this.usable = true;
      logger.info(
        {
          event: "portal-sql.reader-role-ok",
          role: environment.PORTAL_SQL_READER_ROLE,
        },
        "Portal SQL reader role is usable"
      );
    } else {
      logger.error(
        { event: "portal-sql.reader-role-unavailable", reason: result.reason },
        "Portal SQL reader role is not usable; SQL tools will refuse until it is provisioned"
      );
    }
    return result;
  }

  /** Test seam: forget a cached success. */
  static resetForTests(): void {
    this.usable = false;
  }
}
