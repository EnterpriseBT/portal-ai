/**
 * Repository for the `organization_toolpacks` table.
 *
 * Each row is a custom toolpack registered by an organization. The
 * cached `tools` and `metadata` columns are populated by the
 * `ToolpackRegistrationService` at registration and on explicit
 * refresh.
 *
 * `findManyByIds` is used by `tools.service` at session-build time
 * to expand custom rows in `station_toolpacks` into actual
 * `WebhookTool` instances.
 *
 * The `auth_headers` column is stored as an opaque AES-256-GCM
 * ciphertext blob (see `utils/crypto.util.ts`). Every read path on
 * this repository decrypts the column transparently so callers
 * continue to see a plaintext `Record<string, string> | null` map;
 * every write path encrypts before insert/update. Repository users
 * never call `encryptCredentials` / `decryptCredentials` directly.
 */

import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";

import { organizationToolpacks } from "../schema/index.js";
import type {
  OrganizationToolpackSelect,
  OrganizationToolpackInsert,
} from "../schema/zod.js";
import { db } from "../client.js";
import {
  Repository,
  type DbClient,
  type ListOptions,
} from "./base.repository.js";
import {
  encryptCredentials,
  decryptCredentials,
} from "../../utils/crypto.util.js";

// ── Helpers ────────────────────────────────────────────────────────

/** Decrypt the `authHeaders` column of a single row (if present). */
function decryptRow<T extends { authHeaders: string | null }>(
  row: T
): T & { authHeaders: Record<string, string> | null } {
  return {
    ...row,
    authHeaders: row.authHeaders
      ? (decryptCredentials(row.authHeaders) as Record<string, string>)
      : null,
  };
}

/** Decrypt authHeaders on an array of rows. */
function decryptRows<T extends { authHeaders: string | null }>(
  rows: T[]
): (T & { authHeaders: Record<string, string> | null })[] {
  return rows.map(decryptRow);
}

/**
 * Encrypt a plaintext authHeaders map into the format stored in the DB.
 *
 * Accepts `Record<string, string> | string | null` so partial updates
 * that omit `authHeaders` typecheck cleanly: when the caller leaves
 * the field undefined or already-encrypted, we don't re-encrypt.
 */
function encryptInsert<
  T extends { authHeaders?: Record<string, string> | string | null }
>(data: T): T {
  if (data.authHeaders != null && typeof data.authHeaders === "object") {
    return {
      ...data,
      authHeaders: encryptCredentials(
        data.authHeaders as Record<string, unknown>
      ),
    } as T;
  }
  return data;
}

// ── Repository ────────────────────────────────────────────────────

export class OrganizationToolpacksRepository extends Repository<
  typeof organizationToolpacks,
  OrganizationToolpackSelect,
  OrganizationToolpackInsert
> {
  constructor() {
    super(organizationToolpacks);
  }

  // ── Overrides: encrypt on write, decrypt on read ────────────

  override async findById(
    id: string,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect | undefined> {
    const row = await super.findById(id, client);
    return row ? decryptRow(row) : undefined;
  }

  override async findMany(
    where?: SQL,
    opts: ListOptions = {},
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect[]> {
    const rows = await super.findMany(where, opts, client);
    return decryptRows(rows);
  }

  override async create(
    data: OrganizationToolpackInsert,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect> {
    const row = await super.create(encryptInsert(data), client);
    return decryptRow(row);
  }

  override async update(
    id: string,
    data: Partial<OrganizationToolpackInsert>,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect | undefined> {
    const row = await super.update(id, encryptInsert(data), client);
    return row ? decryptRow(row) : undefined;
  }

  override async upsert(
    data: OrganizationToolpackInsert,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect> {
    const row = await super.upsert(encryptInsert(data), client);
    return decryptRow(row);
  }

  /**
   * All live (non-soft-deleted) toolpack rows for an organization.
   */
  async findByOrganizationId(
    organizationId: string,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect[]> {
    const rows = (await (client as typeof db)
      .select()
      .from(organizationToolpacks)
      .where(
        and(
          eq(organizationToolpacks.organizationId, organizationId),
          isNull(organizationToolpacks.deleted)
        )
      )) as OrganizationToolpackSelect[];
    return decryptRows(rows);
  }

  /**
   * Look up multiple toolpacks by id, optionally constrained to an org.
   * Soft-deleted rows are filtered out.
   */
  async findManyByIds(
    ids: string[],
    options: { organizationId?: string } = {},
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect[]> {
    if (ids.length === 0) return [];
    const conditions = [
      inArray(organizationToolpacks.id, ids),
      isNull(organizationToolpacks.deleted),
    ];
    if (options.organizationId) {
      conditions.push(
        eq(organizationToolpacks.organizationId, options.organizationId)
      );
    }
    const rows = (await (client as typeof db)
      .select()
      .from(organizationToolpacks)
      .where(and(...conditions))) as OrganizationToolpackSelect[];
    return decryptRows(rows);
  }

  /**
   * Look up a toolpack by id, optionally constrained to an org.
   * Soft-deleted rows are excluded.
   */
  async findByIdScoped(
    id: string,
    organizationId: string,
    client: DbClient = db
  ): Promise<OrganizationToolpackSelect | undefined> {
    const [row] = await (client as typeof db)
      .select()
      .from(organizationToolpacks)
      .where(
        and(
          eq(organizationToolpacks.id, id),
          eq(organizationToolpacks.organizationId, organizationId),
          isNull(organizationToolpacks.deleted)
        )
      )
      .limit(1);
    return row
      ? decryptRow(row as unknown as OrganizationToolpackSelect)
      : undefined;
  }
}

export const organizationToolpacksRepo = new OrganizationToolpacksRepository();
