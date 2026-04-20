/**
 * Repository for the `connector_instances` table.
 *
 * Extends the generic {@link Repository} with instance-specific queries
 * and transparent encryption/decryption of the `credentials` column.
 */

import {
  eq,
  and,
  asc,
  desc,
  getTableColumns,
  inArray,
  isNull,
  type SQL,
} from "drizzle-orm";
import {
  connectorInstances,
  connectorInstanceLayoutPlans,
} from "../schema/index.js";
import { connectorDefinitions } from "../schema/index.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";

export interface ConnectorInstanceListOptions extends ListOptions {
  include?: string[];
}
import type {
  ConnectorInstanceSelect,
  ConnectorInstanceInsert,
  ConnectorDefinitionSelect,
} from "../schema/zod.js";
import {
  encryptCredentials,
  decryptCredentials,
} from "../../utils/crypto.util.js";

// ── Helpers ────────────────────────────────────────────────────────

/** Decrypt the `credentials` column of a single row (if present). */
function decryptRow<T extends { credentials: string | null }>(
  row: T
): T & { credentials: Record<string, unknown> | null } {
  return {
    ...row,
    credentials: row.credentials ? decryptCredentials(row.credentials) : null,
  };
}

/** Decrypt credentials on an array of rows. */
function decryptRows<T extends { credentials: string | null }>(
  rows: T[]
): (T & { credentials: Record<string, unknown> | null })[] {
  return rows.map(decryptRow);
}

/** Encrypt plain-text credentials into the format stored in the DB. */
function encryptInsert<T extends { credentials?: string | null }>(data: T): T {
  if (data.credentials != null && typeof data.credentials === "object") {
    return {
      ...data,
      credentials: encryptCredentials(
        data.credentials as unknown as Record<string, unknown>
      ),
    };
  }
  return data;
}

// ── Repository ────────────────────────────────────────────────────

export class ConnectorInstancesRepository extends Repository<
  typeof connectorInstances,
  ConnectorInstanceSelect,
  ConnectorInstanceInsert
> {
  constructor() {
    super(connectorInstances);
  }

  // ── Overrides: encrypt on write, decrypt on read ────────────

  override async findById(
    id: string,
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect | undefined> {
    const row = await super.findById(id, client);
    return row ? decryptRow(row) : undefined;
  }

  override async findMany(
    where?: SQL,
    opts: ConnectorInstanceListOptions = {},
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect[]> {
    if (opts.include?.includes("connectorDefinition")) {
      return this.findManyWithDefinition(
        where,
        opts,
        client
      ) as unknown as ConnectorInstanceSelect[];
    }
    const rows = await super.findMany(where, opts, client);
    return decryptRows(rows);
  }

  override async create(
    data: ConnectorInstanceInsert,
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect> {
    const row = await super.create(encryptInsert(data), client);
    return decryptRow(row);
  }

  override async update(
    id: string,
    data: Partial<ConnectorInstanceInsert>,
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect | undefined> {
    const row = await super.update(id, encryptInsert(data), client);
    return row ? decryptRow(row) : undefined;
  }

  override async upsert(
    data: ConnectorInstanceInsert,
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect> {
    const row = await super.upsert(encryptInsert(data), client);
    return decryptRow(row);
  }

  // ── Join queries ─────────────────────────────────────────────

  /** Row shape returned by the LEFT JOIN query. */

  /**
   * Return instances with their associated connector definition attached.
   * Uses a LEFT JOIN so instances are returned even if the definition is missing.
   */
  async findManyWithDefinition(
    where: SQL | undefined,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<
    (ConnectorInstanceSelect & {
      connectorDefinition: ConnectorDefinitionSelect | null;
    })[]
  > {
    const conditions = this.withSoftDelete(where, opts.includeDeleted);

    let query = (client as typeof db)
      .select({
        instance: getTableColumns(connectorInstances),
        definition: getTableColumns(connectorDefinitions),
      })
      .from(connectorInstances)
      .leftJoin(
        connectorDefinitions,
        eq(connectorInstances.connectorDefinitionId, connectorDefinitions.id)
      )
      .where(conditions)
      .$dynamic();

    if (opts.orderBy) {
      const orderFn = opts.orderBy.direction === "desc" ? desc : asc;
      query = query.orderBy(orderFn(opts.orderBy.column));
    }
    if (opts.limit !== undefined) query = query.limit(opts.limit);
    if (opts.offset !== undefined) query = query.offset(opts.offset);

    const rows = await query;

    return rows.map((row) => {
      const decrypted = decryptRow(row.instance);
      return {
        ...decrypted,
        connectorDefinition: row.definition,
      };
    });
  }

  // ── Custom queries ──────────────────────────────────────────

  /** Find all instances for a given organization. */
  async findByOrganizationId(
    organizationId: string,
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect[]> {
    const rows = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(connectorInstances.organizationId, organizationId),
          this.notDeleted()
        )
      );
    return decryptRows(rows);
  }

  /** Find all instances of a given connector definition. */
  async findByConnectorDefinitionId(
    connectorDefinitionId: string,
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect[]> {
    const rows = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(connectorInstances.connectorDefinitionId, connectorDefinitionId),
          this.notDeleted()
        )
      );
    return decryptRows(rows);
  }

  /** Find a specific instance by org + definition + name. */
  async findByOrgDefinitionAndName(
    organizationId: string,
    connectorDefinitionId: string,
    name: string,
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect | undefined> {
    const rows = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(connectorInstances.organizationId, organizationId),
          eq(connectorInstances.connectorDefinitionId, connectorDefinitionId),
          eq(connectorInstances.name, name),
          this.notDeleted()
        )
      )
      .limit(1);
    return rows[0] ? decryptRow(rows[0]) : undefined;
  }

  /**
   * Soft-delete a connector instance and cascade to its layout plan rows.
   *
   * Runs both updates in the same transaction so a failure on either side
   * leaves state untouched. Plan rows that are already soft-deleted or
   * belong to an already-deleted instance are no-ops.
   */
  override async softDelete(
    id: string,
    deletedBy: string,
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect | undefined> {
    const run = async (
      tx: DbClient
    ): Promise<ConnectorInstanceSelect | undefined> => {
      const row = await Repository.prototype.softDelete.call(
        this,
        id,
        deletedBy,
        tx
      );
      if (row) await this.cascadeSoftDeleteLayoutPlans([id], deletedBy, tx);
      return row as ConnectorInstanceSelect | undefined;
    };
    if (client !== db) return run(client);
    return Repository.transaction((tx) => run(tx));
  }

  /**
   * Soft-delete many connector instances and cascade to their layout plans.
   * Transactional across both tables.
   */
  override async softDeleteMany(
    ids: string[],
    deletedBy: string,
    client: DbClient = db
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const run = async (tx: DbClient): Promise<number> => {
      const affected = await Repository.prototype.softDeleteMany.call(
        this,
        ids,
        deletedBy,
        tx
      );
      if (affected > 0)
        await this.cascadeSoftDeleteLayoutPlans(ids, deletedBy, tx);
      return affected;
    };
    if (client !== db) return run(client);
    return Repository.transaction((tx) => run(tx));
  }

  /** Internal: soft-delete every layout plan belonging to the given instances. */
  private async cascadeSoftDeleteLayoutPlans(
    connectorInstanceIds: string[],
    deletedBy: string,
    client: DbClient
  ): Promise<void> {
    const now = Date.now();
    await (client as typeof db)
      .update(connectorInstanceLayoutPlans)
      .set({ deleted: now, deletedBy })
      .where(
        and(
          inArray(
            connectorInstanceLayoutPlans.connectorInstanceId,
            connectorInstanceIds
          ),
          isNull(connectorInstanceLayoutPlans.deleted)
        )
      );
  }

  /** Find a specific instance by org + definition (useful for unique checks). */
  async findByOrgAndDefinition(
    organizationId: string,
    connectorDefinitionId: string,
    client: DbClient = db
  ): Promise<ConnectorInstanceSelect[]> {
    const rows = await (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(connectorInstances.organizationId, organizationId),
          eq(connectorInstances.connectorDefinitionId, connectorDefinitionId),
          this.notDeleted()
        )
      );
    return decryptRows(rows);
  }
}

/** Singleton instance. */
export const connectorInstancesRepo = new ConnectorInstancesRepository();
