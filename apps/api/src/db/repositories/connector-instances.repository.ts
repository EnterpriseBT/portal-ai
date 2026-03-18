/**
 * Repository for the `connector_instances` table.
 *
 * Extends the generic {@link Repository} with instance-specific queries
 * and transparent encryption/decryption of the `credentials` column.
 */

import { eq, and } from "drizzle-orm";
import { connectorInstances } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  ConnectorInstanceSelect,
  ConnectorInstanceInsert,
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
    credentials: row.credentials
      ? decryptCredentials(row.credentials)
      : null,
  };
}

/** Decrypt credentials on an array of rows. */
function decryptRows<T extends { credentials: string | null }>(
  rows: T[]
): (T & { credentials: Record<string, unknown> | null })[] {
  return rows.map(decryptRow);
}

/** Encrypt plain-text credentials into the format stored in the DB. */
function encryptInsert<T extends { credentials?: string | null }>(
  data: T
): T {
  if (
    data.credentials != null &&
    typeof data.credentials === "object"
  ) {
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
    where?: import("drizzle-orm").SQL,
    opts?: import("./base.repository.js").ListOptions,
    client?: DbClient
  ): Promise<ConnectorInstanceSelect[]> {
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
          eq(
            connectorInstances.connectorDefinitionId,
            connectorDefinitionId
          ),
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
          eq(
            connectorInstances.connectorDefinitionId,
            connectorDefinitionId
          ),
          this.notDeleted()
        )
      );
    return decryptRows(rows);
  }
}

/** Singleton instance. */
export const connectorInstancesRepo = new ConnectorInstancesRepository();
