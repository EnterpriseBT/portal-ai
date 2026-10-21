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
import { decodeCursor, encodeCursor } from "@portalai/core/contracts";

import { db } from "../db/client.js";
import {
  buildKeysetPredicate,
  buildOrderByClause,
  keysetOrdering,
} from "../db/repositories/entity-records.repository.js";
import { EntityRecordCountCache } from "./entity-record-count.cache.js";
import { readViewSortValue } from "./portal-sql-view-records.util.js";
import { pgTypeForColumnDefinitionType } from "./wide-table-reconciler.service.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import { createLogger } from "../utils/logger.util.js";
import {
  parseFilterPayload,
  renderFilterGroupToSql,
} from "../utils/filter-sql.util.js";
import { resolveColumns } from "../utils/resolve-columns.util.js";
import { memoizeForRequest } from "../utils/request-context.util.js";
import { isPgDataException, unwrapPgError } from "../utils/pg-error.util.js";
import { stationViewsRepo } from "../db/repositories/station-views.repository.js";
import { curatedViewsRepo } from "../db/repositories/curated-views.repository.js";
import { curatedViewFieldMappingsRepo } from "../db/repositories/curated-view-field-mappings.repository.js";
import { userRolesRepo } from "../db/repositories/user-roles.repository.js";
import { PermissionService } from "./permission.service.js";
import type { PermissionSet } from "./permission-set.js";
import type { CuratedViewSelect } from "../db/schema/zod.js";
import type { OrgRole } from "@portalai/core/models";
import { SORTABLE_COLUMN_TYPES } from "@portalai/core/models";
import type { ResolvedColumn } from "../adapters/adapter.interface.js";
import {
  wideTableStatementCache,
  type WideTableStatementCache,
  type WideTableCachedColumn,
} from "./wide-table-statement.cache.js";
import { STATEMENT_TIMEOUT_MS } from "@portalai/core/constants";

import {
  assertRelationsAllowed,
  fenceSql,
  STALE_REFERENCE,
  validatePortalSql,
} from "./portal-sql-validation.util.js";
import { applyImplicitLimit } from "./portal-sql-limit.util.js";
import { PortalSqlReaderRoleService } from "./portal-sql-reader-role.service.js";
import {
  renderViewFilterSql,
  validateViewFilterSql,
} from "./curated-view-filter-sql.util.js";
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
  /** #644: the curated views with a SQL filter, each created under its own
   *  savepoint by {@link openSqlSession}. */
  guardedViews?: ReadonlyArray<GuardedSessionView>;
}

/**
 * #644: a curated view with a SQL row filter, as the session creates it. A
 * server-built source view (`__src_<n>`: the wide table under the org and
 * soft-delete guard, with no user text) and the curated view over it,
 * declared `security_invoker` so its body — the author's fragment included —
 * runs with the reader role's privileges. The reader gets column-level SELECT
 * on the source view's columns (`sourceGrant`) and nothing else, so even a
 * fragment the validator missed can't read another relation or call a
 * privileged function.
 */
export interface GuardedSessionView {
  viewId: string;
  viewKey: string;
  /** DROP + CREATE for both views, run under one savepoint. */
  statements: ReadonlyArray<string>;
  /** Run instead when `statements` fail: the curated view with no rows, so a
   *  broken filter fails closed (never widened) and alone. */
  fallback: ReadonlyArray<string>;
  sourceGrant: { relation: string; columns: ReadonlyArray<string> };
}

/**
 * #644: the statements for one {@link GuardedSessionView}. Pure: identifiers
 * are quoted here and ids are checked, so `renderedWhere` (the output of
 * `renderViewFilterSql`, every column a `w."c_…"` on the source view) is the
 * only spliced text.
 */
export function buildGuardedViewStatements(args: {
  viewId: string;
  viewKey: string;
  sourceName: string;
  connectorEntityId: string;
  organizationId: string;
  /** Physical columns the curated view projects. */
  projectedColumns: ReadonlyArray<string>;
  /** Physical columns the filter reads (need not be projected). */
  filterColumns: ReadonlyArray<string>;
  renderedWhere: string;
}): GuardedSessionView {
  if (
    !UUID_RE.test(args.organizationId) ||
    !UUID_RE.test(args.connectorEntityId)
  ) {
    throw new ApiError(
      500,
      ApiCode.PORTAL_SQL_FORBIDDEN,
      `invalid id for curated view ${args.viewId}`
    );
  }
  const view = quoteIdent(args.viewKey);
  const source = quoteIdent(args.sourceName);
  const table = quoteIdent(`er__${args.connectorEntityId}`);
  const sourceColumns = [
    "entity_record_id",
    "source_id",
    ...new Set([...args.projectedColumns, ...args.filterColumns]),
  ];
  const projections = (alias: string) =>
    [
      `${alias}."entity_record_id" AS "_record_id"`,
      `${quoteLiteral(args.connectorEntityId)}::text AS "_connector_entity_id"`,
      `${alias}."source_id" AS "source_id"`,
      ...args.projectedColumns.map(
        (c) => `${alias}.${quoteIdent(c)} AS ${quoteIdent(c)}`
      ),
    ].join(", ");
  const guard =
    `w."organization_id" = ${quoteLiteral(args.organizationId)}\n` +
    `    AND w."deleted" IS NULL`;
  return {
    viewId: args.viewId,
    viewKey: args.viewKey,
    statements: [
      `DROP VIEW IF EXISTS ${view}`,
      `DROP VIEW IF EXISTS ${source}`,
      `CREATE TEMP VIEW ${source} AS\n` +
        `  SELECT ${sourceColumns.map((c) => `w.${quoteIdent(c)}`).join(", ")}\n` +
        `  FROM ${table} w\n` +
        `  WHERE ${guard}`,
      `CREATE TEMP VIEW ${view} WITH (security_invoker = true) AS\n` +
        `  SELECT ${projections("w")}\n` +
        `  FROM ${source} w\n` +
        `  WHERE (\n${args.renderedWhere}\n)`,
    ],
    fallback: [
      `DROP VIEW IF EXISTS ${view}`,
      `CREATE TEMP VIEW ${view} AS\n` +
        `  SELECT ${projections("w")}\n` +
        `  FROM ${table} w\n` +
        `  WHERE FALSE`,
    ],
    sourceGrant: { relation: args.sourceName, columns: sourceColumns },
  };
}

/**
 * #643: a stable content hash of a caller's resolved session-view scope. The
 * temp-view DDL (`build.views`) encodes both the row filter (WHERE) and the
 * column projection, so two callers with identical entitlements hash equal and
 * any filter/grant change re-hashes — the key the per-scope map dissolve is
 * addressed by. An empty build (no grants) yields a stable fail-closed hash.
 *
 * The DDL strings are **sorted before hashing** so the hash is invariant to the
 * order the view set comes back in. That order flows from `findByStationId`,
 * which has no `ORDER BY` (CLAUDE.md #433), so an unsorted hash could differ
 * between the precompute process and the serve process for the *same*
 * entitlement — a permanent dissolve-miss (raw fallback forever + cache thrash).
 * The emitted `build.views` used to materialise the temp views is untouched:
 * each `CREATE TEMP VIEW` is independent, so their creation order is irrelevant.
 */
export function resolveScopeHash(build: SessionViewBuild): string {
  const ddl = [
    ...build.views,
    ...(build.guardedViews ?? []).flatMap((g) => g.statements),
  ];
  return createHash("sha256")
    .update(ddl.sort().join("\n"))
    .digest("hex")
    .slice(0, 32);
}

type SessionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OpenSqlSessionOptions {
  statementTimeoutMs: number;
  /** Default true. Dissolve turns it off because it writes after `RESET ROLE`. */
  readOnly?: boolean;
  /** Server-issued statements to run as the API's role after the view DDL
   *  and before the switch to the reader role (dissolve's staging table). */
  beforeRole?: (tx: SessionTx) => Promise<void>;
}

/**
 * Open an agent-SQL session on `tx` (#660). The one place that sets up a
 * session, so no caller can build the views and skip the role:
 *
 * 1. `DISCARD TEMP`: no temp view a previous build left on this pooled
 *    connection survives into this session.
 * 2. `statement_timeout`.
 * 3. The caller's temp-view DDL (`build.views`).
 * 4. `beforeRole`, if given.
 * 5. SELECT on each session view for the reader role, then `SET LOCAL ROLE`
 *    to it. From here Postgres allows reading only those views.
 * 6. `transaction_read_only`, unless `readOnly: false`.
 *
 * Call `PortalSqlReaderRoleService.assertUsable()` before opening the
 * transaction: the probe uses its own pooled connection, and acquiring one
 * while holding this transaction's can deadlock the pool (#314).
 */
export async function openSqlSession(
  tx: SessionTx,
  build: SessionViewBuild,
  opts: OpenSqlSessionOptions
): Promise<OpenedSqlSession> {
  await tx.execute(sql.raw("DISCARD TEMP"));
  await tx.execute(
    sql.raw(
      `SET LOCAL statement_timeout = '${Math.trunc(opts.statementTimeoutMs)}ms'`
    )
  );
  for (const ddl of build.views) {
    await tx.execute(sql.raw(ddl));
  }
  const { degradedViewKeys, sourceGrants } = await createGuardedViews(
    tx,
    build.guardedViews ?? []
  );
  if (opts.beforeRole) await opts.beforeRole(tx);
  await PortalSqlReaderRoleService.enter(
    tx,
    build.viewMap.values(),
    sourceGrants
  );
  if (opts.readOnly !== false) {
    await tx.execute(sql.raw("SET LOCAL transaction_read_only = on"));
  }
  return { degradedViewKeys };
}

export interface OpenedSqlSession {
  /** #644: SQL-filtered views that failed to create and serve no rows. */
  degradedViewKeys: ReadonlySet<string>;
}

/**
 * #644: create each SQL-filtered view under its own savepoint. One that fails
 * (a stored fragment whose column types no longer fit, say) rolls back to the
 * savepoint and is created empty instead, so it fails closed and alone: the
 * session's other views are untouched. A cancellation is not a broken view and
 * propagates.
 */
async function createGuardedViews(
  tx: SessionTx,
  guarded: ReadonlyArray<GuardedSessionView>
): Promise<{
  degradedViewKeys: Set<string>;
  sourceGrants: GuardedSessionView["sourceGrant"][];
}> {
  const degradedViewKeys = new Set<string>();
  const sourceGrants: GuardedSessionView["sourceGrant"][] = [];
  for (const [i, view] of guarded.entries()) {
    const savepoint = `guarded_view_${i}`;
    await tx.execute(sql.raw(`SAVEPOINT ${savepoint}`));
    try {
      for (const statement of view.statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
      sourceGrants.push(view.sourceGrant);
    } catch (err) {
      const { code, message } = unwrapPgError(err);
      if (code === QUERY_CANCELED) throw err;
      await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
      for (const statement of view.fallback) {
        await tx.execute(sql.raw(statement));
      }
      degradedViewKeys.add(view.viewKey);
      logger.warn(
        { viewId: view.viewId, code, reason: message },
        "curated view filter_sql failed to apply; serving it empty"
      );
    }
  }
  return { degradedViewKeys, sourceGrants };
}

/** Postgres `query_canceled` (statement timeout, client cancel). */
const QUERY_CANCELED = "57014";

export interface PortalSqlParams {
  sql: string;
  stationId: string;
  organizationId: string;
  /**
   * The calling user — the session is built per-user via
   * `resolveViewsForSession` (#599), so the LLM SQL only ever sees the
   * curated views this user is granted. Required on every user-facing call
   * (agent `sql_query`, async SQL handle, analytics). The map-tile /
   * dissolve-precompute path (#643) also resolves per-user through
   * `resolveViewsForSession`, but builds tiles directly rather than via
   * `runSqlQuery`.
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
   * The caller's granted, readable curated views for a station — the single
   * source of "what data this user can see," shared by the SQL session
   * ({@link resolveViewsForSession}) and the introspection surfaces
   * (`buildStationContext` roster + the `station_context` tool) so the three
   * never drift. Returns the loaded {@link PermissionSet} (callers reuse it)
   * and, per granted view, the wide columns the caller may actually read —
   * effective projection minus hidden columns (#829: the view conveys it).
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

    // Resolve the caller's authorization once (roles → policies + grants).
    const roles = (await userRolesRepo.findEffectiveRoleNames(
      userId,
      organizationId,
      client
    )) as OrgRole[];
    const set = await PermissionService.loadSet(
      { userId, organizationId, roles },
      client
    );

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
    // #829: a view's read authority is the view grant itself.
    const grantedViews = attachedViews.filter((v) =>
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

      const columns = await this.resolveOneViewColumns(view, client);
      usedKeys.add(view.key);
      result.push({ view, columns });
    }

    return { set, views: result };
  }

  /**
   * The columns a caller reads through ONE curated view: its effective
   * projection (explicit field-mapping selection, or — when it has none — all
   * of the entity's live columns), minus hidden metadata. #829: the view
   * conveys its projection; reading the view is reading those columns. The
   * single source for the session build ({@link resolveGrantedViewColumns})
   * and the standalone detail/records endpoints ({@link resolveViewColumnsById}),
   * so the two can never drift.
   */
  private async resolveOneViewColumns(
    view: CuratedViewSelect,
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
        effectiveFmIds.has(c.fieldMappingId)
    );
  }

  /**
   * Single-view resolution for the detail/records endpoints — no station
   * scope. The view must be org-scoped and readable by the caller (`read
   * curated_view`). Returns `null`
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
    const readable = set.can("resource.read", {
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
    const columns = await this.resolveOneViewColumns(view, client);
    return { set, view, columns };
  }

  /**
   * A view's stored `FilterGroup` rendered to a safe, escaped inline WHERE
   * fragment (`renderFilterGroupToSql`), or `null` when the view has no
   * filter. The single render shared by every view-scoped reader — the SQL
   * session ({@link buildViewsForSession}), the detail records table
   * ({@link queryCuratedViewRecords}) and {@link queryViewRowsByColumn} — so
   * the three can't drift. A render failure throws `onError(message)`; each
   * caller keeps its own error code (fail closed — a stored filter must
   * always render). `columnTypes` may be passed when the caller already
   * resolved them.
   */
  private async renderViewFilterWhere(
    view: CuratedViewSelect,
    client: DbClient,
    onError: (message: string) => ApiError,
    columnTypes?: Parameters<typeof renderFilterGroupToSql>[2]
  ): Promise<string | null> {
    // #644: a SQL filter runs only inside the reader-role session, never on
    // the API role, and must never read as "no filter" (that would widen it).
    if (view.filterSql) {
      throw onError(
        "a SQL-filtered view is served only through the reader session"
      );
    }
    if (!view.filter) return null;
    const stmt = await this.deps.statementCache.get(
      view.connectorEntityId,
      client
    );
    const types =
      columnTypes ??
      Object.fromEntries(
        (await resolveColumns(view.connectorEntityId)).map((c) => [
          c.normalizedKey,
          c.type,
        ])
      );
    const rendered = renderFilterGroupToSql(view.filter, stmt, types);
    if (typeof rendered !== "string") throw onError(rendered.message);
    return rendered;
  }

  /**
   * The rows of ONE already-resolved granted view whose `match` column equals
   * a value (#658 — the `resolve_identity` read). Selects only `_record_id`,
   * `source_id` and the view's readable columns, under the org + soft-delete
   * guard and the view's own filter, ordered by record id and capped at
   * `limit` (`truncated` when more exist).
   *
   * Returns `null` when the match column is **not** among the view's readable
   * columns: filtering on a column the caller cannot read would be an oracle
   * for its values, so that view simply cannot answer the lookup. Identifiers
   * come from the statement cache and the value goes through `quoteLiteral`
   * (the same discipline as {@link queryCuratedViewRecords}).
   */
  async queryViewRowsByColumn(
    resolved: { view: CuratedViewSelect; columns: WideTableCachedColumn[] },
    organizationId: string,
    match: { normalizedKey: string; value: string },
    opts: { limit: number },
    client: DbClient = db
  ): Promise<{
    records: Record<string, unknown>[];
    truncated: boolean;
  } | null> {
    const { view, columns } = resolved;
    const matchCol = columns.find(
      (c) => c.normalizedKey === match.normalizedKey
    );
    if (!matchCol) return null;
    if (
      !UUID_RE.test(organizationId) ||
      !UUID_RE.test(view.connectorEntityId)
    ) {
      throw new ApiError(
        500,
        ApiCode.PORTAL_SQL_FORBIDDEN,
        `invalid id for view row lookup: ${view.id}`
      );
    }

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
      `w.${quoteIdent(matchCol.columnName)} = ${quoteLiteral(match.value)}`,
    ];
    const filterWhere = await this.renderViewFilterWhere(
      view,
      client,
      (message) =>
        new ApiError(
          500,
          ApiCode.PORTAL_SQL_FORBIDDEN,
          `curated view ${view.id} filter failed to render: ${message}`
        )
    );
    if (filterWhere) whereParts.push(`(${filterWhere})`);

    const limit = Math.max(0, Math.floor(opts.limit));
    const query =
      `SELECT ${selectList} FROM ${quoteIdent(`er__${view.connectorEntityId}`)} w ` +
      `WHERE ${whereParts.join(" AND ")} ` +
      `ORDER BY w."entity_record_id" LIMIT ${limit + 1}`;
    const rows = (await client.execute(sql.raw(query))) as unknown as Record<
      string,
      unknown
    >[];
    return {
      records: rows.slice(0, limit),
      truncated: rows.length > limit,
    };
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
      /** `created` (the record's creation time, the default, as on the
       *  entity records table) or a projected column's normalizedKey (#678).
       *  Anything else falls back to the stable record-id order: sort can never
       *  reach an un-projected column. An unsortable type (json, arrays) is
       *  refused. */
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      /** Case-insensitive substring match across the projected columns. */
      search?: string;
      /** #678: base64 FilterExpression over the readable projected columns. */
      filters?: string;
      /** #649: opaque keyset cursor. Takes precedence over `offset` when it
       *  decodes and was minted under the effective sort and walk. */
      cursor?: string;
      /** #649: walk the mirror ordering (the keyset last page). */
      reverse?: boolean;
    },
    client: DbClient = db
  ): Promise<{
    records: Record<string, unknown>[];
    total: number;
    columns: ResolvedColumn[];
    /** #649: cursor for the following page, or null at the end. */
    nextCursor: string | null;
  } | null> {
    const resolved = await this.resolveViewColumnsById(
      viewId,
      organizationId,
      userId,
      client
    );
    if (!resolved) return null;
    const { view, columns } = resolved;

    // Resolve the entity's columns once: reused for the returned column
    // metadata (below) and the filter render's column-type map (further down).
    const resolvedCols = await resolveColumns(view.connectorEntityId);
    // #678: the caller's readable projected columns as ResolvedColumns, in the
    // entity's field-mapping order (the order the entity records table uses).
    // This is the only column set used below: the response, the row keys and
    // the sort all come from it.
    const columnNameByKey = new Map(
      columns.map((c) => [c.normalizedKey, c.columnName])
    );
    const readable = resolvedCols.flatMap((c) => {
      const columnName = columnNameByKey.get(c.normalizedKey);
      return columnName ? [{ ...c, columnName }] : [];
    });

    const tableName = `er__${view.connectorEntityId}`;
    // #678: rows are keyed by normalizedKey (the table's header). The framing
    // keys start with `_`, which a normalizedKey (^[a-z][a-z0-9_]*$) can't, so
    // they never collide with a column.
    const selectList = [
      `w."entity_record_id" AS "_record_id"`,
      `w."source_id" AS "_source_id"`,
      ...readable.map(
        (c) => `w.${quoteIdent(c.columnName)} AS ${quoteIdent(c.normalizedKey)}`
      ),
    ].join(", ");

    const whereParts = [
      `w."organization_id" = ${quoteLiteral(organizationId)}`,
      `w."deleted" IS NULL`,
    ];
    const filterWhere = await this.renderViewFilterWhere(
      view,
      client,
      (message) =>
        new ApiError(500, ApiCode.CURATED_VIEW_INVALID_FILTER, message),
      Object.fromEntries(resolvedCols.map((c) => [c.normalizedKey, c.type]))
    );
    if (filterWhere) whereParts.push(`(${filterWhere})`);
    // #678: the reader's ad-hoc filter, ANDed after the view's own filter so it
    // can only narrow. It's validated against ONLY the readable projected
    // columns: `buildFilterSqlForEntity` resolves any column of the entity, so
    // this validation set is what keeps a filter off hidden columns (no value
    // oracle, the same rule as queryViewRowsByColumn). Fail-closed: anything
    // invalid is a 400 before a query runs.
    if (opts.filters) {
      const invalid = (message: string) =>
        new ApiError(400, ApiCode.CURATED_VIEW_INVALID_FILTER, message);
      const parsedFilter = parseFilterPayload(opts.filters, readable);
      if ("message" in parsedFilter) throw invalid(parsedFilter.message);
      const stmt = await this.deps.statementCache.get(
        view.connectorEntityId,
        client
      );
      const rendered = renderFilterGroupToSql(
        parsedFilter.expression,
        stmt,
        parsedFilter.columnTypes
      );
      if (typeof rendered !== "string") throw invalid(rendered.message);
      whereParts.push(`(${rendered})`);
    }
    // Search: case-insensitive **literal** substring across the caller's
    // readable projected **text** columns (string/enum/reference, #649). Only
    // those carry a trigram index, and one unindexed branch in the OR would
    // scan the whole table anyway; number and date cells are reached through
    // typed filters instead. No `::text` cast, so the index matches the bare
    // column. With no text column a search matches nothing rather than being
    // silently ignored. The LIKE metacharacters (\ % _) are escaped so the
    // term matches literally (ILIKE's default escape char is backslash), then
    // wrapped in %…%; quoteLiteral handles the SQL-quote escaping —
    // injection-safe.
    const search = opts.search?.trim();
    if (search) {
      const textColumns = readable.filter(
        (c) => pgTypeForColumnDefinitionType(c.type) === "text"
      );
      const escaped = search.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const term = quoteLiteral(`%${escaped}%`);
      const clauses = textColumns.map(
        (c) => `w.${quoteIdent(c.columnName)} ILIKE ${term}`
      );
      whereParts.push(
        clauses.length > 0 ? `(${clauses.join(" OR ")})` : "FALSE"
      );
    }
    const whereSql = whereParts.join(" AND ");
    const limit = Math.max(1, Math.min(opts.limit, 500));
    const offset = Math.max(0, opts.offset);

    // ORDER BY `created` or the requested projected column (by normalizedKey,
    // #678), always ending in a unique tiebreaker (#433: a paginated order
    // must be total). `created` is the record's creation time; it lives on
    // `entity_records`, not the wide table, so that sort joins it (scoped to
    // the entity, so the (connector_entity_id, created, id) index applies, and
    // its tiebreaker is `r.id` for the same reason). As on the entity records
    // endpoint, the system field wins over a column that happens to share the
    // name. A `sortBy` that names neither falls back to record-id order; one
    // naming an unsortable type is refused.
    const sortOrder = opts.sortOrder === "desc" ? "desc" : "asc";
    const byCreated = opts.sortBy === "created";
    const sortCol = byCreated
      ? undefined
      : readable.find((c) => c.normalizedKey === opts.sortBy);
    if (sortCol && !SORTABLE_COLUMN_TYPES.has(sortCol.type)) {
      throw new ApiError(
        400,
        ApiCode.CURATED_VIEW_INVALID_SORT,
        `Column "${sortCol.normalizedKey}" can't be sorted`
      );
    }
    // `key` is the sort a cursor is minted under: the request's, or
    // `_record_id` for the fallback (a normalizedKey can't start with `_`).
    // `exprSql` is a safe identifier reference (quoteIdent).
    const sortSpec: { key: string; exprSql: string; nullable: boolean } =
      byCreated
        ? { key: "created", exprSql: `r."created"`, nullable: false }
        : sortCol
          ? {
              key: sortCol.normalizedKey,
              exprSql: `w.${quoteIdent(sortCol.columnName)}`,
              // Every wide-table data column is nullable.
              nullable: true,
            }
          : {
              key: "_record_id",
              exprSql: `w."entity_record_id"`,
              nullable: false,
            };
    const sortExpr = sql.raw(sortSpec.exprSql);
    // The fallback sorts by the tiebreaker itself, so it must be the same
    // object (buildOrderByClause compares by identity and doesn't repeat it).
    const tiebreaker =
      sortSpec.key === "_record_id"
        ? sortExpr
        : sql.raw(byCreated ? `r."id"` : `w."entity_record_id"`);
    const sort = { ...sortSpec, expr: sortExpr, tiebreaker };

    // #649: keyset paging, as on the entity records endpoint. A cursor counts
    // only under the ordering it was minted in; anything else (another sort,
    // the other walk, a garbage token) serves the first page, never an error.
    // A reverse walk (the last page) orders by the exact mirror.
    const reverse = opts.reverse ?? false;
    const ordering = keysetOrdering(sortOrder, reverse);
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const decodedAnchor =
      decoded &&
      decoded.sortBy === sort.key &&
      decoded.sortOrder === sortOrder &&
      (decoded.reverse ?? false) === reverse
        ? decoded
        : null;
    // The anchor's value and id travel as bound parameters, never inlined.
    const seekFor = (anchor: typeof decodedAnchor) =>
      anchor
        ? sql` AND ${buildKeysetPredicate({
            column: sort.expr,
            value: anchor.value,
            id: anchor.id,
            nullable: sort.nullable,
            tiebreaker: sort.tiebreaker,
            ...ordering,
          })}`
        : sql``;
    const orderBy = buildOrderByClause({
      column: sort.expr,
      nullable: sort.nullable,
      tiebreaker: sort.tiebreaker,
      ...ordering,
    });
    // `r.deleted IS NULL` is what lets the planner use the partial
    // `(connector_entity_id, created, id) WHERE deleted IS NULL` index: without
    // it every `created` page seq-scanned both tables (measured on 400K rows:
    // 155ms vs 0.08ms for page one, the deep seek and the last page alike).
    const createdJoin = byCreated
      ? `  JOIN "entity_records" r ON r."id" = w."entity_record_id"` +
        ` AND r."connector_entity_id" = ${quoteLiteral(view.connectorEntityId)}` +
        ` AND r."deleted" IS NULL\n`
      : "";

    // One row past the page tells "a full page" from "a full page with more
    // behind it". `_sort_value` is what the next cursor is minted from; the
    // `_` prefix can't collide with a normalizedKey, and it's stripped below.
    const rowsQueryFor = (anchor: typeof decodedAnchor) =>
      sql`${sql.raw(
        `SELECT ${selectList}, ${sort.exprSql} AS "_sort_value"\n` +
          `  FROM ${quoteIdent(tableName)} w\n` +
          createdJoin +
          `  WHERE ${whereSql}`
      )}${seekFor(anchor)}${orderBy}${sql.raw(
        ` LIMIT ${limit + 1}` + (anchor ? "" : ` OFFSET ${offset}`)
      )}`;
    const countSql =
      `SELECT COUNT(*)::int AS n FROM ${quoteIdent(tableName)} w ` +
      `WHERE ${whereSql}`;

    // #649: the total comes through the entity's count cache. The scope holds
    // the view, its version and the caller's readable columns: search runs
    // over those, so two callers with different field grants can match
    // different counts and must never share one. Record writes bump the
    // entity's version; a view edit changes `updated`.
    const countFingerprint = EntityRecordCountCache.fingerprint({
      search: search ?? "",
      filters: opts.filters,
      viewScope: [
        view.id,
        view.updated ?? view.created,
        readable
          .map((c) => c.normalizedKey)
          .sort()
          .join(","),
      ].join(":"),
    });
    const cachedTotal = await EntityRecordCountCache.get(
      view.connectorEntityId,
      countFingerprint
    );

    const [rowsRes, total] = await Promise.all([
      // A cursor is client-supplied: a forged one can carry a value the sort
      // column's type rejects (`"abc"` for a number). That cursor doesn't fit
      // this ordering, so it serves the first page like any other misfit
      // rather than failing the request.
      client.execute(rowsQueryFor(decodedAnchor)).catch((error: unknown) => {
        if (!decodedAnchor || !isPgDataException(error)) throw error;
        logger.warn(
          { viewId, sortBy: sort.key, ...unwrapPgError(error) },
          "Curated view cursor value rejected by its sort column; serving the first page"
        );
        return client.execute(rowsQueryFor(null));
      }),
      cachedTotal !== null
        ? Promise.resolve(cachedTotal)
        : client.execute(sql.raw(countSql)).then(async (res) => {
            const n = Number(
              (res as unknown as Array<{ n: number }>)[0]?.n ?? 0
            );
            await EntityRecordCountCache.set(
              view.connectorEntityId,
              countFingerprint,
              n
            );
            return n;
          }),
    ]);
    const probed = rowsRes as unknown as Record<string, unknown>[];
    const hasMore = probed.length > limit;
    const pageRows = hasMore ? probed.slice(0, limit) : probed;
    const last = hasMore ? pageRows[pageRows.length - 1] : undefined;
    const anchorValue = last ? readViewSortValue(last._sort_value) : null;
    const nextCursor =
      last && anchorValue
        ? encodeCursor({
            sortBy: sort.key,
            sortOrder,
            ...(reverse ? { reverse: true } : {}),
            value: anchorValue.value,
            id: String(last._record_id),
          })
        : null;
    return {
      records: pageRows.map(({ _sort_value: _sortValue, ...row }) => row),
      total,
      nextCursor,
      columns: readable.map(({ columnName: _columnName, ...c }) => c),
    };
  }

  /**
   * Build the per-call temp-view set for a **user session** (#599) — the
   * per-user, curated-view-scoped view builder used by every SQL surface.
   *
   * The view set is the station's attached curated views (`station_views`)
   * intersected with the caller's `read curated_view:<id>` grants; each
   * emitted temp view is named by the view's `key`, projects the view's
   * effective projection (#829: reading the view conveys it), and ANDs the
   * view's stored `whereClause` after the org + soft-delete guard. The `_meta_*`
   * introspection views rebuild **per granted view**, so a member never
   * learns the name of a view/column they cannot query.
   *
   * Fail-closed: no readable views ⇒ empty data views (only the `_meta_*`
   * shells). This is what every user-facing SQL surface uses, and (#643) the
   * map-tile / dissolve-precompute pipeline now resolves per-user through it
   * too — so tile geometry is scoped to the viewer's own curated views.
   */
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
    const guardedViews: GuardedSessionView[] = [];
    const viewMap = new Map<string, string>();
    const grantedViewIds: string[] = [];
    // (viewKey, fieldMappingId) pairs feeding `_meta_columns`.
    const metaPairs: { viewKey: string; fieldMappingId: string }[] = [];
    // #644: a source view's name must not be any curated view's key in this
    // session, or it would replace that view (with unfiltered rows).
    const takenNames = new Set(grantedViewColumns.map(({ view }) => view.key));
    let sourceIndex = 0;
    const nextSourceName = () => {
      while (takenNames.has(`__src_${sourceIndex}`)) sourceIndex += 1;
      const name = `__src_${sourceIndex}`;
      takenNames.add(name);
      return name;
    };

    for (const { view, columns } of grantedViewColumns) {
      if (view.filterSql) {
        guardedViews.push(
          await this.buildGuardedView(
            view,
            columns,
            organizationId,
            nextSourceName(),
            client
          )
        );
        for (const c of columns) {
          metaPairs.push({
            viewKey: view.key,
            fieldMappingId: c.fieldMappingId,
          });
        }
        viewMap.set(view.key, view.key);
        grantedViewIds.push(view.id);
        continue;
      }
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
      const filterWhere = await this.renderViewFilterWhere(
        view,
        client,
        (message) =>
          new ApiError(
            500,
            ApiCode.PORTAL_SQL_FORBIDDEN,
            `curated view ${view.id} filter failed to render: ${message}`
          )
      );
      if (filterWhere) whereParts.push(`(${filterWhere})`);

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
    // `*`); a member session omits it so the catalog never leaks. #832: a
    // class-level check, so a member's conditional `created_by_system` read
    // doesn't widen it to the whole catalog.
    if (set.can("resource.read", { type: "column_definition" })) {
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

    return { views, viewMap, guardedViews };
  }

  /**
   * #644: the session pair for a SQL-filtered view. The stored fragment is
   * re-validated and spliced onto the entity's current columns here; if it no
   * longer renders, the view is created empty (fail closed) rather than
   * failing the whole session.
   */
  private async buildGuardedView(
    view: CuratedViewSelect,
    columns: WideTableCachedColumn[],
    organizationId: string,
    sourceName: string,
    client: DbClient
  ): Promise<GuardedSessionView> {
    const stmt = await this.deps.statementCache.get(
      view.connectorEntityId,
      client
    );
    const columnNameByKey = new Map(
      stmt.columns.map((c) => [c.normalizedKey, c.columnName])
    );
    const args = {
      viewId: view.id,
      viewKey: view.key,
      sourceName,
      connectorEntityId: view.connectorEntityId,
      organizationId,
      projectedColumns: columns.map((c) => c.columnName),
    };
    try {
      const { keys } = validateViewFilterSql(
        view.filterSql!,
        new Set(columnNameByKey.keys())
      );
      return buildGuardedViewStatements({
        ...args,
        filterColumns: keys.map((k) => columnNameByKey.get(k)!),
        renderedWhere: renderViewFilterSql(view.filterSql!, columnNameByKey),
      });
    } catch (err) {
      logger.warn(
        { viewId: view.id, reason: err instanceof Error ? err.message : err },
        "curated view filter_sql failed to render; serving it empty"
      );
      // FALSE is a valid fragment; the source view carries nothing extra.
      return buildGuardedViewStatements({
        ...args,
        filterColumns: [],
        renderedWhere: "FALSE",
      });
    }
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
    const { cleaned, needsImplicitLimit, relations } = validatePortalSql(
      params.sql
    );

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
    // #660: the statement may reference only this session's views (the
    // caller's granted curated views + the _meta_* views it emitted). Checked
    // before the txn — nothing reaches Postgres otherwise.
    assertRelationsAllowed(relations, build);
    // #660: refuse (503) rather than run as the API's role.
    await PortalSqlReaderRoleService.assertUsable();

    try {
      await db.transaction(async (tx) => {
        // #660: views, then the reader role, then read-only. From here the
        // gate-passed LLM SQL can read only this session's views.
        await openSqlSession(tx, build, { statementTimeoutMs });

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
              sql.raw(
                `SELECT count(*)::bigint AS n FROM (${fenceSql(cleaned)}) _c`
              )
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
    const { cleaned, needsImplicitLimit, relations } = validatePortalSql(
      params.sql
    );
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
    // #660: the statement may reference only this session's views (the
    // caller's granted curated views + the _meta_* views it emitted). Checked
    // before the txn — nothing reaches Postgres otherwise.
    assertRelationsAllowed(relations, build);
    await PortalSqlReaderRoleService.assertUsable();

    try {
      await db.transaction(async (tx) => {
        await openSqlSession(tx, build, {
          statementTimeoutMs: STATEMENT_TIMEOUT_MS,
        });

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
 *   - `42703` (#727) → `PORTAL_SQL_FORBIDDEN` with an "unknown column: <name>"
 *     message. A column the view doesn't expose to the caller (dropped from
 *     its projection, or hidden by their grants) is indistinguishable from
 *     one that doesn't exist, the sibling of 42P01.
 *
 * 42P01 and 42703 carry `details.reason: "stale_reference"`, so a caller can
 * tell "this query names something the caller's views don't expose" from any
 * other refusal without matching on the wording (widget refresh does).
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
      `unknown entity: ${missing}`,
      { reason: STALE_REFERENCE }
    );
  }
  if (code === "42703") {
    // #727: a column the view doesn't expose to this caller (dropped from the
    // projection, or hidden by their grants) is indistinguishable from one
    // that doesn't exist, the sibling of 42P01's "unknown entity".
    const match =
      /column "([^"]+)" does not exist/i.exec(message) ??
      /column (.+?) does not exist/i.exec(message);
    const missing = match?.[1] ?? "(unknown column)";
    return new ApiError(
      400,
      ApiCode.PORTAL_SQL_FORBIDDEN,
      `unknown column: ${missing}`,
      { reason: STALE_REFERENCE }
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
