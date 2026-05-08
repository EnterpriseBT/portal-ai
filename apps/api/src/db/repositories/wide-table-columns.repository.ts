/**
 * Repository for the `wide_table_columns` metadata table.
 *
 * The reconciler is the only writer; this repo exposes the read paths
 * the reconciler and the statement cache need plus a single targeted
 * update (`markRetired`) used when a source field-mapping is
 * soft-deleted.
 */

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { wideTableColumns } from "../schema/index.js";
import type {
  WideTableColumnSelect,
  WideTableColumnInsert,
} from "../schema/zod.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";

export interface FindByConnectorEntityIdOptions {
  /** When true, retired rows are included in the result. Default: false. */
  includeRetired?: boolean;
}

export class WideTableColumnsRepository extends Repository<
  typeof wideTableColumns,
  WideTableColumnSelect,
  WideTableColumnInsert
> {
  constructor() {
    super(wideTableColumns);
  }

  /**
   * Live (non-soft-deleted) wide-table-column rows for an entity, ordered
   * by `created` ascending — the order the reconciler applied them, which
   * the statement cache relies on for deterministic SELECT/INSERT shapes.
   */
  async findByConnectorEntityId(
    connectorEntityId: string,
    opts: FindByConnectorEntityIdOptions = {},
    client: DbClient = db
  ): Promise<WideTableColumnSelect[]> {
    const conditions = [
      eq(wideTableColumns.connectorEntityId, connectorEntityId),
      isNull(wideTableColumns.deleted),
    ];
    if (!opts.includeRetired) {
      conditions.push(isNull(wideTableColumns.retiredAt));
    }

    return (await (client as typeof db)
      .select()
      .from(wideTableColumns)
      .where(and(...conditions))
      .orderBy(
        asc(wideTableColumns.created),
        asc(wideTableColumns.id)
      )) as WideTableColumnSelect[];
  }

  /** Retired (but not yet hard-dropped) rows for an entity. */
  async findRetiredByConnectorEntityId(
    connectorEntityId: string,
    client: DbClient = db
  ): Promise<WideTableColumnSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(wideTableColumns)
      .where(
        and(
          eq(wideTableColumns.connectorEntityId, connectorEntityId),
          isNull(wideTableColumns.deleted),
          isNotNull(wideTableColumns.retiredAt)
        )
      )) as WideTableColumnSelect[];
  }

  /**
   * Set `retired_at` and bump `updated`. Used by the reconciler when
   * a source field-mapping is soft-deleted but the Postgres column
   * stays on disk.
   */
  async markRetired(
    id: string,
    retiredAt: number,
    actor: string,
    client: DbClient = db
  ): Promise<WideTableColumnSelect | undefined> {
    const [row] = await (client as typeof db)
      .update(wideTableColumns)
      .set({
        retiredAt,
        updated: Date.now(),
        updatedBy: actor,
      } as never)
      .where(
        and(
          eq(wideTableColumns.id, id),
          isNull(wideTableColumns.deleted)
        )
      )
      .returning();
    return row as WideTableColumnSelect | undefined;
  }
}

export const wideTableColumnsRepo = new WideTableColumnsRepository();
