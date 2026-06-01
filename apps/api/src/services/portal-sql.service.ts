/**
 * Portal SQL orchestration — Phase 3 wide-table cutover.
 *
 * `PortalSqlService.runSqlQuery` is the new home for the LLM's
 * `sql_query` tool. It replaces the AlaSQL-backed `AnalyticsService.sqlQuery`
 * path: every call runs against Postgres inside a `READ ONLY` transaction
 * with a per-call set of temp views aliased to the station's entity keys.
 *
 * The pipeline (see `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_3.spec.md`):
 *
 *   1. `validatePortalSql` — deny-list + comment/quote-aware multi-statement
 *      scan. Throws `PORTAL_SQL_FORBIDDEN` on violation.
 *   2. `applyImplicitLimit` — wrap with `LIMIT <rowCap + 1>` when the AST
 *      has no top-level aggregation and no explicit LIMIT.
 *   3. Open a transaction, set it `READ ONLY` + `statement_timeout = 30s`,
 *      materialise the per-call view set, execute the LLM SQL.
 *   4. `applyRowCap` → `applyCellCap` → `buildResponse` build the
 *      truncation envelope.
 *
 * The transaction is explicitly rolled back on every code path so the
 * session-scoped temp views are dropped before the connection returns to
 * the pool. (Postgres temp objects are session-lifetime by default, not
 * transaction-lifetime; a rollback is the only path that cleans them up
 * without an explicit `DROP`.)
 */

import { sql } from "drizzle-orm";

import { db } from "../db/client.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import { createLogger } from "../utils/logger.util.js";
import { resolveEntityCapabilities } from "../utils/resolve-capabilities.util.js";
import { connectorEntitiesRepo } from "../db/repositories/connector-entities.repository.js";
import {
  wideTableStatementCache,
  type WideTableStatementCache,
} from "./wide-table-statement.cache.js";

import { validatePortalSql } from "./portal-sql-validation.util.js";
import { applyImplicitLimit } from "./portal-sql-limit.util.js";
import {
  PORTAL_SQL_DEFAULTS,
  applyRowCap,
  applyCellCap,
  buildResponse,
  type PortalSqlResponse,
} from "./portal-sql-response.util.js";

const logger = createLogger({ module: "portal-sql-service" });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wide-table columns that never appear in a session view under their
 * raw name. `entity_record_id` is replaced by the `_record_id` synthetic
 * column; `organization_id` is hidden (the view's WHERE pins it to the
 * caller's org); `synced_at` and `is_valid` are internal bookkeeping.
 *
 * `source_id` IS projected — cross-entity JOINs from the LLM rely on
 * the phase-2 denormalisation that copies it onto every wide table.
 */
const VIEW_HIDDEN_COLUMNS = new Set<string>([
  "entity_record_id",
  "organization_id",
  "synced_at",
  "is_valid",
]);

export interface SessionViewBuild {
  /** CREATE TEMP VIEW DDL strings, one per read-capable entity. */
  views: ReadonlyArray<string>;
  /**
   * `entityKey` → temp view name. Today these are equal — the entity's
   * `key` IS the view name. The indirection lets future revisions add
   * a prefix without rewriting callers.
   */
  viewMap: ReadonlyMap<string, string>;
}

export interface PortalSqlParams {
  sql: string;
  stationId: string;
  organizationId: string;
  /** Override the default 500-row cap (for internal callers). */
  rowCap?: number;
  /** Override the default 500-byte cell cap. */
  cellCap?: number;
  /** Override the default 100 KB payload cap. */
  payloadCap?: number;
}

interface PortalSqlServiceDeps {
  statementCache: WideTableStatementCache;
}

/**
 * Sentinel for forcing the read-only tx to roll back after a successful
 * run. Drizzle's `db.transaction` commits on a clean callback return and
 * rolls back on throw; we always want rollback (so the temp views are
 * dropped at end of call), but also want to surface the response. The
 * sentinel carries the response back out through the catch block.
 */
class PortalSqlTxResult<T> extends Error {
  constructor(public readonly value: T) {
    super("__portal_sql_tx_result__");
  }
}

export class PortalSqlServiceImpl {
  constructor(
    private readonly deps: PortalSqlServiceDeps = {
      statementCache: wideTableStatementCache,
    }
  ) {}

  /**
   * Build the per-call temp-view set for a station, filtered by
   * read capability. Returns the DDL strings the caller is expected to
   * execute inside its transaction (along with a `viewMap` for
   * diagnostics).
   *
   * Every view embeds the `organizationId` literal in its WHERE so the
   * LLM cannot escape the org scope by writing a different filter.
   * Identifier values (`organizationId`, `connectorEntityId`) are
   * validated against the UUID shape before interpolation — they are
   * internal values, never user-supplied at the SQL level, but the
   * defensive check protects against a future regression that lets a
   * non-UUID through.
   */
  async buildSessionViews(
    stationId: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<SessionViewBuild> {
    if (!UUID_RE.test(organizationId)) {
      throw new ApiError(
        500,
        ApiCode.PORTAL_SQL_FORBIDDEN,
        `invalid organizationId for portal sql session: ${organizationId}`
      );
    }

    const capsById = await resolveEntityCapabilities(stationId);
    const readableEntityIds = Object.entries(capsById)
      .filter(([, caps]) => caps.read === true)
      .map(([id]) => id);

    // Even when no entities are readable, still emit the meta views (below)
    // — the agent gets back empty rows rather than a confusing "table
    // doesn't exist" error when it asks "what's available?"

    // Load the entities so we know their `key` (the public view name).
    const entities = await Promise.all(
      readableEntityIds.map((id) => connectorEntitiesRepo.findById(id))
    );

    const views: string[] = [];
    const viewMap = new Map<string, string>();
    const usedKeys = new Set<string>();

    for (const entity of entities) {
      if (!entity) continue;
      if (!UUID_RE.test(entity.id)) {
        throw new ApiError(
          500,
          ApiCode.PORTAL_SQL_FORBIDDEN,
          `invalid connectorEntityId for portal sql session: ${entity.id}`
        );
      }
      const entityKey = entity.key;
      if (usedKeys.has(entityKey)) {
        // Two entities sharing the same key in the same station is a
        // configuration error; skip the duplicate so the first wins.
        logger.warn(
          { stationId, entityKey, entityId: entity.id },
          "duplicate entity key in station — skipping view"
        );
        continue;
      }

      const stmt = await this.deps.statementCache.get(entity.id, client);
      // The cache's `columns` already excludes WIDE_TABLE_METADATA_COLUMNS
      // (those are returned by `selectAllSql` separately) — every entry
      // here is a `c_*` data column safe to project under its raw name.
      const dataColumns = stmt.columns;

      const projections: string[] = [
        `w."entity_record_id" AS "_record_id"`,
        `'${entity.id}'::text AS "_connector_entity_id"`,
        `w."source_id" AS "source_id"`,
      ];
      for (const c of dataColumns) {
        if (VIEW_HIDDEN_COLUMNS.has(c.columnName)) continue;
        projections.push(`w."${c.columnName}" AS "${c.columnName}"`);
      }

      const viewName = entityKey;
      const tableName = `er__${entity.id}`;
      const ddl =
        `CREATE OR REPLACE TEMP VIEW "${viewName}" AS\n` +
        `  SELECT ${projections.join(", ")}\n` +
        `  FROM "${tableName}" w\n` +
        `  JOIN entity_records er ON er.id = w."entity_record_id"\n` +
        `  WHERE w."organization_id" = '${organizationId}'\n` +
        `    AND er.deleted IS NULL`;

      views.push(ddl);
      viewMap.set(entityKey, viewName);
      usedKeys.add(entityKey);
    }

    // ── Schema-introspection meta views (#87) ─────────────────────────
    //
    // `_meta_entities` and `_meta_columns` give the agent a runtime path
    // to ask "what entities are available?" and "what columns does X
    // have, with what semantic types?" — independent of the system-
    // prompt schema snapshot which is captured at session start and
    // never refreshed.
    //
    // Same org-scope guard as the entity views: the orgId literal is
    // embedded in the WHERE so the agent cannot escape the scope no
    // matter what SQL it writes. Same station-scope filter via the
    // readable-entity-ids whitelist.
    //
    // Each ID is validated against UUID_RE before interpolation. The
    // values come from internal capability resolution; the defensive
    // check protects against a future regression that lets a non-UUID
    // through.
    const readableIdsLiteral =
      readableEntityIds.length === 0
        ? // Sentinel that matches no rows — IN () is a SQL syntax error
          // in Postgres, so we use an impossible-UUID literal instead.
          "'00000000-0000-0000-0000-000000000000'"
        : readableEntityIds
            .map((id) => {
              if (!UUID_RE.test(id)) {
                throw new ApiError(
                  500,
                  ApiCode.PORTAL_SQL_FORBIDDEN,
                  `invalid connectorEntityId for portal sql session: ${id}`
                );
              }
              return `'${id}'`;
            })
            .join(", ");

    const metaEntitiesDdl =
      `CREATE OR REPLACE TEMP VIEW "_meta_entities" AS\n` +
      `  SELECT "id", "key", "label"\n` +
      `  FROM "connector_entities"\n` +
      `  WHERE "organization_id" = '${organizationId}'\n` +
      `    AND "id" IN (${readableIdsLiteral})\n` +
      `    AND "deleted" IS NULL`;
    views.push(metaEntitiesDdl);
    viewMap.set("_meta_entities", "_meta_entities");

    const metaColumnsDdl =
      `CREATE OR REPLACE TEMP VIEW "_meta_columns" AS\n` +
      `  SELECT\n` +
      `    ce."id" AS "connector_entity_id",\n` +
      `    ce."key" AS "entity_key",\n` +
      `    cd."id" AS "column_definition_id",\n` +
      `    cd."key" AS "column_key",\n` +
      `    fm."normalized_key" AS "normalized_key",\n` +
      `    wtc."column_name" AS "wide_column_name",\n` +
      `    cd."label" AS "label",\n` +
      `    cd."type"::text AS "type",\n` +
      `    cd."description" AS "description",\n` +
      `    fm."ref_entity_key" AS "ref_entity_key",\n` +
      `    fm."ref_normalized_key" AS "ref_normalized_key"\n` +
      `  FROM "column_definitions" cd\n` +
      `    JOIN "field_mappings" fm ON fm."column_definition_id" = cd."id"\n` +
      `    JOIN "connector_entities" ce ON ce."id" = fm."connector_entity_id"\n` +
      `    JOIN "wide_table_columns" wtc ON wtc."field_mapping_id" = fm."id"\n` +
      `  WHERE cd."organization_id" = '${organizationId}'\n` +
      `    AND ce."id" IN (${readableIdsLiteral})\n` +
      `    AND cd."deleted" IS NULL\n` +
      `    AND fm."deleted" IS NULL\n` +
      `    AND ce."deleted" IS NULL\n` +
      `    AND wtc."deleted" IS NULL\n` +
      `    AND wtc."retired_at" IS NULL`;
    views.push(metaColumnsDdl);
    viewMap.set("_meta_columns", "_meta_columns");

    return { views, viewMap };
  }

  /**
   * Execute an LLM-supplied SELECT against the station's per-call
   * temp-view set. See the file header for the full pipeline.
   */
  async runSqlQuery(params: PortalSqlParams): Promise<PortalSqlResponse> {
    const caps = {
      rowCap: params.rowCap ?? PORTAL_SQL_DEFAULTS.rowCap,
      cellCap: params.cellCap ?? PORTAL_SQL_DEFAULTS.cellCap,
      payloadCap: params.payloadCap ?? PORTAL_SQL_DEFAULTS.payloadCap,
    };

    // 1. Static validation — throws PORTAL_SQL_FORBIDDEN on violation.
    const { cleaned, needsImplicitLimit } = validatePortalSql(params.sql);

    // 2. Optional implicit LIMIT wrap.
    const { sql: wrappedSql, appliedLimit } = needsImplicitLimit
      ? applyImplicitLimit(cleaned, caps.rowCap)
      : { sql: cleaned, appliedLimit: null as number | null };

    // 3. Open a transaction, set the statement_timeout safety stop,
    //    materialise the view set, *then* flip the connection into
    //    `READ ONLY` mode before executing the LLM SQL.
    //
    // Postgres rejects `CREATE TEMP VIEW` while
    // `transaction_read_only = on`, so the read-only flag has to come
    // *after* the view DDL — `SET LOCAL transaction_read_only = on`
    // applies for the remainder of the transaction regardless of when
    // it is issued, so the LLM SQL still runs under the read-only
    // guard.
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL statement_timeout = '30s'"));

        const build = await this.buildSessionViews(
          params.stationId,
          params.organizationId,
          tx as unknown as DbClient
        );

        for (const ddl of build.views) {
          await tx.execute(sql.raw(ddl));
        }

        // From here on, no DDL/DML can run. The deny-list-passed LLM
        // SQL inherits the read-only guard.
        await tx.execute(sql.raw("SET LOCAL transaction_read_only = on"));

        let rows: Record<string, unknown>[];
        try {
          const result = await tx.execute(sql.raw(wrappedSql));
          rows = result as unknown as Record<string, unknown>[];
        } catch (err) {
          throw translateExecutionError(err);
        }

        // 4. Envelope.
        const { rows: capped, totalCount, capped: rowCapped } = applyRowCap(
          rows,
          caps.rowCap
        );
        const cellCapped = applyCellCap(capped, caps.cellCap);
        const envelope = buildResponse(
          cellCapped,
          totalCount,
          rowCapped,
          appliedLimit,
          caps.rowCap,
          caps.payloadCap,
          PORTAL_SQL_DEFAULTS.truncatedSampleSize
        );

        // Force rollback so the session-scoped temp views are dropped
        // before the connection returns to the pool. The sentinel
        // carries the response out through the surrounding catch.
        throw new PortalSqlTxResult<PortalSqlResponse>(envelope);
      });
    } catch (err) {
      if (err instanceof PortalSqlTxResult) {
        return err.value as PortalSqlResponse;
      }
      throw err;
    }

    // Drizzle's transaction wrapper either commits (we never reach here
    // — the sentinel above always throws) or re-throws the inner error
    // (handled above). This branch should be unreachable.
    /* istanbul ignore next */
    throw new Error("portal sql transaction returned without a result");
  }
}

/**
 * Re-route a Postgres execution error to a portal-friendly ApiError.
 * Specifically:
 *
 *   - `42P01 undefined_table` → `PORTAL_SQL_FORBIDDEN` with an
 *     "unknown entity: <name>" hint (read-disabled entity, or hallucinated).
 *   - `57014 query_canceled`  → `PORTAL_SQL_TIMEOUT`.
 *   - `25006 read_only_sql_transaction` → `PORTAL_SQL_FORBIDDEN` (the
 *     LLM bypassed the deny-list somehow; the tx-level read-only flag
 *     caught it). Shouldn't happen in practice.
 *
 * Any other Postgres error propagates as-is so the existing API error
 * pipeline handles it.
 */
function translateExecutionError(err: unknown): unknown {
  // Drizzle wraps the postgres-js error in `DrizzleQueryError` whose
  // `cause` is the original pg error. The pg `code` / `message` we want
  // live on the cause; the wrapper's `message` is the formatted "Failed
  // query: …" string.
  const cause = (err as { cause?: unknown } | undefined)?.cause;
  const inner = (cause ?? err) as {
    code?: string;
    message?: string;
  };
  const code = inner.code;
  const message = inner.message ?? "";

  if (code === "42P01") {
    const match = /relation "([^"]+)" does not exist/i.exec(message);
    const missing = match?.[1] ?? "(unknown relation)";
    return new ApiError(
      400,
      ApiCode.PORTAL_SQL_FORBIDDEN,
      `unknown entity: ${missing}`
    );
  }
  if (code === "57014") {
    return new ApiError(
      400,
      ApiCode.PORTAL_SQL_TIMEOUT,
      "query timed out (30s)"
    );
  }
  if (code === "25006") {
    return new ApiError(
      400,
      ApiCode.PORTAL_SQL_FORBIDDEN,
      "write attempt blocked by read-only transaction"
    );
  }
  return err;
}

export const PortalSqlService = new PortalSqlServiceImpl();
