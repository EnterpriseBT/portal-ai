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

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "../db/client.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import { createLogger } from "../utils/logger.util.js";
import { resolveEntityCapabilities } from "../utils/resolve-capabilities.util.js";
import { renderFilterGroupToSql } from "../utils/filter-sql.util.js";
import { resolveColumns } from "../utils/resolve-columns.util.js";
import { memoizeForRequest } from "../utils/request-context.util.js";
import { unwrapPgError } from "../utils/pg-error.util.js";
import { connectorEntitiesRepo } from "../db/repositories/connector-entities.repository.js";
import { stationViewsRepo } from "../db/repositories/station-views.repository.js";
import { curatedViewsRepo } from "../db/repositories/curated-views.repository.js";
import { curatedViewFieldMappingsRepo } from "../db/repositories/curated-view-field-mappings.repository.js";
import { userRolesRepo } from "../db/repositories/user-roles.repository.js";
import { PermissionService } from "./permission.service.js";
import type { PermissionSet } from "./permission-set.js";
import type { CuratedViewSelect } from "../db/schema/zod.js";
import type { OrgRole } from "@portalai/core/models";
import {
  wideTableStatementCache,
  type WideTableStatementCache,
  type WideTableCachedColumn,
} from "./wide-table-statement.cache.js";
import { STATEMENT_TIMEOUT_MS } from "@portalai/core/constants";

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Quote a SQL identifier (double-quote, escape embedded `"`). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a SQL string literal (single-quote, escape embedded `'`). */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Emit a temp view as DROP + CREATE, not CREATE OR REPLACE. On a pooled
 *  connection a prior committed build (org-wide tile vs per-user agent, or a
 *  different user's narrower column set) can leave a same-named temp view with
 *  a different column set; CREATE OR REPLACE then fails ("cannot change name of
 *  view column" / "cannot drop columns from view"). DROP-first is schema-
 *  agnostic. Both statements are DDL — they run before the txn read-only flag. */
function pushTempView(
  views: string[],
  quotedName: string,
  selectBody: string
): void {
  views.push(`DROP VIEW IF EXISTS ${quotedName}`);
  views.push(`CREATE TEMP VIEW ${quotedName} AS\n${selectBody}`);
}

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

/**
 * #643: a stable content hash of a caller's resolved session-view scope. The
 * temp-view DDL (`build.views`) encodes both the row filter (WHERE) and the
 * column projection, so two callers with identical entitlements hash equal and
 * any filter/grant change re-hashes — the key the per-scope map dissolve is
 * addressed by. An empty build (no grants) yields a stable fail-closed hash.
 */
export function resolveScopeHash(build: SessionViewBuild): string {
  return createHash("sha256")
    .update([...build.views].join("\n"))
    .digest("hex")
    .slice(0, 32);
}

export interface PortalSqlParams {
  sql: string;
  stationId: string;
  organizationId: string;
  /**
   * The calling user — the session is built per-user via
   * `resolveViewsForSession` (#599), so the LLM SQL only ever sees the
   * curated views this user is granted. Required on every user-facing call
   * (agent `sql_query`, async SQL handle, analytics). The org-wide
   * `buildSessionViews` path (map tiles / dissolve precompute, #643) does
   * not go through `runSqlQuery`.
   */
  userId: string;
  /** Override the default 500-row cap (for internal callers). */
  rowCap?: number;
  /** Override the default 500-byte cell cap. */
  cellCap?: number;
  /** Override the default 100 KB payload cap. */
  payloadCap?: number;
  /** Override the synchronous `statement_timeout` (ms). Used by the job tier
   *  (#130 E1) to run a long scan off-thread at a higher budget. Defaults to
   *  `STATEMENT_TIMEOUT_MS` (30s). */
  statementTimeoutMs?: number;
  /** Also run a `COUNT(*)` over the (unwrapped) query in the same txn and
   *  return `exactTotal` (#340). Isolated: a count error/timeout yields
   *  `exactTotal: null`, never failing the staging query. Off by default. */
  computeExactTotal?: boolean;
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
      // #450: filter soft-deletes on the wide row's own `deleted` column — no
      // `JOIN entity_records` (which was ~93% of aggregate-tile query cost;
      // z11 measured 23,124ms → 1,584ms without it). Every delete path now
      // marks `er__<id>."deleted"` atomically with the `entity_records`
      // soft-delete, so the local filter is equivalent.
      pushTempView(
        views,
        `"${viewName}"`,
        `  SELECT ${projections.join(", ")}\n` +
          `  FROM "${tableName}" w\n` +
          `  WHERE w."organization_id" = '${organizationId}'\n` +
          `    AND w."deleted" IS NULL`
      );
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

    pushTempView(
      views,
      `"_meta_entities"`,
      `  SELECT "id", "key", "label"\n` +
        `  FROM "connector_entities"\n` +
        `  WHERE "organization_id" = '${organizationId}'\n` +
        `    AND "id" IN (${readableIdsLiteral})\n` +
        `    AND "deleted" IS NULL`
    );
    viewMap.set("_meta_entities", "_meta_entities");

    pushTempView(
      views,
      `"_meta_columns"`,
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
        `    AND wtc."retired_at" IS NULL`
    );
    viewMap.set("_meta_columns", "_meta_columns");

    // `_meta_column_catalog` — the org's full column-definition catalog.
    //
    // Distinct from `_meta_columns` (which lists columns *currently
    // bound to an entity*). This view exposes every column_definition
    // the org's admins have curated, including ones not yet wired to
    // any entity. The agent uses it when creating a new entity: it
    // picks `columnDefinitionId` values from this catalog to pass to
    // `field_mapping_create`. Column definitions are intentionally
    // admin-only — the agent has no `column_definition_create` tool.
    // If the user asks for a column that's not in the catalog, the
    // agent surfaces the gap rather than fabricating one.
    //
    // Org-scope only (no station / read-capability filter — the
    // catalog is org-wide and contains no per-row data, just labels +
    // semantic types).
    pushTempView(
      views,
      `"_meta_column_catalog"`,
      `  SELECT\n` +
        `    "id" AS "column_definition_id",\n` +
        `    "key" AS "column_key",\n` +
        `    "label" AS "label",\n` +
        `    "type"::text AS "type",\n` +
        `    "description" AS "description"\n` +
        `  FROM "column_definitions"\n` +
        `  WHERE "organization_id" = '${organizationId}'\n` +
        `    AND "deleted" IS NULL`
    );
    viewMap.set("_meta_column_catalog", "_meta_column_catalog");

    // Note: connector instances are NOT exposed as a meta view. They're
    // attached to the station via configuration *outside* the portal
    // session and don't change while a conversation is live — putting
    // them in the system prompt at session start is the right surface
    // (see `system.prompt.ts` → `## Available Connector Instances`).
    // Entities and column definitions, by contrast, CAN change
    // mid-session (the agent creates new ones, syncs add columns), so
    // they get meta views for runtime introspection.

    return { views, viewMap };
  }

  /**
   * Build the per-call temp-view set for a **user session** (#599) — the
   * per-user, curated-view-scoped counterpart to {@link buildSessionViews}.
   *
   * The view set is the station's attached curated views (`station_views`)
   * intersected with the caller's `read curated_view:<id>` grants; each
   * emitted temp view is named by the view's `key`, projects only the
   * columns the caller can read (the view's effective projection ∩ the
   * caller's `read field_mapping` grants), and ANDs the view's stored
   * `whereClause` after the org + soft-delete guard. A class-level
   * `deny read entity_record` suppresses all data (deny-wins). The `_meta_*`
   * introspection views rebuild **per granted view**, so a member never
   * learns the name of a view/column they cannot query.
   *
   * Fail-closed: no readable views ⇒ empty data views (only the `_meta_*`
   * shells). This is what every user-facing SQL surface uses; the org-wide
   * {@link buildSessionViews} remains for the no-user map-tile/dissolve
   * pipeline (#643).
   */
  /**
   * The caller's granted, readable curated views for a station — the single
   * source of "what data this user can see," shared by the SQL session
   * ({@link resolveViewsForSession}) and the introspection surfaces
   * (`buildStationContext` roster + the `station_context` tool) so the three
   * never drift. Returns the loaded {@link PermissionSet} (callers reuse it)
   * and, per granted view, the wide columns the caller may actually read —
   * effective projection ∩ non-hidden ∩ `read field_mapping` (deny-wins).
   */
  async resolveGrantedViewColumns(
    stationId: string,
    organizationId: string,
    userId: string,
    client: DbClient = db
  ): Promise<{
    set: PermissionSet;
    views: Array<{ view: CuratedViewSelect; columns: WideTableCachedColumn[] }>;
  }> {
    if (!UUID_RE.test(organizationId)) {
      throw new ApiError(
        500,
        ApiCode.PORTAL_SQL_FORBIDDEN,
        `invalid organizationId for portal sql session: ${organizationId}`
      );
    }

    // Resolve the caller's authorization once (roles → policies + grants;
    // FK conditions expanded to concrete field_mapping reads in loadSet).
    const roles = (await userRolesRepo.findEffectiveRoleNames(
      userId,
      organizationId,
      client
    )) as OrgRole[];
    const set = await PermissionService.loadSet(
      { userId, organizationId, roles },
      client
    );

    // deny-wins: an explicit class-level `deny read entity_record` empties
    // the whole data plane (never the raw passthrough). Absence of an allow
    // does NOT suppress — a view's read authority is the view grant itself.
    const entityRecordDenied = set.isDenied("read", "entity_record", {
      type: "entity_record",
    });

    // Attached views ∩ readable views.
    const attachments = await stationViewsRepo.findByStationId(
      stationId,
      client
    );
    const attachedViewIds = [
      ...new Set(attachments.map((a) => a.curatedViewId)),
    ];
    const attachedViews = (
      await Promise.all(
        attachedViewIds.map((id) => curatedViewsRepo.findById(id, client))
      )
    ).filter((v): v is NonNullable<typeof v> => v != null);
    const grantedViews = entityRecordDenied
      ? []
      : attachedViews.filter((v) =>
          set.can("resource.read", {
            type: "curated_view",
            id: v.id,
            createdBy: v.createdBy,
          })
        );

    const usedKeys = new Set<string>();
    const result: Array<{
      view: CuratedViewSelect;
      columns: WideTableCachedColumn[];
    }> = [];
    for (const view of grantedViews) {
      if (!UUID_RE.test(view.connectorEntityId)) {
        throw new ApiError(
          500,
          ApiCode.PORTAL_SQL_FORBIDDEN,
          `invalid connectorEntityId for curated view: ${view.connectorEntityId}`
        );
      }
      if (usedKeys.has(view.key)) {
        logger.warn(
          { stationId, viewKey: view.key, viewId: view.id },
          "duplicate curated-view key in station — skipping view"
        );
        continue;
      }

      const columns = await this.resolveOneViewColumns(view, set, client);
      usedKeys.add(view.key);
      result.push({ view, columns });
    }

    return { set, views: result };
  }

  /**
   * The columns a caller may read through ONE curated view: its effective
   * projection (explicit field-mapping selection, or — when it has none — all
   * of the entity's live columns), minus hidden metadata, intersected with the
   * caller's `read field_mapping` grants (deny-wins). The single source for the
   * session build ({@link resolveGrantedViewColumns}) and the standalone
   * detail/records endpoints ({@link resolveViewColumnsById}), so the two can
   * never drift.
   */
  private async resolveOneViewColumns(
    view: CuratedViewSelect,
    set: PermissionSet,
    client: DbClient
  ): Promise<WideTableCachedColumn[]> {
    const stmt = await this.deps.statementCache.get(
      view.connectorEntityId,
      client
    );
    const projectionRows =
      await curatedViewFieldMappingsRepo.findByCuratedViewId(view.id, client);
    const effectiveFmIds = projectionRows.length
      ? new Set(projectionRows.map((p) => p.fieldMappingId))
      : new Set(stmt.columns.map((c) => c.fieldMappingId));
    return stmt.columns.filter(
      (c) =>
        !VIEW_HIDDEN_COLUMNS.has(c.columnName) &&
        effectiveFmIds.has(c.fieldMappingId) &&
        set.can("resource.read", {
          type: "field_mapping",
          id: c.fieldMappingId,
        })
    );
  }

  /**
   * Single-view resolution for the detail/records endpoints — no station
   * scope. The view must be org-scoped, readable by the caller (`read
   * curated_view`, not suppressed by an `entity_record` deny). Returns `null`
   * when the caller cannot read it (→ 404: unreadable == absent).
   */
  async resolveViewColumnsById(
    viewId: string,
    organizationId: string,
    userId: string,
    client: DbClient = db
  ): Promise<{
    set: PermissionSet;
    view: CuratedViewSelect;
    columns: WideTableCachedColumn[];
  } | null> {
    if (!UUID_RE.test(organizationId)) {
      throw new ApiError(
        500,
        ApiCode.PORTAL_SQL_FORBIDDEN,
        `invalid organizationId for curated view records: ${organizationId}`
      );
    }
    const view = await curatedViewsRepo.findById(viewId, client);
    if (!view || view.organizationId !== organizationId) return null;

    const roles = (await userRolesRepo.findEffectiveRoleNames(
      userId,
      organizationId,
      client
    )) as OrgRole[];
    const set = await PermissionService.loadSet(
      { userId, organizationId, roles },
      client
    );
    const readable =
      !set.isDenied("read", "entity_record", { type: "entity_record" }) &&
      set.can("resource.read", {
        type: "curated_view",
        id: view.id,
        createdBy: view.createdBy,
      });
    if (!readable) return null;
    if (!UUID_RE.test(view.connectorEntityId)) {
      throw new ApiError(
        500,
        ApiCode.PORTAL_SQL_FORBIDDEN,
        `invalid connectorEntityId for curated view: ${view.connectorEntityId}`
      );
    }
    const columns = await this.resolveOneViewColumns(view, set, client);
    return { set, view, columns };
  }

  /**
   * The rows of ONE curated view for the detail records table (#599): the
   * view's projection (∩ field grants) + its `filter`, under the org +
   * soft-delete guard, offset-paginated. Returns `null` when the caller
   * cannot read the view (→ 404). Column names come from the statement cache
   * (safe idents) and every filter literal is escaped by `renderFilterGroup-
   * ToSql`, so the raw SQL carries no un-escaped input.
   */
  async queryCuratedViewRecords(
    viewId: string,
    organizationId: string,
    userId: string,
    opts: {
      limit: number;
      offset: number;
      /** A projected column key to order by. Anything outside the view's
       *  projection (e.g. the default `created`) falls back to the stable
       *  record-id order — sort can never reach an un-projected column. */
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      /** Case-insensitive substring match across the projected columns. */
      search?: string;
    },
    client: DbClient = db
  ): Promise<{
    records: Record<string, unknown>[];
    total: number;
    columns: { key: string; label: string }[];
  } | null> {
    const resolved = await this.resolveViewColumnsById(
      viewId,
      organizationId,
      userId,
      client
    );
    if (!resolved) return null;
    const { view, columns } = resolved;

    // Resolve the entity's column definitions once — reused for the display
    // labels (below) and the filter render's column-type map (further down),
    // so a filtered view doesn't resolve them twice.
    const resolvedCols = await resolveColumns(view.connectorEntityId);
    const labelByKey = new Map(
      resolvedCols.map((c) => [c.normalizedKey, c.label])
    );
    const columnsOut = columns.map((c) => ({
      key: c.columnName,
      label: labelByKey.get(c.normalizedKey) ?? c.columnName,
    }));

    const tableName = `er__${view.connectorEntityId}`;
    const selectList = [
      `w."entity_record_id" AS "_record_id"`,
      `w."source_id" AS "source_id"`,
      ...columns.map(
        (c) => `w.${quoteIdent(c.columnName)} AS ${quoteIdent(c.columnName)}`
      ),
    ].join(", ");

    const whereParts = [
      `w."organization_id" = ${quoteLiteral(organizationId)}`,
      `w."deleted" IS NULL`,
    ];
    if (view.filter) {
      const stmt = await this.deps.statementCache.get(
        view.connectorEntityId,
        client
      );
      const columnTypes = Object.fromEntries(
        resolvedCols.map((c) => [c.normalizedKey, c.type])
      );
      const rendered = renderFilterGroupToSql(view.filter, stmt, columnTypes);
      if (typeof rendered !== "string") {
        throw new ApiError(
          500,
          ApiCode.CURATED_VIEW_INVALID_FILTER,
          rendered.message
        );
      }
      whereParts.push(`(${rendered})`);
    }
    // Search: case-insensitive **literal** substring across the projected
    // columns only (never an un-projected column). The LIKE metacharacters
    // (\ % _) are escaped so the term matches literally (ILIKE's default escape
    // char is backslash), then wrapped in %…%; quoteLiteral handles the
    // SQL-quote escaping — injection-safe.
    const search = opts.search?.trim();
    if (search && columns.length > 0) {
      const escaped = search.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const term = quoteLiteral(`%${escaped}%`);
      const clauses = columns.map(
        (c) => `w.${quoteIdent(c.columnName)}::text ILIKE ${term}`
      );
      whereParts.push(`(${clauses.join(" OR ")})`);
    }
    const whereSql = whereParts.join(" AND ");
    const limit = Math.max(1, Math.min(opts.limit, 500));
    const offset = Math.max(0, opts.offset);

    // ORDER BY the requested projected column, always ending in the unique
    // `entity_record_id` tiebreaker (#433 — a paginated order must be total).
    // A `sortBy` that names no projected column falls back to record-id order.
    const dir = opts.sortOrder === "desc" ? "DESC" : "ASC";
    const sortCol = columns.find((c) => c.columnName === opts.sortBy);
    const orderBySql = sortCol
      ? `w.${quoteIdent(sortCol.columnName)} ${dir}, w."entity_record_id" ASC`
      : `w."entity_record_id" ${dir}`;

    const rowsSql =
      `SELECT ${selectList}\n` +
      `  FROM ${quoteIdent(tableName)} w\n` +
      `  WHERE ${whereSql}\n` +
      `  ORDER BY ${orderBySql}\n` +
      `  LIMIT ${limit} OFFSET ${offset}`;
    const countSql =
      `SELECT COUNT(*)::int AS n FROM ${quoteIdent(tableName)} w ` +
      `WHERE ${whereSql}`;

    const [rowsRes, countRes] = await Promise.all([
      client.execute(sql.raw(rowsSql)),
      client.execute(sql.raw(countSql)),
    ]);
    const records = rowsRes as unknown as Record<string, unknown>[];
    const countRows = countRes as unknown as Array<{ n: number }>;
    return {
      records,
      total: Number(countRows[0]?.n ?? 0),
      columns: columnsOut,
    };
  }

  async resolveViewsForSession(
    stationId: string,
    organizationId: string,
    userId: string,
    client: DbClient = db
  ): Promise<SessionViewBuild> {
    // #647: dedupe the explain→run double-resolution within one request. The
    // build is pure data and a caller's grants don't change mid-request, so a
    // request-scoped memo is correctness-neutral (no store — a job worker or
    // test — resolves normally). Only the default-connection path is memoized:
    // a caller passing a specific client (e.g. a transaction) needs that
    // client's visibility, and the key can't capture it, so it resolves fresh.
    if (client !== db) {
      return this.buildViewsForSession(
        stationId,
        organizationId,
        userId,
        client
      );
    }
    return memoizeForRequest(
      `views:${stationId}:${userId}:${organizationId}`,
      () => this.buildViewsForSession(stationId, organizationId, userId, client)
    );
  }

  private async buildViewsForSession(
    stationId: string,
    organizationId: string,
    userId: string,
    client: DbClient = db
  ): Promise<SessionViewBuild> {
    const { set, views: grantedViewColumns } =
      await this.resolveGrantedViewColumns(
        stationId,
        organizationId,
        userId,
        client
      );

    const views: string[] = [];
    const viewMap = new Map<string, string>();
    const grantedViewIds: string[] = [];
    // (viewKey, fieldMappingId) pairs feeding `_meta_columns`.
    const metaPairs: { viewKey: string; fieldMappingId: string }[] = [];

    for (const { view, columns } of grantedViewColumns) {
      const projections: string[] = [
        `w."entity_record_id" AS "_record_id"`,
        `'${view.connectorEntityId}'::text AS "_connector_entity_id"`,
        `w."source_id" AS "source_id"`,
      ];
      for (const c of columns) {
        projections.push(
          `w.${quoteIdent(c.columnName)} AS ${quoteIdent(c.columnName)}`
        );
        metaPairs.push({ viewKey: view.key, fieldMappingId: c.fieldMappingId });
      }

      const tableName = `er__${view.connectorEntityId}`;
      const whereParts = [
        `w."organization_id" = ${quoteLiteral(organizationId)}`,
        `w."deleted" IS NULL`,
      ];
      // #599: a stored `FilterGroup` is rendered to a safe, escaped inline
      // WHERE (`renderFilterGroupToSql`) and ANDed inside parens so it cannot
      // break out of the org/soft-delete guard. A render failure fails closed —
      // a stored filter must always render.
      if (view.filter) {
        const stmt = await this.deps.statementCache.get(
          view.connectorEntityId,
          client
        );
        const columnTypes = Object.fromEntries(
          (await resolveColumns(view.connectorEntityId)).map((c) => [
            c.normalizedKey,
            c.type,
          ])
        );
        const rendered = renderFilterGroupToSql(view.filter, stmt, columnTypes);
        if (typeof rendered !== "string") {
          throw new ApiError(
            500,
            ApiCode.PORTAL_SQL_FORBIDDEN,
            `curated view ${view.id} filter failed to render: ${rendered.message}`
          );
        }
        whereParts.push(`(${rendered})`);
      }

      pushTempView(
        views,
        quoteIdent(view.key),
        `  SELECT ${projections.join(", ")}\n` +
          `  FROM ${quoteIdent(tableName)} w\n` +
          `  WHERE ${whereParts.join("\n    AND ")}`
      );
      viewMap.set(view.key, view.key);
      grantedViewIds.push(view.id);
    }

    // ── Per-view introspection meta views ─────────────────────────────
    const orgLiteral = quoteLiteral(organizationId);
    const grantedIdsLiteral = grantedViewIds.length
      ? grantedViewIds
          .map((id) => {
            if (!UUID_RE.test(id)) {
              throw new ApiError(
                500,
                ApiCode.PORTAL_SQL_FORBIDDEN,
                `invalid curatedViewId for portal sql session: ${id}`
              );
            }
            return quoteLiteral(id);
          })
          .join(", ")
      : "'00000000-0000-0000-0000-000000000000'";

    pushTempView(
      views,
      `"_meta_entities"`,
      `  SELECT "id", "key", "label"\n` +
        `  FROM "curated_views"\n` +
        `  WHERE "organization_id" = ${orgLiteral}\n` +
        `    AND "id" IN (${grantedIdsLiteral})\n` +
        `    AND "deleted" IS NULL`
    );
    viewMap.set("_meta_entities", "_meta_entities");

    // `_meta_columns` is driven by the in-memory (viewKey, fieldMappingId)
    // pairs the caller can actually read. A sentinel pair (matching no field
    // mapping) keeps the VALUES list non-empty and yields zero rows when the
    // caller has no readable columns.
    const metaValues = (
      metaPairs.length
        ? metaPairs
        : [
            {
              viewKey: "__none__",
              fieldMappingId: "00000000-0000-0000-0000-000000000000",
            },
          ]
    )
      .map(
        (p) => `(${quoteLiteral(p.viewKey)}, ${quoteLiteral(p.fieldMappingId)})`
      )
      .join(", ");

    pushTempView(
      views,
      `"_meta_columns"`,
      `  WITH "granted"("entity_key", "field_mapping_id") AS (\n` +
        `    VALUES ${metaValues}\n` +
        `  )\n` +
        `  SELECT\n` +
        `    g."entity_key" AS "entity_key",\n` +
        `    ce."id" AS "connector_entity_id",\n` +
        `    cd."id" AS "column_definition_id",\n` +
        `    cd."key" AS "column_key",\n` +
        `    fm."normalized_key" AS "normalized_key",\n` +
        `    wtc."column_name" AS "wide_column_name",\n` +
        `    cd."label" AS "label",\n` +
        `    cd."type"::text AS "type",\n` +
        `    cd."description" AS "description",\n` +
        `    fm."ref_entity_key" AS "ref_entity_key",\n` +
        `    fm."ref_normalized_key" AS "ref_normalized_key"\n` +
        `  FROM "granted" g\n` +
        `    JOIN "field_mappings" fm ON fm."id" = g."field_mapping_id"\n` +
        `    JOIN "column_definitions" cd ON cd."id" = fm."column_definition_id"\n` +
        `    JOIN "connector_entities" ce ON ce."id" = fm."connector_entity_id"\n` +
        `    JOIN "wide_table_columns" wtc ON wtc."field_mapping_id" = fm."id"\n` +
        `  WHERE cd."organization_id" = ${orgLiteral}\n` +
        `    AND cd."deleted" IS NULL\n` +
        `    AND fm."deleted" IS NULL\n` +
        `    AND ce."deleted" IS NULL\n` +
        `    AND wtc."deleted" IS NULL\n` +
        `    AND wtc."retired_at" IS NULL`
    );
    viewMap.set("_meta_columns", "_meta_columns");

    // `_meta_column_catalog` — the org's full column-definition catalog. It
    // is admin-facing (used when creating entities), so it is emitted only
    // for callers who can read column definitions class-wide (owner/admin via
    // `*`); a member session omits it so the catalog never leaks.
    if (set.canPerformAny("read", "column_definition")) {
      pushTempView(
        views,
        `"_meta_column_catalog"`,
        `  SELECT\n` +
          `    "id" AS "column_definition_id",\n` +
          `    "key" AS "column_key",\n` +
          `    "label" AS "label",\n` +
          `    "type"::text AS "type",\n` +
          `    "description" AS "description"\n` +
          `  FROM "column_definitions"\n` +
          `  WHERE "organization_id" = ${orgLiteral}\n` +
          `    AND "deleted" IS NULL`
      );
      viewMap.set("_meta_column_catalog", "_meta_column_catalog");
    }

    return { views, viewMap };
  }

  /**
   * Execute an LLM-supplied SELECT against the station's per-call
   * temp-view set. See the file header for the full pipeline.
   */
  async runSqlQuery(
    params: PortalSqlParams
  ): Promise<PortalSqlResponse & { exactTotal?: number | null }> {
    const caps = {
      rowCap: params.rowCap ?? PORTAL_SQL_DEFAULTS.rowCap,
      cellCap: params.cellCap ?? PORTAL_SQL_DEFAULTS.cellCap,
      payloadCap: params.payloadCap ?? PORTAL_SQL_DEFAULTS.payloadCap,
    };
    const statementTimeoutMs =
      params.statementTimeoutMs ?? STATEMENT_TIMEOUT_MS;

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
    // Build the session-view DDL BEFORE opening the transaction — its own
    // pooled reads (capabilities, entity + column metadata) must not run while
    // this txn holds a connection, or concurrent callers deadlock the pool
    // (each holds one connection and blocks acquiring a second). See the tile
    // renderer for the acute fan-out case. (#314)
    const build = await this.resolveViewsForSession(
      params.stationId,
      params.organizationId,
      params.userId
    );

    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`)
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

        // #340: exact total via a same-txn COUNT(*) over the UNWRAPPED query
        // (no LIMIT). The staged rows are already fetched above, so a count
        // timeout/error is isolated to `exactTotal: null` and never loses the
        // handle. This must be the LAST DB statement before the rollback
        // sentinel — after an aborted-txn error no further statement runs.
        let exactTotal: number | null = null;
        if (params.computeExactTotal) {
          try {
            const counted = (await tx.execute(
              sql.raw(`SELECT count(*)::bigint AS n FROM (${cleaned}) _c`)
            )) as unknown as Array<{ n: string | number }>;
            const n = Number(counted[0]?.n);
            exactTotal = Number.isFinite(n) ? n : null;
          } catch {
            exactTotal = null;
          }
        }

        // 4. Envelope.
        const {
          rows: capped,
          totalCount,
          capped: rowCapped,
        } = applyRowCap(rows, caps.rowCap);
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
        // carries the response (+ #340 exactTotal) out through the catch.
        throw new PortalSqlTxResult<
          PortalSqlResponse & { exactTotal?: number | null }
        >(params.computeExactTotal ? { ...envelope, exactTotal } : envelope);
      });
    } catch (err) {
      if (err instanceof PortalSqlTxResult) {
        return err.value as PortalSqlResponse & { exactTotal?: number | null };
      }
      throw err;
    }

    // Drizzle's transaction wrapper either commits (we never reach here
    // — the sentinel above always throws) or re-throws the inner error
    // (handled above). This branch should be unreachable.
    /* istanbul ignore next */
    throw new Error("portal sql transaction returned without a result");
  }

  /**
   * Predictive cost probe for the job-tier escalation trigger (#130 E1b,
   * spec D8a). Runs `EXPLAIN (FORMAT JSON)` over the validated, implicit-
   * LIMIT-wrapped query — **non-executing**, so it returns PG's estimated
   * total plan cost + output rows without scanning the table.
   *
   * Built on the same READ ONLY + per-call temp-view pipeline as
   * `runSqlQuery` (the LLM SQL references the station's entity-key views,
   * which only exist inside that transaction), then rolls the transaction
   * back via the shared sentinel so the temp views are dropped.
   *
   * The caller (`sql_query`) compares `totalCost` against
   * `environment.SQL_QUERY_JOB_COST_THRESHOLD` to decide whether to
   * escalate up front. EXPLAIN failures are the caller's to handle (it
   * degrades to the synchronous path + 30s backstop on a null/throw),
   * so this throws on invalid SQL rather than swallowing.
   */
  async explainSqlQuery(params: {
    sql: string;
    stationId: string;
    organizationId: string;
    userId: string;
  }): Promise<{ totalCost: number; estimatedRows: number }> {
    // Mirror runSqlQuery's validation + implicit-LIMIT wrap so the probed
    // plan matches what the synchronous path would actually run.
    const { cleaned, needsImplicitLimit } = validatePortalSql(params.sql);
    const { sql: wrappedSql } = needsImplicitLimit
      ? applyImplicitLimit(cleaned, PORTAL_SQL_DEFAULTS.rowCap)
      : { sql: cleaned };

    // Build the session-view DDL before the txn — same pool-deadlock avoidance
    // as runSqlQuery / the tile renderer. (#314)
    const build = await this.resolveViewsForSession(
      params.stationId,
      params.organizationId,
      params.userId
    );

    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`)
        );

        for (const ddl of build.views) {
          await tx.execute(sql.raw(ddl));
        }
        await tx.execute(sql.raw("SET LOCAL transaction_read_only = on"));

        const res = await tx.execute(
          sql.raw(`EXPLAIN (FORMAT JSON) ${wrappedSql}`)
        );
        const estimate = parseExplainEstimate(res);

        // Roll back so the session-scoped temp views are dropped; the
        // sentinel carries the estimate out through the catch below.
        throw new PortalSqlTxResult<{
          totalCost: number;
          estimatedRows: number;
        }>(estimate);
      });
    } catch (err) {
      if (err instanceof PortalSqlTxResult) {
        return err.value as { totalCost: number; estimatedRows: number };
      }
      throw translateExecutionError(err);
    }

    /* istanbul ignore next */
    throw new Error("portal sql EXPLAIN transaction returned without a result");
  }
}

/**
 * Pull `Total Cost` + `Plan Rows` from an `EXPLAIN (FORMAT JSON)` result.
 * PG returns a single row whose `QUERY PLAN` column holds a one-element
 * array of `{ Plan: { ... } }`. postgres-js may hand the JSON back either
 * already-parsed (array/object) or as a string, so handle both. Missing
 * fields fall back to 0 (the caller treats a 0 cost as "do not escalate").
 */
function parseExplainEstimate(result: unknown): {
  totalCost: number;
  estimatedRows: number;
} {
  const rows = Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : [];
  const planColumn = rows[0]?.["QUERY PLAN"];
  const parsed =
    typeof planColumn === "string"
      ? (JSON.parse(planColumn) as unknown)
      : planColumn;
  const planNode = Array.isArray(parsed)
    ? (parsed[0] as { Plan?: Record<string, unknown> } | undefined)
    : undefined;
  const plan = planNode?.Plan ?? {};
  return {
    totalCost: Number(plan["Total Cost"] ?? 0),
    estimatedRows: Number(plan["Plan Rows"] ?? 0),
  };
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
  // Drizzle wraps the postgres-js error in `DrizzleQueryError` whose `cause` is
  // the original pg error; the code/message we want live on the cause. Shared
  // with the map-tile service so the unwrap can't drift (#449).
  const { code, message: rawMessage } = unwrapPgError(err);
  const message = rawMessage ?? "";

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
