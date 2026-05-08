/**
 * Wide-table reconciler service.
 *
 * The single code path that emits DDL against the dynamic
 * `er__<connector_entity_id>` tables. Driven by `field_mappings` +
 * `column_definitions` (source of truth) and the
 * `wide_table_columns` metadata catalog (record of what's been
 * applied).
 *
 * Public surface:
 *   - `ensureTable(entityId, client?)`         — create the empty
 *                                                 wide table if absent
 *   - `reconcileEntity(entityId, client?)`     — diff + apply for one entity
 *   - `reconcileAll()`                         — boot drift check
 *   - `dropTable(entityId, client?)`           — test cleanup helper
 *
 * Phase 1: detect-and-refuse on type changes; retire columns are NOT
 * physically dropped (`retired_at` is set, the Postgres column stays
 * on disk). Phase 5 introduces staged type changes and the column-drop
 * maintenance job.
 */

import { sql } from "drizzle-orm";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import {
  withEntityLock,
} from "../db/advisory-lock.util.js";
import { db } from "../db/client.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import {
  wideTableColumnsRepo,
  type WideTableColumnsRepository,
} from "../db/repositories/wide-table-columns.repository.js";
import {
  fieldMappingsRepo,
  type FieldMappingsRepository,
} from "../db/repositories/field-mappings.repository.js";
import {
  columnDefinitionsRepo,
  type ColumnDefinitionsRepository,
} from "../db/repositories/column-definitions.repository.js";
import {
  connectorEntitiesRepo,
  type ConnectorEntitiesRepository,
} from "../db/repositories/connector-entities.repository.js";
import {
  wideTableStatementCache,
  type WideTableStatementCache,
} from "./wide-table-statement.cache.js";
import {
  wideTableRepo,
  type WideTableRepository,
} from "../db/repositories/wide-table.repository.js";
import type { ColumnDataType } from "@portalai/core/models";

const logger = createLogger({ module: "wide-table-reconciler" });

// ── Type mapping ─────────────────────────────────────────────────────

/** Map a `column_definitions.type` to the Postgres column type used in `er__<id>`. */
export function pgTypeForColumnDefinitionType(type: ColumnDataType): string {
  switch (type) {
    case "string":
    case "enum":
    case "reference":
      return "text";
    case "number":
      return "numeric";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "timestamptz";
    case "reference-array":
      return "text[]";
    case "array":
    case "json":
      return "jsonb";
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return "text";
    }
  }
}

// ── Sanitiser ────────────────────────────────────────────────────────

/**
 * Convert `normalized_key` into a safe Postgres column name.
 *
 * Rules:
 *   - lowercase
 *   - non-alphanumeric → `_`
 *   - prefix `c_` to avoid reserved words and ensure leading letter
 *   - on collision with `taken`, suffix `_2`, `_3`, …
 */
export function sanitizeColumnName(
  normalizedKey: string,
  taken: ReadonlySet<string>
): string {
  const base = `c_${normalizedKey
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
  if (!taken.has(base)) return base;

  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ── Diff types ───────────────────────────────────────────────────────

interface DesiredColumn {
  fieldMappingId: string;
  columnDefinitionId: string;
  normalizedKey: string;
  pgType: string;
  organizationId: string;
}

interface DiffResult {
  adds: DesiredColumn[];
  retires: { id: string; columnName: string }[];
  typeChanges: {
    fieldMappingId: string;
    columnName: string;
    actualPgType: string;
    desiredPgType: string;
  }[];
}

// ── Service ─────────────────────────────────────────────────────────

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export class WideTableReconcilerService {
  constructor(
    private readonly columnsRepo: WideTableColumnsRepository = wideTableColumnsRepo,
    private readonly fieldMappingsRepo_: FieldMappingsRepository = fieldMappingsRepo,
    private readonly columnDefinitionsRepo_: ColumnDefinitionsRepository = columnDefinitionsRepo,
    private readonly connectorEntitiesRepo_: ConnectorEntitiesRepository = connectorEntitiesRepo,
    private readonly wideTableRepo_: WideTableRepository = wideTableRepo,
    private readonly statementCache: WideTableStatementCache = wideTableStatementCache
  ) {}

  /** Create the empty `er__<entityId>` table if it does not exist. Idempotent. */
  async ensureTable(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<void> {
    await withEntityLock(client, connectorEntityId, async (tx) => {
      const tableName = quoteIdent(this.wideTableRepo_.tableName(connectorEntityId));
      await (tx as typeof db).execute(
        sql.raw(
          `CREATE TABLE IF NOT EXISTS ${tableName} (` +
            `"entity_record_id" text PRIMARY KEY ` +
            `REFERENCES "entity_records"("id") ON DELETE CASCADE, ` +
            `"organization_id" text NOT NULL, ` +
            `"synced_at" bigint NOT NULL, ` +
            `"is_valid" boolean NOT NULL` +
            `)`
        )
      );
      await (tx as typeof db).execute(
        sql.raw(
          `CREATE INDEX IF NOT EXISTS ${quoteIdent(
            `er__${connectorEntityId}__org_idx`
          )} ON ${tableName} ("organization_id")`
        )
      );
    });
  }

  /**
   * Reconcile one entity: ensure the table exists, diff desired vs.
   * actual columns, apply adds and retires. Refuses on type changes.
   */
  async reconcileEntity(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<void> {
    await this.ensureTable(connectorEntityId, client);

    const desired = await this.computeDesired(connectorEntityId, client);
    const actual = await this.columnsRepo.findByConnectorEntityId(
      connectorEntityId,
      { includeRetired: true },
      client
    );

    const diff = this.computeDiff(desired, actual);

    if (diff.typeChanges.length > 0) {
      const summary = diff.typeChanges
        .map(
          (t) =>
            `field_mapping=${t.fieldMappingId} column=${t.columnName} ` +
            `actual=${t.actualPgType} desired=${t.desiredPgType}`
        )
        .join("; ");
      logger.error(
        { connectorEntityId, typeChanges: diff.typeChanges },
        "Refusing reconciler type change"
      );
      throw new ApiError(
        422,
        ApiCode.WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED,
        `Wide-table type change not supported in phase 1 — entity=${connectorEntityId}: ${summary}`
      );
    }

    if (diff.adds.length === 0 && diff.retires.length === 0) {
      return;
    }

    await withEntityLock(client, connectorEntityId, async (tx) => {
      await this.applyAdds(connectorEntityId, diff.adds, actual, tx);
      await this.applyRetires(diff.retires, tx);
      this.statementCache.invalidate(connectorEntityId);
    });
  }

  /**
   * Boot drift check: reconcile every live connector entity. Throws on
   * the first failure; the caller (app bootstrap) refuses to start.
   */
  async reconcileAll(): Promise<{ reconciled: number; skipped: number }> {
    const entities = await this.connectorEntitiesRepo_.findMany(undefined, {});

    let reconciled = 0;
    let skipped = 0;
    for (const entity of entities) {
      if ((entity as { deleted: number | null }).deleted !== null) {
        skipped++;
        continue;
      }
      await this.reconcileEntity((entity as { id: string }).id);
      reconciled++;
    }
    return { reconciled, skipped };
  }

  /**
   * Hard-drop the `er__<entityId>` table and its metadata rows.
   * Phase-1 caller: tests only.
   */
  async dropTable(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<void> {
    const tableName = quoteIdent(
      this.wideTableRepo_.tableName(connectorEntityId)
    );
    await (client as typeof db).execute(
      sql.raw(`DROP TABLE IF EXISTS ${tableName} CASCADE`)
    );
    // Clear metadata catalog for that entity (hard delete — safe in phase 1).
    const rows = await this.columnsRepo.findByConnectorEntityId(
      connectorEntityId,
      { includeRetired: true },
      client
    );
    for (const r of rows) {
      await this.columnsRepo.hardDelete(r.id, client);
    }
    this.statementCache.invalidate(connectorEntityId);
  }

  // ── Internals ───────────────────────────────────────────────────

  private async computeDesired(
    connectorEntityId: string,
    client: DbClient
  ): Promise<DesiredColumn[]> {
    const mappings =
      await this.fieldMappingsRepo_.findByConnectorEntityId(
        connectorEntityId,
        client
      );
    if (mappings.length === 0) return [];

    const colDefIds = [...new Set(mappings.map((m) => m.columnDefinitionId))];
    const colDefs = await Promise.all(
      colDefIds.map((id) =>
        this.columnDefinitionsRepo_.findById(id, client)
      )
    );
    const colDefMap = new Map(
      colDefs
        .filter((cd): cd is NonNullable<typeof cd> => cd != null)
        .map((cd) => [cd.id, cd])
    );

    return mappings
      .map((m): DesiredColumn | null => {
        const cd = colDefMap.get(m.columnDefinitionId);
        if (!cd) return null;
        return {
          fieldMappingId: m.id,
          columnDefinitionId: m.columnDefinitionId,
          normalizedKey: m.normalizedKey,
          pgType: pgTypeForColumnDefinitionType(cd.type as ColumnDataType),
          organizationId: m.organizationId,
        };
      })
      .filter((d): d is DesiredColumn => d !== null);
  }

  private computeDiff(
    desired: DesiredColumn[],
    actual: Array<{
      id: string;
      fieldMappingId: string;
      columnName: string;
      pgType: string;
      retiredAt: number | null;
    }>
  ): DiffResult {
    const actualByMapping = new Map(actual.map((a) => [a.fieldMappingId, a]));
    const desiredByMapping = new Map(desired.map((d) => [d.fieldMappingId, d]));

    const adds: DesiredColumn[] = [];
    const retires: { id: string; columnName: string }[] = [];
    const typeChanges: DiffResult["typeChanges"] = [];

    // Adds: in desired and either missing from actual OR previously retired.
    for (const d of desired) {
      const a = actualByMapping.get(d.fieldMappingId);
      if (!a) {
        adds.push(d);
        continue;
      }
      if (a.retiredAt !== null) {
        // Retired then re-introduced — phase 1 treats this as a type
        // change candidate; if types match, callers must un-retire
        // explicitly. We refuse for now (rare path; punted to phase 5).
        if (a.pgType !== d.pgType) {
          typeChanges.push({
            fieldMappingId: d.fieldMappingId,
            columnName: a.columnName,
            actualPgType: a.pgType,
            desiredPgType: d.pgType,
          });
        }
        // else: silently ignored — same column, will continue to be retired.
        continue;
      }
      if (a.pgType !== d.pgType) {
        typeChanges.push({
          fieldMappingId: d.fieldMappingId,
          columnName: a.columnName,
          actualPgType: a.pgType,
          desiredPgType: d.pgType,
        });
      }
    }

    // Retires: in actual (and not retired) and missing from desired.
    for (const a of actual) {
      if (a.retiredAt !== null) continue;
      if (!desiredByMapping.has(a.fieldMappingId)) {
        retires.push({ id: a.id, columnName: a.columnName });
      }
    }

    return { adds, retires, typeChanges };
  }

  private async applyAdds(
    connectorEntityId: string,
    adds: DesiredColumn[],
    actual: Array<{ columnName: string }>,
    tx: DbClient
  ): Promise<void> {
    if (adds.length === 0) return;

    const tableName = quoteIdent(
      this.wideTableRepo_.tableName(connectorEntityId)
    );
    const taken = new Set(actual.map((a) => a.columnName));
    const now = Date.now();
    const actor = SystemUtilities.id.system;

    for (const add of adds) {
      const columnName = sanitizeColumnName(add.normalizedKey, taken);
      taken.add(columnName);

      // ALTER TABLE ADD COLUMN — metadata-only when the column is nullable.
      await (tx as typeof db).execute(
        sql.raw(
          `ALTER TABLE ${tableName} ADD COLUMN ${quoteIdent(columnName)} ${add.pgType}`
        )
      );
      await this.columnsRepo.create(
        {
          id: SystemUtilities.id.v4.generate(),
          organizationId: add.organizationId,
          connectorEntityId,
          fieldMappingId: add.fieldMappingId,
          columnDefinitionId: add.columnDefinitionId,
          columnName,
          pgType: add.pgType,
          retiredAt: null,
          created: now,
          createdBy: actor,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never,
        tx
      );
    }
  }

  private async applyRetires(
    retires: { id: string; columnName: string }[],
    tx: DbClient
  ): Promise<void> {
    if (retires.length === 0) return;
    const now = Date.now();
    const actor = SystemUtilities.id.system;
    for (const r of retires) {
      await this.columnsRepo.markRetired(r.id, now, actor, tx);
    }
  }
}

/** Process-wide singleton. */
export const wideTableReconcilerService = new WideTableReconcilerService();
