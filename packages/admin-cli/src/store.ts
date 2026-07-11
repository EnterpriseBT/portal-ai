/**
 * AdminStore (#190) — the data seam every command talks through. Today's
 * implementation is DB-backed (drizzle over the env connection, the confirmed
 * permanent path for owner tooling); an API-backed implementation slots in
 * behind the same interface when the public customer CLI exists.
 *
 * Semantics mirror apps/api's repository layer (parity-pinned): every read
 * filters `deleted IS NULL`; every mutation is a single-row, id-scoped
 * statement stamping the audit columns.
 *
 * Slice 1: reads. Mutations land in slice 2.
 */

import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Organization, User } from "@portalai/core/models";

import { AdminNotFoundError } from "./errors.js";
import { organizations, organizationUsers, users } from "./tables.js";

const DEFAULT_LIMIT = 50;

export interface ListOrgsOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ListUsersOptions {
  orgId?: string;
  limit?: number;
  offset?: number;
}

export interface AdminStore {
  /** Live orgs, name-searchable (ILIKE), created desc, paginated. */
  listOrgs(opts: ListOrgsOptions): Promise<Organization[]>;
  /** Live org by id → ADMIN_NOT_FOUND otherwise. */
  getOrg(id: string): Promise<Organization>;
  /** Live users; `orgId` filters via LIVE membership. */
  listUsers(opts: ListUsersOptions): Promise<User[]>;
  /** Live user by email → ADMIN_NOT_FOUND otherwise. */
  getUserByEmail(email: string): Promise<User>;
  close(): Promise<void>;
}

/** Store over an existing drizzle database (tests inject PGlite here). */
export function createAdminStore(
  db: PostgresJsDatabase,
  onClose: () => Promise<void> = async () => {}
): AdminStore {
  return {
    async listOrgs(opts) {
      const conditions = [isNull(organizations.deleted)];
      if (opts.search) {
        conditions.push(ilike(organizations.name, `%${opts.search}%`));
      }
      const rows = await db
        .select()
        .from(organizations)
        .where(and(...conditions))
        .orderBy(desc(organizations.created))
        .limit(opts.limit ?? DEFAULT_LIMIT)
        .offset(opts.offset ?? 0);
      return rows as Organization[];
    },

    async getOrg(id) {
      const [row] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.id, id), isNull(organizations.deleted)))
        .limit(1);
      if (!row) throw new AdminNotFoundError(`Organization ${id} not found`);
      return row as Organization;
    },

    async listUsers(opts) {
      if (opts.orgId) {
        const rows = await db
          .select({ user: users })
          .from(organizationUsers)
          .innerJoin(users, eq(organizationUsers.userId, users.id))
          .where(
            and(
              eq(organizationUsers.organizationId, opts.orgId),
              isNull(organizationUsers.deleted),
              isNull(users.deleted)
            )
          )
          .orderBy(desc(users.created))
          .limit(opts.limit ?? DEFAULT_LIMIT)
          .offset(opts.offset ?? 0);
        return rows.map((r) => r.user) as User[];
      }
      const rows = await db
        .select()
        .from(users)
        .where(isNull(users.deleted))
        .orderBy(desc(users.created))
        .limit(opts.limit ?? DEFAULT_LIMIT)
        .offset(opts.offset ?? 0);
      return rows as User[];
    },

    async getUserByEmail(email) {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deleted)))
        .limit(1);
      if (!row) throw new AdminNotFoundError(`User ${email} not found`);
      return row as User;
    },

    close: onClose,
  };
}

/** Store over a live connection string (the CLI's runtime path). */
export function createDbAdminStore(connectionString: string): AdminStore {
  const client = postgres(connectionString, { max: 2 });
  const db = drizzle(client);
  return createAdminStore(db, async () => {
    await client.end({ timeout: 5 });
  });
}
