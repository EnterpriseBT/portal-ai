/**
 * Generic access layer for the dynamic per-connector-entity wide tables
 * (`er__<connector_entity_id>`).
 *
 * Phase 1 surface: `tableName(connectorEntityId)` — the canonical name
 * lookup shared with the reconciler — and `selectAll`, used by the
 * reconciler's tests to verify that a table exists with the expected
 * shape. Sync-write methods (`upsertMany`, etc.) land in phase 2.
 *
 * The wide tables themselves are *not* declared in Drizzle's static
 * schema — they are created at runtime by the reconciler. Every read
 * here therefore goes through `client.execute(sql.raw(...))` with
 * identifiers built from the cache (and ultimately from
 * `wide_table_columns`, which is the source of truth for column names
 * and types).
 */

import { sql } from "drizzle-orm";

import { db } from "../client.js";
import type { DbClient } from "./base.repository.js";
import {
  wideTableStatementCache,
  type WideTableStatementCache,
} from "../../services/wide-table-statement.cache.js";

export class WideTableRepository {
  constructor(
    private readonly statementCache: WideTableStatementCache = wideTableStatementCache
  ) {}

  /** Canonical wide-table name for a connector entity. */
  tableName(connectorEntityId: string): string {
    return `er__${connectorEntityId}`;
  }

  /**
   * Read every live row from the entity's wide table.
   *
   * Phase 1 caller: reconciler self-tests. Phase 3+ will use a
   * narrower projection / filter API.
   */
  async selectAll(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<Record<string, unknown>[]> {
    const stmt = await this.statementCache.get(connectorEntityId, client);
    const result = await (client as typeof db).execute(
      sql.raw(stmt.selectAllSql)
    );
    return result as unknown as Record<string, unknown>[];
  }
}

export const wideTableRepo = new WideTableRepository();
